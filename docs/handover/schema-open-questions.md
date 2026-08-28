# 인프라 담당자 인계 — 미결정 스키마 6건

> 작성 2026-08-28. `docs/handover/infra-implementations.md`(구현 명세)와 `docs/handover/b2-session-tagging.md`(태깅 규칙)가 **이미 있는 스키마 위에서** 무엇을 만들지 정한 문서라면, 이 문서는 **아직 스키마 자체가 없는 6개 지점**을 모아 둔 것이다.
>
> 저장소 실측(`backend/migrations/001_app_auth.sql` 135줄, `backend/src/store/types.ts`, `docs/backend_contract.md`) 기준이다.

## 0. 이 문서를 쓰는 법

`backend/migrations/001_app_auth.sql`에는 테이블이 8개 있다 — `app_user_profile`, `audit_log`, `battery_asset`, `measurement_session`, `relay_state`, `telemetry_metric`, `diagnosis`, `idempotency_key`. 이 8개가 `backend/src/store/types.ts`의 도메인 타입에 대응하며, `CellGuardStore`(PostgreSQL) 구현에 필요한 것은 **대체로 여기 있다.**

> **⚠️ "1:1로 맞다"는 서술은 과장이다.** 컬럼과 타입이 정확히 일치하는 것은 `measurement_session` ↔ `DemoSession` 하나뿐이다. 어긋나는 곳: `telemetry_metric`·`idempotency_key`에 대응하는 행 타입이 아예 없고, `DemoBattery.latest`(8필드, `score` 포함)·`mode1Health`(6필드)·`battery_asset.capacity_mah`·`relay_state.reason_params`·`diagnosis.completed_at`·`app_user_profile.is_active`·`audit_log.ip_address`/`user_agent`가 한쪽에만 있다. 그중 **저장할 곳이 아예 없어 구현을 막는 것 하나**는 Q6으로 따로 뺐다.

없는 것은 **에지·AI 파이프라인이 실제로 흐르기 시작할 때 필요해지는 것들**이다. 그래서 백엔드 담당자가 인메모리 데모를 만드는 동안에는 한 번도 부딪히지 않았고, Consumer를 붙이는 순간 6건이 동시에 드러난다.

각 항목은 **현재 상태 → 왜 막히는가 → 이미 정해져 있는 것 → 선택지 → 권장 → 결정하면 같이 바뀌는 것** 순서다.

### ⚠️ 공통 규칙 — 스키마와 타입은 한 쌍이다

`docs/handover/infra-implementations.md` §3이 이미 못박아 둔 규칙이 이 문서 전체에 적용된다:

> **스키마를 바꾸면 `backend/src/store/types.ts`도 같이 바뀐다.** 마이그레이션과 타입 정의는 한 쌍이므로, 컬럼을 추가·삭제·이름 변경하기 전에 반드시 백엔드 담당자와 합의한다.

**아래 6건은 전부 "새 테이블·새 컬럼"이므로 예외 없이 합의 대상이다.** 혼자 정하고 진행하면, 백엔드가 그 테이블을 읽는 코드를 다른 모양으로 짜서 통합 시점에 드러난다.

### 결정 기록

결정할 때마다 이 표를 채운다. 빈 칸이 남아 있으면 그 항목은 아직 합의되지 않은 것이다.

| # | 항목 | 결정 | 결정일 | 합의자 |
|---|---|---|---|---|
| Q1 | `battery-anomaly-alerts` 적재 테이블 | | | |
| Q2 | `age_ms` · `temp_points` 적재 위치 | | | |
| Q3 | TimescaleDB 하이퍼테이블 전환 | | | |
| Q4 | 진단기(`device`) 테이블 | | | |
| Q5 | 텔레메트리 중복 방지 키 | | | |
| Q6 | `battery_asset.memo` 컬럼 | | | |

---

## Q1. `battery-anomaly-alerts`를 받을 테이블이 없다

### 현재 상태

