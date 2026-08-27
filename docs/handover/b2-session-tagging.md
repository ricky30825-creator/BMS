# Kafka Consumer: battery_id 세션 태깅 규칙

> **이 문서는 인프라 담당자의 Kafka Consumer가 따를 battery_id 귀속 규칙이다.**
> Consumer는 에지 장비에서 받은 raw 텔레메트리에 battery_id를 붙여 데이터베이스에 적재한다.
> 에지는 `device_id`만 알기 때문에 backend의 measurement_session 정보로 attribution을 결정한다.

| 항목 | 값 |
|---|---|
| 작성일 | 2026-08-27 |
| 근거 문서 | CLAUDE.md (센서 스키마 절, 배터리 자산 절), `docs/product_contract.md` (§3.2 사용자당 진단기 1대 규칙) |
| 영역 | `measurement_session` 활성 상태, 세션 생명주기, telemetry_metric 적재 시점 |
| 대상 구성요소 | Kafka Consumer (인프라 코드) — 이 저장소 밖 |

---

## 1. 왜 battery_id 태깅이 필요한가

에지 장비(Raspberry Pi)는 센서 raw 데이터를 100ms 주기로 수집해 Kafka로 발행한다. 각 프레임의 JSON 스키마는 다음을 포함한다:

```json
{
  "device_id": "string",
  "mode": 1 | 2,
  "timestamp": "ISO8601",
  "voltage_v": 3.82,
  "current_a": -1.25,
  ...
}
```

**에지는 측정 **대상**(셀/보조배터리, `battery_asset`)의 정체를 모르고 `device_id`(측정 **장비**의 정체)만 안다.** 한 진단기가 여러 배터리를 번갈아 측정하면 "이 프레임은 어느 배터리 것인가"를 판단할 근거가 프레임 자체에 없다.

데이터베이스 `telemetry_metric` 테이블은 `battery_id` 외래키를 필수로 가지므로, **적재 시점에 백엔드의 현재 측정 세션 정보로 `battery_id`를 채워야 한다.** 이 규칙은 그 판단 로직을 정의한다.

참조: CLAUDE.md 「센서 데이터 JSON 스키마」, 「배터리 자산(Battery Asset)과 이력 추적」

---

## 2. 활성 세션 조회 방법

### 2.1 쿼리 조건

Consumer는 각 프레임을 받을 때마다 다음 조건으로 `measurement_session` 테이블을 조회한다:

```
device_id = <프레임의 device_id>
status = 'ACTIVE'
```

결과는 **0건 또는 1건**이다. 이유:

- **사용자당 진단기는 1대** (`docs/product_contract.md` §3.2) — 한 사용자는 최대 1개의 device_id를 소유.
- **설비당 활성 세션은 1개** — 같은 device_id로는 동시에 2개 이상의 활성 세션을 만들 수 없다(애플리케이션 레벨에서 인터락으로 보증).

따라서 결과가 항상 유일하고, "어느 배터리 세션인가"는 그 행의 `battery_id`로 바로 결정된다.

### 2.2 캐싱 전략

프레임은 100ms 주기로 도착하므로 **매번 데이터베이스를 조회하면 초당 10회의 쿼리**가 쌓인다. 이는 불필요한 부하다.

대신 **`device_id → measurement_session` 캐시**를 유지하고, **세션 시작·종료 시점에만 무효화**한다:

- **캐시 갱신 trigger (무효화)**:
  - `measurement_session` 테이블에 새 행 삽입 (세션 시작)
  - 기존 행의 `status` 컬럼을 `'ACTIVE'`에서 `'COMPLETED'` 또는 `'FAILED'`로 변경 (세션 종료)
  
- **구현 방안**: 
  - DB 레플리카 갱신 이벤트(예: PostgreSQL WAL, 변경 데이터 캡처) 또는
  - 세션 시작/종료를 별도 Kafka 토픽(`battery-events` 등)으로 받아 Consumer 메모리 캐시 갱신
  
- **초기화 시**: 부팅 직후 Consumer는 데이터베이스에서 모든 device_id의 현재 활성 세션을 읽어 캐시를 채운다.

### 2.3 캐시 miss 처리

드물게 캐시가 최신이 아닐 수 있다(예: 세션 시작 이벤트가 지연됨). 이 경우:

1. 캐시에 세션이 없으면 → DB 조회 (동기)
2. 조회 결과를 캐시에 기록
3. 프레임 적재 계속

이렇게 하면 최악의 경우 1~2 프레임의 latency가 발생하나, 결국 일관성이 보증된다.

---

## 3. 활성 세션이 없을 때

프레임을 받았으나 현재 활성 세션이 없는 경우가 있다:

- 진단기는 켜져 있으나 아직 배터리를 물리지 않음
- 세션이 방금 종료됨 (여파 프레임 몇 개)
- 예상 밖 상황 (버그, 인터락 오류 등)

이 경우 **`battery_id = null`로 적재한다. 프레임을 버리지 않는다.**

### 3.1 스키마 지원

데이터베이스 스키마는 이미 nullable을 지원한다:

```sql
ALTER TABLE telemetry_metric
ADD COLUMN battery_id text REFERENCES battery_asset(id) ON DELETE SET NULL;
```

`battery_id`가 `null`이어도 테이블에 저장되고, 이는 정상적인 상태다.

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

- Session A: `status = 'COMPLETED'` (이미 종료됨) → 캐시에서 제거됨
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
  SELECT COUNT(*) FROM telemetry_metric 
  WHERE measurement_session_id = '<session_id>' 
    AND battery_id IS NULL;
  -- 결과: 0
  ```

### 5.2 세션 외 프레임

- **어떤 배터리에도 귀속되지 않은 프레임은 `battery_id = null`이어야 함.**
- 즉, 세션 범위 밖 프레임이 잘못된 세션에 붙으면 안 됨.
- 검증:
  ```sql
  SELECT COUNT(*) FROM telemetry_metric m
  WHERE m.measurement_session_id IS NULL
    AND m.battery_id IS NOT NULL;
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
Kafka Consumer (인프라 코드)
  ├─ measurement_session 캐시 조회
  ├─ battery_id 결정
  └─ INSERT INTO telemetry_metric
       (device_id, measured_at, voltage_v, ..., battery_id)
  ↓
PostgreSQL + TimescaleDB
  └─ telemetry_metric 테이블
```

Consumer의 책임은 **"device_id 알아서 battery_id로 변환"** 그것뿐이다. 세션 생명주기 관리(시작/종료)는 백엔드 애플리케이션이 한다.

---

## 변경 이력

- 2026-08-27: 초안 작성 (Task 14 — B2 Phase)
