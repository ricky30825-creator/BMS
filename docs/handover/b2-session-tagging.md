# Kafka Consumer: battery_id 세션 태깅 규칙

> **이 문서는 backend 프로세스에 embedded된 RawMetricsConsumer가 따를 battery_id 귀속 규칙이다.**
> Consumer는 에지 장비에서 받은 raw 텔레메트리에 battery_id를 붙여 데이터베이스에 적재한다.
> 에지는 `device_id`만 알기 때문에 backend의 measurement_session 정보로 attribution을 결정한다.

| 항목 | 값 |
|---|---|
| 작성일 | 2026-08-27 |
| 근거 문서 | CLAUDE.md (센서 스키마 절, 배터리 자산 절), `docs/product_contract.md` (§3.2 사용자당 진단기 1대 규칙), `backend/migrations/000`~`007` (실제 컬럼·제약) |
| 영역 | `measurement_session` 활성 상태, 세션 생명주기, telemetry_metric 적재 시점 |
| 대상 구성요소 | `backend/src/telemetryConsumer.ts` — PostgreSQL backend 프로세스에 opt-in embedded |

---

## 1. 왜 battery_id 태깅이 필요한가

에지 장비(Raspberry Pi)는 센서 raw 데이터를 100ms 주기로 수집해 Kafka로 발행한다. 각 프레임의 JSON 스키마는 다음을 포함한다:

```json
{
  "version": 1,
  "device_id": "string",
  "mode": 1 | 2,
  "timestamp": "ISO8601",
  "voltage_v": 3.82,
  "current_a": -1.25,
  ...
}
```

**에지는 측정 **대상**(셀/보조배터리, `battery_asset`)의 정체를 모르고 `device_id`(측정 **장비**의 정체)만 안다.** 한 진단기가 여러 배터리를 번갈아 측정하면 "이 프레임은 어느 배터리 것인가"를 판단할 근거가 프레임 자체에 없다.

데이터베이스 `telemetry_metric` 테이블은 `battery_id` 외래키를 갖지만 **nullable**이므로(§3.1), **적재 시점에 백엔드의 현재 측정 세션 정보로 `battery_id`를 채우되, 채울 수 없으면 `null`로 적재한다.** 이 규칙은 그 판단 로직을 정의한다.

참조: CLAUDE.md 「센서 데이터 JSON 스키마」, 「배터리 자산(Battery Asset)과 이력 추적」

### 1.1 AI anomaly 결과도 Consumer가 귀속한다

로컬 AI 프로세스는 `battery-raw-metrics`를 구독하므로 wire 입력에서 권위 있게 아는 값은 `device_id`뿐이다. `battery-anomaly-alerts` payload에 `battery_id`나 `session_id`를 AI가 넣지 않는다. anomaly 결과를 `anomaly_score`에 적재할 때도 raw와 같은 **처리 시점의 활성 `measurement_session`**을 조회해 `session_id`·`battery_id`를 함께 채우며, 활성 세션이 없으면 둘 다 `null`로 둔다. `evaluated_at`을 이용해 AI가 배터리 귀속을 추측하지 않는다.

---

## 2. 활성 세션 조회 방법

### 2.1 쿼리 조건

Consumer는 각 프레임을 받을 때마다 다음 조건으로 `measurement_session` 테이블을 조회한다:

```
device_id = <프레임의 device_id>
status = 'ACTIVE'
```

결과는 **0건 또는 1건**이다. 이유:

- **설비 전체의 활성 세션은 1개** — 이걸 보증하는 것은 애플리케이션 코드가 아니라 **DB의 부분 유니크 인덱스**다: `uq_active_session_global on measurement_session (status) where status = 'ACTIVE'`(`backend/migrations/002_domain_gaps.sql:43-44`). `device_id = <frame.device_id>` 조건으로 조회하면 결과는 0건 또는 1건이다.

따라서 결과가 항상 유일하고, "어느 배터리 세션인가"는 그 행의 `battery_id`로 바로 결정된다.

> **⚠️ "사용자당 진단기 1대"를 근거로 삼지 말 것.** `docs/product_contract.md` §3.2가 그렇게 정하고 있어도 Consumer는 user → device 매핑이 아니라 **처리 시점의 ACTIVE 세션**을 기준으로 태깅한다. `device` 테이블과 세션의 FK는 `backend/migrations/002_domain_gaps.sql`에 있지만, battery 귀속의 권위 있는 행은 여전히 `measurement_session`이다.
>
> 활성 세션 범위는 2026-08-28에 **설비 전체 1개**로 확정됐다. `backend/src/store/memory.ts`와 `backend/migrations/002_domain_gaps.sql`의 전역 제약이 정본이다.

### 2.2 현재 조회 전략

초기 구현은 **프레임마다 PostgreSQL transaction 안에서 직접 조회**한다. 세션
시작·종료를 별도 Consumer가 관측하는 invalidation hook이 아직 없으므로,
stale cache가 잘못된 `battery_id`를 붙이는 것보다 처리 시점의 DB 상태를
권위로 삼는 것이 우선이다. 100ms 스트림에서 초당 약 10회의 세션 조회가
생기며, 실제 부하 인수 뒤에만 cache/WAL/CDC 최적화를 검토한다.