`docs/implementation_status.md` §2 A-1의 **A4**가 *"`battery-anomaly-alerts`(추론 결과) Consumer — 이상점수·AE/Informer 개별 점수·파생 온도가 적재됨"*을 요구한다. 그런데 **적재할 테이블이 없다.**

- 마이그레이션 8개 테이블 어디에도 `score`·`grade`·`ae_score`·`informer_score` 컬럼이 없다.
- `telemetry_metric`(`:88`)은 센서 Raw 전용이라 점수 컬럼이 없다.
- 백엔드는 이 값을 `DemoBattery.latest.score`(`backend/src/store/types.ts:40`) **하나의 최신값**으로만 들고 있고, 그것도 인메모리다. 이력이 없다.

### 왜 막히는가

Consumer가 alerts 토픽을 구독해도 `INSERT` 대상이 없어서 A4를 시작조차 할 수 없다. 그리고 이건 "아무 테이블이나 만들면 되는" 문제가 아니다 — **백엔드가 이미 이 데이터를 읽어 응답을 만드는 계약이 확정돼 있어서**, 테이블이 그 조회를 감당하지 못하면 백엔드 쪽 코드를 다시 짜야 한다.

### 이미 정해져 있는 것 (테이블이 반드시 담아야 하는 값)

| 소비처 | 계약 | 필요한 값 |
|---|---|---|
| `GET /api/dashboard`의 `anomaly` | `backend_contract.md:723` | `score`, `grade`, `aeScore`, `informerScore`, `evaluatedAt` |
| WS `anomaly.score` | `:1625` | 같음 (추론 결과 도착 시마다 push) |
| WS `anomaly.gradeChanged` | `:1626` | 직전 등급과 비교해야 하므로 **이력**이 필요 |
| `GET /api/anomaly/summary` | `:761` | `todayCount`, `peakScore`, `peakAt`, `riskDistribution`(소유 배터리별 4등급 집계), `model.version`·`lastInferenceAt` |
| `GET /api/anomaly/evidence` | `:778` | XAI 기여도 — `[{ feature, contribution }]` 내림차순, **합이 1이 아니다** |
| 파생 온도 | CLAUDE.md §Kafka 토픽 규약 | 칼만 필터값·내부 셀 추정 온도 (에지가 아니라 추론 프로세스가 만든다) |

추가로 확정된 제약:

- **점수는 0.0–1.0 실수다**(`backend_contract.md` §1.6). 0–100 정수는 프론트 표시용이며 DB에 그 형태로 넣지 않는다.
- **`grade`는 저장값이 아니라 계산값이다**(CLAUDE.md §이상점수와 등급). 0.3/0.6/0.8 고정 임계로 **서버가 계산**한다. 컬럼으로 둘 수는 있으나, 두면 점수와 어긋날 수 있는 중복 상태가 생긴다.
- **`aeScore`/`informerScore`는 `null`을 허용한다**(`:753`).
- `peakScore`·`todayCount`·`riskDistribution`은 **소유자 스코프 집계**다(`:775`) — `battery_asset.owner_user_id`까지 조인이 필요하다.

### 선택지

- **(a) 권장 — 새 하이퍼테이블 `anomaly_score`.** `telemetry_metric`과 같은 성격(시계열, 배터리별, 고빈도)이라 같은 취급을 받는 게 자연스럽다. Q3의 하이퍼테이블 결정을 그대로 적용한다. XAI 기여도는 `jsonb` 한 컬럼(`contributions`)으로 받는다 — 특징 개수가 모델 버전에 따라 바뀌므로 컬럼으로 펼치면 모델을 바꿀 때마다 마이그레이션이 필요하다.
- **(b) `telemetry_metric`에 컬럼 추가.** 프레임 대 점수가 1:1이면 조인이 사라져 조회가 가장 빠르다. **다만 추론 주기가 100ms가 아닐 수 있다** — `implementation_status.md` §2 A-2가 *"못 따라가면 추론 주기를 1초로 낮추는 것을 먼저 검토한다"*고 이미 열어 뒀다. 1초가 되면 프레임 10개 중 9개의 점수 컬럼이 `null`이 되므로 이 안은 무너진다.
- **(c) 최신값만 `battery_asset`에 비정규화.** 대시보드는 빨라지지만 `anomaly.gradeChanged`(직전 등급 비교)와 `summary`(24시간 집계)를 만들 수 없다. **단독으로는 계약을 못 채운다** — (a)와 함께라면 캐시로 쓸 수 있다.

