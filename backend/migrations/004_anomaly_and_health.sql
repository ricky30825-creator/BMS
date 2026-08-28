-- 004_anomaly_and_health.sql — Q1(추론 결과 적재) + mode1Health 저장소 + outbox.
-- 결정일 2026-08-28.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Q1 — battery-anomaly-alerts 적재 테이블
--    선택지 (b) "telemetry_metric에 컬럼 추가"를 택하지 않은 이유: 추론 주기가
--    1초로 내려갈 여지가 이미 열려 있어(implementation_status.md §2 A-2) 그러면
--    프레임 10개 중 9개의 점수 컬럼이 null이 된다.
--
--    ⚠️ grade 컬럼은 두지 않는다. 등급은 0.3/0.6/0.8 고정 임계로 **서버가 계산**하는
--       값이다(CLAUDE.md). 저장하면 점수와 어긋날 수 있는 중복 상태가 생긴다.
--    ⚠️ score는 0.0–1.0 실수다. 0–100 정수는 프론트 표시용이며 DB에 넣지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists anomaly_score (
  device_id text not null,
  battery_id text references battery_asset(id) on delete set null,
  session_id text references measurement_session(id) on delete set null,
  evaluated_at timestamptz not null,
  score numeric not null check (score >= 0 and score <= 1),
  ae_score numeric check (ae_score is null or (ae_score >= 0 and ae_score <= 1)),
  informer_score numeric check (informer_score is null or (informer_score >= 0 and informer_score <= 1)),
  -- XAI 기여도: [{"feature": "dT_dt", "contribution": 0.41}, ...] 내림차순.
  -- 합이 1이 아니다(backend_contract.md). 특징 개수가 모델 버전에 따라 바뀌므로
  -- 컬럼으로 펼치면 모델을 바꿀 때마다 마이그레이션이 필요하다.
  contributions jsonb,
  -- AI 담당자의 체크포인트 반출 표기와 같은 값이어야 한다 (예: 'ae-1.3+informer-0.9').
  model_version text,
  -- 파생 온도. 에지가 아니라 추론 프로세스가 만든다(CLAUDE.md §Kafka 토픽 규약).
  temp_kalman numeric,
  temp_cell_estimated numeric,
  primary key (device_id, evaluated_at)
);

-- 소유자 스코프 집계(todayCount·peakScore·riskDistribution)는 battery_asset을
-- 조인해야 하므로 battery_id 축 인덱스가 필요하다.
create index if not exists idx_anomaly_battery_time
  on anomaly_score (battery_id, evaluated_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DemoBattery.latest 8필드의 집
--    권장했던 "battery_asset에 비정규화"를 별도 1행 테이블로 조정했다.
--    이유: battery_asset.version이 낙관적 잠금에 쓰인다(expectedVersion →
--    VERSION_CONFLICT). 그 행을 초당 10번 갱신하면 관리자의 정상 수정이
--    끊임없이 충돌한다. 자산 등록부와 실시간 최신값은 갱신 주기가 다르므로 분리한다.
--
--    Consumer가 upsert한다(telemetry는 프레임마다, score는 추론 결과 도착마다).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists battery_latest (
  battery_id text primary key references battery_asset(id) on delete cascade,
  measured_at timestamptz,
  voltage_v numeric,
  current_a numeric,
  power_w numeric,
  temp_contact numeric,
  temp_ir_surface numeric,
  soc_pct numeric,
  soc_basis text check (soc_basis is null or soc_basis in ('ABSOLUTE_GAUGE', 'RELATIVE_SESSION_START')),
  score numeric check (score is null or (score >= 0 and score <= 1)),
  evaluated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. mode1Health 6필드의 집 (모드 1 전용)
--    ⚠️ 모드 2에서는 cycleCount·rulCycles·internalResistanceMohm이 null 확정이다
--       (내부 BMS 접근 불가, 출력단 DC-DC 부스트). 즉 이 테이블에는 모드 1
--       배터리의 행만 생긴다.
--    ⚠️ **누가 이 값을 계산하는지는 아직 미정이다**(backend_contract.md §9 Q6는
--       모드 2만 확정). DB는 저장만 맡는다 — 산출 주체가 정해지면 그쪽이 upsert한다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists battery_health (
  battery_id text primary key references battery_asset(id) on delete cascade,
  design_capacity_mah numeric,
  full_charge_capacity_mah numeric,
  cycle_count integer,
  rul_cycles integer,
  internal_resistance_mohm numeric,
  calculated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. outbox — dual-write 원자성 (infra-implementations.md §13 · §15)
--    "저장소 커밋 → 그 다음 Kafka 발행" 순서는 브로커가 죽어 있으면 DB의 릴레이
--    상태만 바뀌고 에지는 영영 모르는 상태를 만든다(계약서 §3.4 위반).
--    도메인 트랜잭션 안에서 여기에 INSERT하고, 별도 워커가 발행 후 sent_at을 채운다.
--    §15(sessionEnded를 어디서 발행하나)도 이 방식이면 같이 풀린다 — 세션 종료는
--    저장소 트랜잭션 안의 사건이므로 라우트 시그니처를 바꿀 필요가 없다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outbox (
  id bigserial primary key,
  topic text not null,
  -- Kafka 파티션 키. battery_id를 쓰면 배터리별 순서가 보장된다.
  partition_key text,
  -- 사용자에게 보일 문구를 넣지 않는다 — code + params만 싣는다.
  -- 라즈베리파이가 code로 로컬 음성 파일을 고른다(CLAUDE.md).
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists idx_outbox_unsent on outbox (created_at) where sent_at is null;