> **⚠️ `status`는 `'ACTIVE'` / `'ENDED'` 두 값뿐이다.** `measurement_session_status_check` 제약이 그렇게 잡혀 있어(`backend/migrations/001_app_auth.sql:68`) `'COMPLETED'`·`'FAILED'`를 쓰면 INSERT/UPDATE가 거부된다. 종료 **사유**는 별도 컬럼 `end_reason`에 들어가며, 현재 백엔드가 쓰는 값은 두 개뿐이다(`backend/src/store/memory.ts:150`·`:172`):
>
> | `end_reason` | 언제 |
> |---|---|
> | `SUPERSEDED` | 같은 진단기로 새 세션이 시작돼 이전 세션이 대체됨 |
> | `BLOCKED` | 관리자가 배터리를 `BLOCKED`로 바꿔 활성 세션이 강제 종료됨 |
>
> **사용자가 "측정 종료"를 눌러 세션을 끝내는 경로는 오늘 없다** — 세션은 위 두 경우에만 끝난다. Consumer는 다음 프레임의 DB 조회에서 이 상태 전환을 반영한다.

### 2.3 세션 전환

캐시를 사용하지 않으므로 별도 cache miss 경로는 없다. 매 프레임의 조회
결과가 세션 전환 직후의 attribution을 결정하며, 조회 결과가 없으면 즉시
두 backend ID를 `null`로 적재한다.

---

## 3. 활성 세션이 없을 때

프레임을 받았으나 현재 활성 세션이 없는 경우가 있다:

- 진단기는 켜져 있으나 아직 배터리를 물리지 않음
- 세션이 방금 종료됨 (여파 프레임 몇 개)
- 예상 밖 상황 (버그, 인터락 오류 등)

이 경우 **`battery_id = null`로 적재한다. 프레임을 버리지 않는다.**

### 3.1 스키마 지원

`telemetry_metric`에는 `battery_id`가 **이미 있고 nullable이다.** 컬럼을 새로 추가할 필요가 없다(`backend/migrations/001_app_auth.sql:88`):

```sql
create table if not exists telemetry_metric (
  id          bigserial primary key,
  session_id  text references measurement_session(id) on delete set null,
  battery_id  text references battery_asset(id)       on delete set null,
  device_id   text not null,
  measured_at timestamptz not null,
  ...
);
```

`battery_id`가 `null`이어도 테이블에 저장되고, 이는 정상적인 상태다.

> **`session_id`도 함께 채운다.** 이 테이블은 `battery_id`와 `session_id`를 **둘 다** 갖는다. Consumer가 활성 세션을 찾았으면 그 세션의 `battery_id`뿐 아니라 `id`도 같이 넣는다 — §5의 완료 판정 SQL이 두 컬럼의 정합성을 본다. 활성 세션이 없으면 둘 다 `null`이다.

### 3.2 분석 가치

세션 밖 프레임은 나중에 원인 분석·디버깅에 쓸 수 있다:

- "진단기 부팅 후 첫 측정까지 몇 초 걸렸는가"
- "세션 종료 후 몇 프레임이 추가로 들어왔는가" (온디바이스 버퍼링·네트워크 지연 진단)
- 비정상 세션 시작/종료 추적

따라서 삭제하지 말고 보존하는 것이 맞다.

---

## 4. 세션 전환 경계에서의 판정 기준

### 4.1 프레임이 도착하는 시점

세션이 종료된 이후, 그 세션의 마지막 프레임을 측정한 이후 프레임이 도착할 수 있다. 예시:

```
Session A: start_at = 14:32:10.000Z, end_at = 14:35:00.000Z
Session B: start_at = 14:35:00.100Z, ...

Frame 1: measured_at = 14:34:59.800Z, arrives at 14:35:00.050Z
Frame 2: measured_at = 14:35:00.200Z, arrives at 14:35:00.150Z
```

Frame 1은 **measured 시각으로는 Session A 범위** (14:34:59.800 < 14:35:00)이나, **도착 시각으로는 Session B 범위** (14:35:00.050 > 14:35:00)다.

### 4.2 판정 기준: 적재 시점의 활성 세션

**Frame의 `measured_at`(에지 타임스탐프)를 판정 기준으로 쓰지 않는다.**
대신 **Consumer가 프레임을 처리하는 시점의 활성 세션**을 기준으로 `battery_id`를 결정한다.

위 예시에서 Frame 1이 적재되는 시점(14:35:00.050Z)에 조회하면:

- Session A: `status = 'ENDED'` (이미 종료됨, `end_reason = 'SUPERSEDED'`) → 캐시에서 제거됨
- Session B: `status = 'ACTIVE'` → 이 세션의 `battery_id` 사용
- 결과: Frame 1은 **battery_id_B**로 적재