### 결정하면 같이 바뀌는 것

- `backend/src/store/types.ts` — `DemoBattery.latest.score` 단일값 외에 이력 조회 타입이 필요해진다.
- `backend/src/store/contract.ts` — `CellGuardStore`에 조회 메서드가 는다(예: `latestAnomaly`, `anomalySummary`). **인터페이스 변경이므로 백엔드 합의 필수**이고, 계약 테스트 20건에도 항목이 붙는다.
- `model.version`(`ae-1.3+informer-0.9`)은 AI 담당자의 체크포인트 반출 절차(A7 — *"특징 버전 표기"*)와 같은 값이어야 한다. **3자 합의 지점이다.**

---

## Q2. `age_ms`와 `temp_points`를 적재할 곳이 없다

### 현재 상태

에지 프레임에는 두 필드가 **있다**(CLAUDE.md §센서 데이터 JSON 스키마, `docs/hardware/mode1_backend_spec.md` §9):

```json
"temp_points": { "contact": [34.1, 36.8, 35.2], "ir": [38.1, 35.9] },
"age_ms": { "soc_pct": 640, "temp_contact": 310, "temp_ir_surface": 40 }
```

`telemetry_metric`에는 **둘 다 없다.** 스칼라 `temp_contact`·`temp_ir_surface`만 있다.

**그리고 같은 성격으로 두 열이 더 빠져 있다 — `mode`와 `soc_basis`다.** `CSV_HEADER`(`backend/src/store/types.ts:110`)와 `docs/backend_contract.md:903`이 CSV 열로 약속하는데 컬럼이 없다:

```
CSV_HEADER            : ...,session_id,mode,voltage_v,...,soc_pct,soc_basis,gas_raw,...,age_ms
telemetry_metric 컬럼 :  mode ✗   soc_basis ✗   age_ms ✗   temp_points ✗
```

⚠️ **`mode`는 조인으로 복구할 수 없는 경우가 있다.** `battery_id`가 채워진 프레임이면 `battery_asset.target_mode`로 유도되지만, **§3이 활성 세션 없는 프레임을 `battery_id = null`로 반드시 적재하라고 규정하므로** 그 프레임들의 `mode`는 영구히 복구 불가능하다. 에지 프레임에는 `mode`가 실려 온다(CLAUDE.md 센서 스키마, `docs/hardware/mode1_backend_spec.md:726`). `soc_basis`는 모드 2의 상대 SOC 여부라 **모드 1의 절대 SOC와 같은 값으로 취급하면 안 되는** 구분값이다(CLAUDE.md). Q2를 결정할 때 이 두 열을 같이 올린다.

### 왜 막히는가

둘 다 버려도 되는 값이 아니다.

- **`age_ms`는 AI 정확도에 직접 걸린다.** CLAUDE.md가 이 필드를 도입한 이유가 *"센서마다 갱신 주기가 달라 100ms 프레임의 절반 이상이 재탕 값인데, 이걸 모르면 AI가 계단 파형을 실제 온도 변화율로 착각한다"*이다. `dT_dt`·`d2T_dt2`가 두 모델의 공통 입력 특징이므로, 이 값이 없으면 학습 데이터셋 자체가 오염된다.
- **`temp_points`는 AI 특징용이다**(`mode1_backend_spec.md` §9-2 "소비자: **AI 특징용이다.** 프론트엔드에 노출하지 않는다"). 지점 간 온도차를 특징으로 쓰기 위한 값이다.
- 그리고 **`CSV_HEADER`에 이미 `age_ms`가 들어 있다**(`backend/src/store/types.ts:110`, `backend_contract.md:903`). Raw CSV 내보내기가 이 열을 약속하고 있는데 저장하지 않으면 영원히 빈 칸이다.

