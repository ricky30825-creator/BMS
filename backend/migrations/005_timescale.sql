-- 005_timescale.sql — TimescaleDB 전환. Q3 + Q5를 한 번에 닫는다.
-- 결정일 2026-08-28. **컬럼 추가(003·004)가 모두 끝난 뒤에 적용한다.**
--
-- 전제: 반드시 TimescaleDB 배포판/확장이 있어야 한다. 이 파일이 실패하면
--       PostgreSQL 모드를 열지 않는다. 평범한 PostgreSQL 테이블로 대체하지 않는다.

create extension if not exists timescaledb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. telemetry_metric PK 교체 — Q3 + Q5
--
--    기존 `id bigserial primary key`는 파티셔닝 컬럼(measured_at)을 포함하지 않아
--    create_hypertable이 거부한다. Timescale은 모든 UNIQUE 인덱스가 파티셔닝
--    컬럼을 포함할 것을 요구한다.
--
--    (device_id, measured_at)은 자연키다 — 한 진단기가 같은 시각에 두 프레임을 낼 수
--    없다. 에지 타임스탬프는 ms 해상도라(mode1_backend_spec.md:707) 100ms 주기에
--    100배 여유가 있고, 충돌은 진짜 중복(재처리·재전송)일 때만 난다. 그래서 Q5의
--    중복 방지 키가 여기서 같이 닫힌다 — Consumer는 `on conflict do nothing`으로
--    적재하면 재처리가 멱등해진다.
--
--    id를 버려도 안전하다: 현재 저장소 구현체는 telemetry_metric의 자연키
--    (device_id, measured_at)를 사용하며 대리키 id를 참조하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
alter table telemetry_metric drop constraint if exists telemetry_metric_pkey;
alter table telemetry_metric drop column if exists id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telemetry_metric_pkey') then
    alter table telemetry_metric add primary key (device_id, measured_at);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 하이퍼테이블 전환
--
--    chunk_time_interval = 1일: 진단기 1대 × 10 rows/s ≈ 86만 행/일 ≈ 130MB/일.
--    기본값 7일은 100ms 적재에 너무 크다.
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ 아래는 TimescaleDB 2.x의 고전 시그니처다. 3.x에서 제거되면
--    `select create_hypertable('telemetry_metric', by_range('measured_at', interval '1 day'));`
--    형태로 바꾼다(동작은 같다).
select create_hypertable('telemetry_metric', 'measured_at',
                         chunk_time_interval => interval '1 day',
                         if_not_exists => true,
                         migrate_data => true);

select create_hypertable('anomaly_score', 'evaluated_at',
                         chunk_time_interval => interval '1 day',
                         if_not_exists => true,
                         migrate_data => true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 보존 정책 — 2개월 (결정 2026-08-28, AI 담당자)
--    보존 기간 = 학습 데이터셋 상한이다. 이 값을 줄이면 그만큼 과거 데이터로
--    학습할 수 없게 되므로, 바꾸기 전에 AI 담당자와 다시 확인한다.
--    60일 × 130MB ≈ 7.8GB (진단기 1대 기준).
-- ─────────────────────────────────────────────────────────────────────────────
select add_retention_policy('telemetry_metric', interval '60 days', if_not_exists => true);
select add_retention_policy('anomaly_score',    interval '60 days', if_not_exists => true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 압축 정책은 **일부러 걸지 않았다**
--    · 압축된 청크는 수정이 어려워 재처리(A5) 창과 충돌한다.
--    · 60일 보존이어도 8GB 수준이라 호스트 PC에서 문제가 되지 않는다.
--    · 필요해지면 아래 두 줄을 추가하는 것으로 끝난다. 그때 compress_after는
--      재처리 창보다 넉넉히 길게 잡는다.
--
--    alter table telemetry_metric set (timescaledb.compress,
--      timescaledb.compress_segmentby = 'battery_id',
--      timescaledb.compress_orderby = 'measured_at desc');
--    select add_compression_policy('telemetry_metric', interval '14 days');
-- ─────────────────────────────────────────────────────────────────────────────