### 4.3 이유: 시계 동기화의 불확실성

에지(Raspberry Pi)와 서버의 시계가 **항상 동기화되어 있지 않다.**

- NTP 확정 전
- 네트워크 지연으로 시각이 밀림
- 에지 부팅 직후 시계가 부정확할 수 있음

에지의 `measured_at`을 신뢰하면:

1. "이 프레임은 실제로는 이전 세션에 속해야 하나?" 판단이 불확실해짐
2. 시계 차이가 크면 같은 프레임이 다른 세션으로 귀속될 수도 있음 (이력 오염)
3. "어느 세션이 맞는가" 두 가지 해석이 생겨 재현 불가능한 버그

**적재 시점의 활성 세션**을 쓰면:

- 판정 기준이 명확함 (즉시성)
- 에지 시계 오류에 영향 받지 않음
- Consumer가 순간적으로 본 시스템 상태 그대로를 기록

### 4.4 트레이드오프

이 규칙의 대가:

- **세션 종료 직후 몇 프레임은 다음 세션에 속할 수 있다.** 
  - 예: Session A 종료 → 100ms 지연 → Frame 도착 → 이미 Session B 활성 → Frame이 B에 붙음
  - 발생 빈도: 드물다 (정상 측정 흐름에서 세션 전환은 사용자 수동 선택)
  - 영향: 100ms 프레임 몇 개 (최대 10개 미만, 일반적으로 1~3개)
  - 분석 오차: 무시할 수 있는 수준 (측정 세션은 보통 3~600초)

이는 **허용된, 제한된 부정확성**이다. 정밀도 전체를 NTP 동기화에 거는 것보다 낫다.

---

## 5. 완료 판정 (Acceptance Criterion)

태깅 기능이 완료되었음을 확인하는 방법:

### 5.1 세션 내 프레임

- **측정 기간 내 모든 frame의 `battery_id`가 세션의 `battery_id`로 채워진다.**
- NULL 값이 섞이면 안 됨.
- 검증: 
  ```sql
  select count(*) from telemetry_metric
  where session_id = '<session_id>'
    and battery_id is null;
  -- 결과: 0
  ```

### 5.2 세션 외 프레임

- **어떤 배터리에도 귀속되지 않은 프레임은 `battery_id = null`이어야 함.**
- 즉, 세션 범위 밖 프레임이 잘못된 세션에 붙으면 안 됨.
- 검증:
  ```sql
  select count(*) from telemetry_metric
  where session_id is null
    and battery_id is not null;
  -- 결과: 0
  ```

### 5.3 통합 확인

다음을 동시에 만족해야 한다:

1. Session S1 (device_id=D1, battery_id=B1, start=T0, end=T1): 모든 프레임이 B1
2. Session S2 (device_id=D1, battery_id=B2, start=T1+α, end=T2): 모든 프레임이 B2
3. T1과 T1+α 사이 도착한 프레임: `battery_id = null`

이를 자동 테스트로 구성할 수 있다 (예: Consumer 통합 테스트).

---

## 참고: 시스템 흐름

Consumer의 역할이 전체 시스템에서 어디인가:

```
Raspberry Pi (에지)
  ↓ (Kafka, 100ms 주기)
  battery-raw-metrics topic
  ↓
backend/src/telemetryConsumer.ts
  ├─ measurement_session 처리시점 조회
  ├─ battery_id 결정
  ├─ insert into telemetry_metric
  │    (device_id, measured_at, voltage_v, ..., session_id, battery_id, raw_payload)
  └─ monotonic battery_latest update + safety hook
  ↓
PostgreSQL + TimescaleDB
  └─ telemetry_metric 테이블
```

Consumer의 책임은 **"device_id 알아서 battery_id로 변환"**하고 raw frame을
보존하는 것이다. 세션 생명주기 관리(시작/종료)는 백엔드 애플리케이션이
한다. Kafka offset은 DB transaction과 frame별 safety hook이 성공한 뒤에만
수동 commit하며, `(device_id, measured_at)` replay는 `on conflict do nothing`으로
무해하게 처리한다. 이는 DB/Kafka 원자 commit을 의미하지 않는다.

---

## 변경 이력

- 2026-08-27: 초안 작성 (Task 14 — B2 Phase)
- 2026-08-28: 실제 스키마와 어긋난 3건을 정정 — 세션 종료 상태값(`'COMPLETED'`/`'FAILED'` → `'ENDED'` + `end_reason`), §3.1의 불필요한 `ALTER TABLE ... ADD COLUMN battery_id`(이미 존재) 제거, §5 완료 판정 SQL의 컬럼명(`measurement_session_id` → `session_id`). `session_id`도 함께 적재한다는 규칙을 §3.1에 추가했다.
- 2026-09-14: `backend/src/telemetryConsumer.ts` 구현에 맞춰 per-frame DB 조회, raw payload 보존, monotonic `battery_latest`, at-least-once manual offset commit, embedded server wiring을 확정했다.