### 이미 정해져 있는 것

- **`age_ms`는 키가 없으면 "이번 프레임 실측"이다**(CLAUDE.md). 즉 **희소(sparse) 맵**이며, 필드 개수가 프레임마다 다르다. 컬럼으로 펼치면 대부분 `null`이 된다.
- **`temp_points`의 배열 길이는 `contact` 3 고정, `ir`은 고정이 아니다.** CLAUDE.md가 *"`temp_points.ir`의 길이 2를 코드에 상수로 박지 마라"*고 명시했다 — IR 어레이(MLX90640 등)로 교체하면 길이가 ROI 존 개수로 바뀐다. **`ir` 길이를 스키마에 박으면 교체 시 마이그레이션이 필요해진다.**
- **불변식**: `temp_contact == max(non-null contact)`, `temp_ir_surface == max(non-null ir)`. 스칼라는 배열에서 유도되는 값이라, 배열을 저장하면 스칼라는 중복이다(그래도 조회 편의상 둘 다 두는 게 낫다).

### 선택지

- **(a) 권장 — `jsonb` 두 컬럼**(`age_ms jsonb`, `temp_points jsonb`). 희소 맵과 가변 길이 배열 양쪽에 맞고, `ir` 길이가 바뀌어도 마이그레이션이 없다. Timescale 압축과도 잘 맞는다(반복이 많은 값이다).
- **(b) 컬럼으로 펼치기**(`age_ms_soc_pct`, `temp_contact_0..2`, `temp_ir_0..1`). 조회는 빠르지만 **`ir` 교체 가능성 때문에 CLAUDE.md의 경고와 정면으로 부딪힌다.** 권장하지 않는다.
- **(c) 저장하지 않는다.** 그러면 **AI 담당자와 먼저 합의해야 한다** — `age_ms` 없이 `dT_dt`를 쓸 수 있는지는 AI 쪽 판단이다. 합의 없이 버리면 나중에 데이터셋을 다시 모아야 한다.

### 결정하면 같이 바뀌는 것

- `backend/src/store/types.ts`의 `csvRow()`(`:112`)가 지금 `age_ms` 자리에 빈 문자열을 넣고 있다. 실제 값을 채우려면 이 함수도 바뀐다.
- `COMBINED_EXISTING_PARTS_V1` 프로필에서는 `temp_points.contact`가 통째로 `null`이다(`backend_contract.md:1414`). 적재 코드가 이 경우를 견뎌야 한다.

---

## Q3. TimescaleDB 하이퍼테이블 DDL이 저장소에 없다 — 그리고 지금 PK로는 전환이 실패한다

### 현재 상태

`docs/implementation_status.md` §2 A-1의 **A3**가 *"TimescaleDB 하이퍼테이블·압축·보존정책(`telemetry_metric`)"*을 요구한다. 저장소 전체에 `create_hypertable`도, `timescaledb` 확장 생성도, 압축·보존 정책도 **한 줄도 없다.** `telemetry_metric`은 지금 평범한 PostgreSQL 테이블이다.

### ⚠️ 왜 막히는가 — 지금 PK 그대로는 `create_hypertable`이 에러를 낸다

```sql
create table if not exists telemetry_metric (
  id bigserial primary key,          -- ← 이것 때문에 실패한다
  ...
  measured_at timestamptz not null,
  ...
);
```

TimescaleDB는 **모든 UNIQUE 인덱스(기본키 포함)가 파티셔닝 컬럼을 포함할 것**을 요구한다. `id` 단독 PK는 `measured_at`을 포함하지 않으므로 `create_hypertable('telemetry_metric', 'measured_at')`이 거부된다.

이건 "나중에 튜닝" 항목이 아니라 **A3의 첫 명령에서 바로 막히는 지점**이다. 먼저 알고 시작하는 것과 데이터를 넣은 뒤에 발견하는 것의 비용 차이가 크다.

### 선택지

- **(a) 권장 — PK를 `(measured_at, id)` 복합으로 바꾼다.** `id`가 남아 있어 단건 참조가 가능하고, 파티셔닝 컬럼이 앞에 와서 시간 범위 조회에도 맞는다.
- **(b) 대리키 `id`를 없애고 자연키를 PK로.** Q5(중복 방지)와 함께 풀면 `(device_id, measured_at)`이 자연키가 된다 — 두 문제가 한 번에 닫힌다. 다만 `telemetry_metric.id`를 참조하는 코드가 생기면 곤란하다(현재는 없다).
- **(c) 하이퍼테이블을 쓰지 않는다.** 100ms × 다중 세션이면 하루 약 86만 행/세션이라 권장하지 않는다. 다만 **시연까지의 데이터량이라면 성립할 수도 있다** — 규모 판단은 인프라 담당자 몫이다.

### 함께 정해야 하는 것

- **`chunk_time_interval`** — 기본 7일은 100ms 적재에 너무 크다.
- **압축 정책** — `compress_segmentby`를 `battery_id`(또는 `device_id`)로 잡는 게 자연스럽다. 압축된 청크는 수정이 어려우므로 재처리(A5) 창과 겹치면 안 된다.
- **보존 정책** — 며칠치를 남길지. **정하기 전에 AI 담당자에게 물어야 한다**(학습 데이터셋을 이 테이블에서 뽑는다면 보존 기간이 곧 데이터셋 상한이다).
- **Q1을 (a)로 정했다면 `anomaly_score`에도 같은 결정을 적용한다.**

### 결정하면 같이 바뀌는 것

- 마이그레이션 파일 자체(`001_app_auth.sql` 수정 또는 `002_*.sql` 신규). **어느 쪽으로 할지도 백엔드와 합의한다** — 001은 이미 백엔드가 기준으로 삼고 있는 파일이다.

---

## Q4. 진단기(`device`) 테이블이 없는데 계약은 진단기를 요구한다

### 현재 상태

`measurement_session.device_id`는 `text not null`이며 **어떤 테이블도 참조하지 않는다**(`001_app_auth.sql:66`). 진단기를 나타내는 테이블이 없기 때문이다. 인메모리 구현은 이 값을 `"demo-device-01"` 문자열로 **하드코딩**한다(`backend/src/store/memory.ts:154`).

그런데 계약은 진단기를 1급 개체로 다룬다:

| 계약 | 요구 |
|---|---|
| `backend_contract.md:667` | *"`deviceId`를 받지 않는다. 사용자당 진단기가 1대이므로 **서버가 계정에 묶인 진단기를 자동 선택한다**"* → **user → device 매핑이 어딘가 있어야 한다** |
| `:1303`·`:1315` | `GET /api/batteries/{id}`가 `device: { id, label, status }`를 내려준다 (`status`: `ONLINE`/`OFFLINE`) |
| `:97`·`:1443` | `409 DEVICE_OFFLINE` — 진단기가 오프라인이면 세션·릴레이 요청을 거절 |
| `:1632` | WS `device.status` — `{ deviceId, status, lastSeenAt }` |
| `:1414` | *"에지 배포의 `hardware_profile`은 Raw 프레임에서 받지 않고 **서버가 `device_id`별 배포 메타데이터로 관리한다**"* |
| `:969` | 알림 `subjectType`에 `DEVICE`가 있다 (`진단기 C 하트비트 미수신`) |

### 왜 인프라 담당자의 문제인가

Consumer의 **모든 조회가 `device_id`를 키로 한다**(`b2-session-tagging.md` §2.1). 그 값이 어디서 오고, 무엇이 유효한 값인지 정의되지 않으면:

- 세션의 `device_id`가 실제 라즈베리파이 식별자와 다른 값(예: `demo-device-01`)으로 들어가 **태깅이 전부 miss 난다.**
- `hardware_profile`을 `device_id`로 찾아야 하는데(F21 fail-closed의 근거) 찾을 곳이 없다.
- `lastSeenAt`(하트비트)은 텔레메트리 프레임 도착으로 갱신되는 값이라 **Consumer가 쓰는 게 가장 자연스럽다.**

### 선택지

- **(a) 권장 — `device` 테이블을 만든다.** `id`(에지 설정 파일의 `device_id`와 같은 값), `owner_user_id`, `label`, `hardware_profile`, `last_seen_at`, `status`. `measurement_session.device_id`에 FK를 건다. Consumer가 프레임마다 `last_seen_at`을 갱신하고, 백엔드가 그걸로 `ONLINE`/`OFFLINE`을 판정한다.
- **(b) `app_user_profile`에 `device_id` 컬럼만 추가.** 사용자당 1대라는 현재 전제에는 맞고 가장 싸다. 다만 `hardware_profile`·`last_seen_at`·`label`을 놓을 곳이 없어 F21 게이트와 `device.status`를 못 만든다.
- **(c) 지금 하지 않는다.** 그러면 **`device_id`를 어디서 얻을지에 대한 임시 규칙**(예: 설정 파일 상수 1개)을 명시적으로 문서에 적고, `409 DEVICE_OFFLINE`·`device.status`·`hardware_profile` 조회는 구현 대상에서 뺀다. **암묵적으로 미루면 안 된다** — 세션의 `device_id`가 조용히 틀린 값으로 채워지는 게 가장 나쁜 결과다.

### `last_seen_at` 갱신 빈도 주의

프레임마다(초당 10회) `UPDATE`를 치면 진단기 1대에도 초당 10번의 행 갱신이 생긴다. **N초에 한 번으로 스로틀**하거나 별도 경량 테이블에 둔다. `OFFLINE` 판정 문턱(몇 초 미수신이면 오프라인인가)은 아직 정해진 값이 없으므로 **추정해 채우지 말고 백엔드와 합의한다.**

---

## Q5. 재처리했을 때 중복을 막을 키가 없다

### 현재 상태

`docs/implementation_status.md` §2 A-1의 **A5**가 *"Consumer 오프셋·재처리·중복 방지 — 재시작 후 유실·중복 없음"*을 요구한다.

그런데 `telemetry_metric`의 유일한 키는 `id bigserial`이고, 인덱스는 `idx_telemetry_battery_time`(**non-unique**) 하나뿐이다. 즉 **같은 프레임을 두 번 INSERT하면 두 행이 그대로 들어간다.** Kafka는 at-least-once가 기본이므로(오프셋 커밋 전 재시작, 리밸런싱, 재처리) 이건 예외가 아니라 **정상 동작 중에 일어난다.**

### 왜 지금 정해야 하나

중복은 조용하다. 조회는 잘 되고 화면도 뜬다. 다만 `dT_dt`가 0으로 눌리고 `Wh_cumsum`이 부풀며, 그게 **AI 학습 데이터셋에 그대로 들어간다.** 발견 시점이 늦을수록 데이터를 다시 모아야 하는 범위가 커진다.

### 선택지

- **(a) 권장 — 자연키에 UNIQUE + `on conflict do nothing`.** `(device_id, measured_at)`이 자연키다(한 진단기가 같은 시각에 두 프레임을 낼 수 없다). Q3의 하이퍼테이블 요건(`measured_at` 포함)도 자동으로 만족한다 — **Q3과 함께 풀면 한 번에 닫힌다.**
  - ⚠️ 전제: 에지의 `timestamp`가 프레임마다 유일해야 한다. 100ms 주기라 정상이지만 **실물로 확인할 것**(같은 ms가 두 번 찍히면 두 번째 프레임이 조용히 버려진다).
- **(b) Kafka 파티션·오프셋을 컬럼으로 저장하고 그 쌍에 UNIQUE.** 에지 시계에 전혀 의존하지 않는다. 다만 토픽을 재생성하거나 파티션 수를 바꾸면 무의미해진다.
- **(c) 정확히 한 번(exactly-once) 트랜잭션에 맡긴다.** 오프셋 커밋과 DB 쓰기를 한 트랜잭션에 넣는다. 가장 정확하지만 구현이 가장 무겁고, **Q1의 `anomaly_score`에도 같은 장치를 따로 해야 한다.**

### 결정하면 같이 바뀌는 것

- Q3의 PK 결정과 직결된다. (b)를 고르면 `(measured_at, id)` 복합 PK로 충분하고, (a)를 고르면 `(device_id, measured_at)` 자체가 PK가 될 수 있다.
- **Q1의 `anomaly_score` 테이블에도 같은 결정이 필요하다.** 추론 결과 역시 재처리 대상이다.

---

## Q6. `DemoBattery.memo`를 저장할 컬럼이 없다

### 현재 상태

`backend/src/store/types.ts:30-31`에는 메모가 **두 개**다:

```ts
memo: string;        // 사용자 메모
adminMemo: string;   // 관리자 메모
```

그런데 `battery_asset` DDL에는 **`admin_memo`만 있다**(`backend/migrations/001_app_auth.sql:51`). 사용자 메모를 넣을 컬럼이 없다.

### 왜 막히는가

`memo`는 죽은 필드가 아니다 — `backend/src/server.ts:168`이 응답에 실어 내리고 `:494`가 `PATCH`로 수정한다(`UpdateBatteryInput.memo`, `contract.ts`). **즉 `createPostgresStore`를 짜는 순간 `updateBattery`에서 저장할 곳이 없어 막힌다.** 인메모리 구현에서는 그냥 객체 필드라 여태 드러나지 않았다.

이건 Q1~Q5와 성격이 다르다 — **"나중에 필요해지는 것"이 아니라 1부(PostgreSQL 저장소) 작업 중에 바로 부딪히는 것**이다.

### 선택지

- **(a) 권장 — `battery_asset`에 `memo text not null default ''` 추가.** `admin_memo`와 대칭이고 한 줄이면 끝난다. 관리자 메모와 사용자 메모를 분리해 저장하는 현재 계약(`saveMemo`는 관리자용·감사 로그 동반, `updateBattery`는 소유자용)이 그대로 유지된다.
- **(b) `admin_memo` 하나로 합친다.** 컬럼이 늘지 않지만 **계약 위반이다** — 두 메모는 권한이 다르고(§5의 `saveMemo`는 원자적 감사 기록 대상), 합치면 소유자가 관리자 메모를 덮어쓴다.
- **(c) `memo`를 제거한다.** 프론트·라우트·타입을 같이 걷어내야 하므로 **백엔드 몫이고 인프라가 결정할 사안이 아니다.**

### 결정하면 같이 바뀌는 것

마이그레이션만 바뀌고 `store/types.ts`는 그대로다 — **이 문서에서 유일하게 타입 변경이 필요 없는 항목**이라 (a)가 가장 싸다.

---

## 요약 — 결정 순서 제안

1. **Q3 + Q5를 함께 정한다.** PK 모양과 중복 방지 키가 같은 결정이라 따로 풀면 두 번 마이그레이션한다.
2. **Q4를 정한다.** Consumer의 조회 키(`device_id`)의 출처가 정해져야 태깅 규칙(`b2-session-tagging.md`)이 실제 값 위에서 돈다.
3. **Q1을 정한다.** A4 착수 조건이고, `CellGuardStore` 인터페이스가 늘어나므로 백엔드 합의가 가장 크게 필요하다.
4. **Q2를 정한다.** 위 셋보다 급하지 않지만, **데이터를 모으기 시작하기 전에** 정해야 한다 — 나중에 정하면 그때까지 쌓인 데이터에는 그 값이 없다.

> **Q6은 이 순서 밖이다 — 가장 먼저, 그리고 가장 싸게 끝난다.** 1부(PostgreSQL 저장소) 작업 중에 바로 막히는 항목이고 컬럼 한 줄이면 해결된다.

> Q1·Q2는 **AI 담당자와도 걸린다**(`model.version` 표기, `age_ms` 필요 여부, 보존 기간 = 데이터셋 상한). 백엔드 2자 합의로 끝내지 말 것.
