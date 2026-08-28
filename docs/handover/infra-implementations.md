# 인프라 담당자 인계 명세 — `CellGuardStore`(PostgreSQL) · `DeviceCommandPort`(Kafka)

> 작성일 2026-08-27 (Task 15, 백엔드 인계 계획의 마지막 태스크). 이 문서 하나로 두 구현체의 경계를 함께 정의한다 — 저장소 커밋과 에지 명령 발행이 서로 맞물려 있어서(§13·§14), 따로 인계하면 그 경계가 두 문서에 나뉘어 드리프트가 난다.
>
> 백엔드가 이미 끝낸 것: 비동기 `CellGuardStore` 인터페이스(`backend/src/store/contract.ts`) + 인메모리 구현체(`backend/src/store/memory.ts`) + 계약 테스트 19건, `DeviceCommandPort` 인터페이스(`backend/src/device/port.ts`) + 로깅 스텁(`backend/src/device/logging.ts`), 순수 `judgeFailsafe` 판정 함수(`backend/src/failsafe.ts`) + 그 저장소/에지/WS 배선(`backend/src/failsafeRunner.ts`, `backend/src/server.ts`).
> 인프라 담당자가 할 것: 두 인터페이스의 **실제 구현체**(PostgreSQL, Kafka)와 그 사이 원자성 결정.

---

## 1부 — `CellGuardStore` (PostgreSQL)

### 1. 무엇을 만드나

`backend/src/store/postgres.ts`에 아래 팩토리 함수를 구현한다.

```ts
import type pg from "pg";
import type { CellGuardStore } from "../store/contract.js";

export function createPostgresStore(pool: pg.Pool): CellGuardStore { /* ... */ }
```

인터페이스 정본은 `backend/src/store/contract.ts`다. 메서드 시그니처·타입·주석에 적힌 세 가지 규칙(에러는 `throw new Error("<CODE>")`, 반환값 방어 복사, 감사 로그 동반 메서드는 원자적)을 그대로 지킨다 — 이 파일을 고치지 않는다.

### 2. 완료 판정

`backend/src/store/contract.test.ts` 맨 아래(152번째 줄, `runStoreContractTests("memory", ...)` 다음)에 아래 한 줄을 추가하고 계약 테스트 19건을 전부 통과시킨다.

```ts
runStoreContractTests("postgres", async () => createPostgresStore(testPool));
```

`testPool`은 테스트 전용 PostgreSQL 인스턴스(또는 트랜잭션 롤백 방식의 격리)를 가리키는 `pg.Pool`이며, 이 명세 밖에서 인프라 담당자가 준비한다. 19건은 인메모리 구현체가 이미 통과하고 있는 계약이므로, PostgreSQL 구현체가 이 중 하나라도 다르게 행동하면 계약 위반이다.

### 3. 스키마

`backend/migrations/001_app_auth.sql`에 8개 테이블이 이미 있다: `app_user_profile`, `audit_log`, `battery_asset`, `measurement_session`, `relay_state`, `telemetry_metric`, `diagnosis`, `idempotency_key`. 컬럼은 `backend/src/store/types.ts`의 타입과 1:1로 맞다.

**⚠️ 스키마를 바꾸면 `store/types.ts`도 같이 바뀐다.** 마이그레이션과 타입 정의는 한 쌍이므로, 컬럼을 추가·삭제·이름 변경하기 전에 반드시 백엔드 담당자와 합의한다. 합의 없이 한쪽만 바꾸면 타입은 컴파일되는데 런타임에서 컬럼이 없어 조용히 깨지거나, 반대로 타입에 없는 컬럼이 방치된다.

### 4. ⚠️ 먼저 풀어야 할 외래키 문제

`battery_asset.owner_user_id`와 `measurement_session.owner_user_id`가 `not null references "user"(id)`인데, `"user"` 테이블은 Better Auth 코어 스키마라 **아직 생성되지 않았다**(`npm run auth:generate` 미실행). 반면 데모 사용자 `hong`·`kimeng`·`leelab`·`parktest`(각각 USER/USER/ADMIN/SUSPENDED, `backend/src/store/memory.ts:30-33`)는 인메모리 구현체 안에만 존재한다. `AUTH_MODE=demo DATA_MODE=postgres`로 띄우는 순간 이 4명으로 `battery_asset`에 INSERT를 시도하면 FK 위반으로 전부 실패한다.

두 선택지 중 하나를 반드시 고른다 — 아무것도 안 고르면 첫 배터리 등록에서 막힌다.

- **(a) 권장.** Better Auth 스키마를 생성·적용한 뒤(`npm run auth:generate`), `AUTH_MODE=demo`로 부팅할 때 데모 4명을 `user`+`app_user_profile`에 `on conflict do nothing`으로 seed한다. 참조무결성이 그대로 유지되고, 나중에 `AUTH_MODE=betterauth`로 전환해도 스키마를 다시 안 건드린다.
- **(b) 대안.** 두 FK(`battery_asset.owner_user_id`, `measurement_session.owner_user_id`)를 제거하고 `text` 컬럼으로 둔다. 선행 작업이 없어 더 빠르지만, DB가 고아 row(존재하지 않는 owner_user_id)를 더 이상 막지 못한다.

이 결정은 인프라 담당자가 내리되, 마이그레이션 파일을 고치는 쪽이므로 백엔드 담당자에게 어느 쪽을 택했는지 알린다.

### 5. 반드시 한 트랜잭션에 넣어야 하는 메서드 6개

`changeRelay`, `engageFailsafe`, `changeOpsStatus`, `saveMemo`, `changeUserStatus`, `startSession`. 전부 도메인 상태 변경 + `audit_log` 쓰기를 함께 하며, `docs/backend_contract.md` §3.4가 *"승인 후 명령 실행과 감사 기록을 원자적으로 처리하고 실패 시 성공 응답이나 성공 이벤트를 내보내지 않는다"*를 요구한다. `backend/src/db.ts`의 `inTransaction(fn)`을 쓴다 — `pool.connect()` → `begin` → `fn(client)` → `commit`/실패 시 `rollback` → `release`를 이미 감싸고 있다.

```ts
await inTransaction(async (client) => {
  const relay = await client.query(/* relay_state 갱신 */);
  await client.query(/* audit_log INSERT */);
  return relay;
});
```

⚠️ **`engageFailsafe`가 가장 중요하다.** 서버 Fail-Safe가 릴레이를 끊는 유일한 경로이며(§14 참조), 릴레이 상태만 바뀌고 `audit_log`에 `RELAY_AUTO_CUT`이 안 남으면 안전 사고가 나도 사후 조사가 불가능하다 — 이 메서드 하나가 이 인수인계 전체에서 가장 사고 비용이 큰 지점이다.

### 6. 애플리케이션 체크에 의존하지 말 것

마이그레이션에 부분 유니크 인덱스가 이미 있다.

```sql
unique (device_id)  where status = 'ACTIVE'    -- measurement_session
unique (battery_id) where status = 'RUNNING'   -- diagnosis
```

동시 요청 두 개가 "찾아보고 없으면 만든다"(read-then-write)를 동시에 통과할 수 있으므로, **이 제약 위반(PostgreSQL 에러 코드 `23505`, unique_violation)을 잡아 `throw new Error("...")`로 도메인 에러로 옮긴다.** 예: `startSession`에서 `23505`가 나면 `throw new Error("NO_ACTIVE_SESSION")`으로, `startDiagnosis`(diagnosis 테이블의 `unique (battery_id) where status = 'RUNNING'`)에서 `23505`가 나면 `throw new Error("DIAGNOSIS_IN_PROGRESS")`로 변환한다(§7 — 새 코드를 만들지 않는다).

⚠️ **계약 테스트는 이 경합을 못 잡는다.** `contract.test.ts`의 스위트는 인메모리 구현체와 공유하도록 단일 스레드·순차 실행이라 동시성이 아예 존재하지 않는다. PostgreSQL 구현체 쪽에는 **별도로** 두 개의 동시 `startSession` 호출을 `Promise.all`로 던지는 테스트를 추가한다:

```ts
const [a, b] = await Promise.allSettled([
  pgStore.startSession("hong", batteryId),
  pgStore.startSession("hong", batteryId),
]);
// 하나는 fulfilled, 하나는 rejected(도메인 에러)여야 하고
// activeSession()으로 조회하면 활성 세션은 정확히 1건이어야 한다.
```

### 7. 에러 code는 새로 만들지 않는다

`docs/backend_contract.md` §1.4/§1.10의 코드 목록이 고정이다. `backend/src/server.ts`의 `errorFromDomain()`(약 274번째 줄)이 `throw new Error("<CODE>")`의 `CODE`를 HTTP 상태로 매핑하는 표를 갖고 있다 — 현재 매핑된 코드: `NOT_FOUND`(404), `BATTERY_BLOCKED`(409), `NO_ACTIVE_SESSION`(409), `NO_STATUS_CHANGE`(409), `REASON_REQUIRED`(422), `INTERLOCK_LOCKED`(409), `MODE_NOT_SUPPORTED`(409), `SAFETY_PROFILE_NOT_READY`(409), `DIAGNOSIS_IN_PROGRESS`(409), `NO_DIAGNOSIS_IN_PROGRESS`(409), `SELF_SUSPEND_FORBIDDEN`(409), `REAUTH_REQUIRED`(401), `INPUT_TOO_LONG`(422), `VERSION_CONFLICT`(409), `BATTERY_NAME_REQUIRED`(422), `CAPACITY_REQUIRED`(422), `RATED_CURRENT_REQUIRED`(422), `IDEMPOTENCY_CONFLICT`(409), `VALIDATION_FAILED`(400). 매핑에 없는 코드는 `500 INTERNAL_ERROR`로 떨어지므로, PostgreSQL 구현체가 던지는 모든 에러 문자열은 이 표에 있는 것이어야 한다. 새 실패 케이스(예: 위 §6의 `23505`)가 생기면 **새 코드를 만들지 말고** 이미 있는 코드 중 의미가 맞는 것으로 매핑한다. 정말 대응되는 코드가 없다고 판단되면 코드를 만들기 전에 백엔드 담당자와 합의한다.

### 8. 방어 복사

호출부가 저장소가 반환한 객체를 마음대로 고쳐도 저장소 내부 상태가 오염되면 안 된다. SQL 쿼리는 매번 새 JS 객체를 만들어 반환하므로 이 규칙은 자연히 지켜진다. **단, 조회 성능을 위해 인메모리 캐시를 얹는다면** — 캐시에 저장한 객체의 참조를 그대로 반환하지 말고, 반환 직전에 얕은 복사(`{ ...cached }`)를 거친다. 이 규칙을 깨면 프론트가 받은 객체를 로컬에서 mutate했을 때 다음 조회 결과가 오염된 값을 보여주는, 재현하기 어려운 버그가 난다.

### 9. 게이트를 여는 시점

구현이 끝나기 전까지 두 지점을 건드리지 않는다:

- `backend/src/server.ts`의 `app.use("/api", ...)` DATA_MODE 가드(`DATA_MODE === "memory"`가 아니면 `503 RUNTIME_NOT_READY`를 반환하는 미들웨어, 현재 356번째 줄 부근) — 이 가드가 `DATA_MODE=postgres`를 여전히 fail-closed로 막고 있다. **구현이 끝나면** 이 미들웨어에서 `postgres` 분기를 열어 실제로 `/api/*`가 통과하도록 고친다.
- `backend/src/store.ts`(facade) — 현재 무조건 `createMemoryStore()`를 선택한다(`const active = createMemoryStore();`). `DATA_MODE`에 따라 `createMemoryStore()` 또는 `createPostgresStore(pool)`을 선택하도록 분기를 추가한다.

**그전까지는 503이 정상이다.** 이 가드를 구현 도중에 미리 열면, PostgreSQL 구현체가 미완성인 상태로 "실 DB"라는 라벨을 달고 조작된 데이터를 내보내게 된다(`docs/implementation_status.md`의 C2 절이 이미 이 위험을 명시했다).

### 10. 최종 확인

`AUTH_MODE=demo DATA_MODE=postgres`로 띄워 브라우저에서 로그인 → 배터리 연결 → 대시보드 → 릴레이 차단까지 끝까지 돌리고, **프로세스를 재시작해도 데이터가 남아 있을 것.** 특히 `engageFailsafe`로 걸린 인터락(`relay_state.interlock_engaged = true`)이 재시작 후에도 유지되어, 그 상태에서 릴레이 복구를 시도하면 `409 INTERLOCK_LOCKED`가 그대로 나와야 한다 — 인메모리 구현체는 프로세스가 죽으면 이 상태가 사라지는 것이 원래 한계였고, **이게 사라지지 않는 것이 Fail-Safe가 실제 안전 기능으로 성립하는 최소 조건**이다.

---

## 2부 — `DeviceCommandPort` (Kafka)

### 11. 무엇을 만드나

`backend/src/device/kafka.ts`에 아래 팩토리 함수를 구현하고, `backend/src/server.ts`가 현재 쓰고 있는 `createLoggingDeviceCommandPort()`(`backend/src/device/logging.ts`) 스텁을 이걸로 교체한다.

```ts
import type { DeviceCommandPort } from "./port.js";

export function createKafkaDeviceCommandPort(/* producer, topic 등 */): DeviceCommandPort { /* ... */ }
```

인터페이스는 `backend/src/device/port.ts`가 정본이며 메서드 4개다 — `relayCut(batteryId, reasonCode)`, `relayRestore(batteryId)`, `sessionStarted(sessionId, batteryId, targetMode)`, `sessionEnded(sessionId, endReason)`. 전부 `battery-events` 토픽으로 발행한다(CLAUDE.md §Kafka 토픽 규약 — `battery-events`는 "에지/백엔드가 발행, 센서 오류·인터락 발생·릴레이 제어 이벤트·음성 안내 대상 이벤트"용). 이 인터페이스는 전송 수단을 모르는 채로 설계돼 있으므로 파일 안에 Kafka 클라이언트 세부사항(브로커 주소, 파티션 키, 직렬화 포맷)을 감춰도 된다 — 도메인 코드(`server.ts`, `failsafeRunner.ts`)는 이 4개 메서드 시그니처만 안다.

### 12. 메시지에 문구를 넣지 않는다

발행하는 페이로드는 `code` + `params`만 담는다(`docs/hardware/mode1_backend_spec.md:787`). 라즈베리파이가 이 `code`로 로컬에 미리 저장된 한국어 음성 파일(MP3/WAV)을 선택해 재생하므로, 서버가 한국어 문장을 조립해서 보내면 안 된다 — CLAUDE.md의 "서버는 사용자에게 보일 문구를 만들지 않는다" 규칙이 여기도 적용된다. 예: `relayCut`은 `{ code: "RELAY_CUT", params: { batteryId, reasonCode } }` 형태로 나가야지, `{ message: "배터리 PACK-001의 릴레이가 차단되었습니다" }` 형태로 나가면 안 된다.

### 13. ⚠️ 미결정 — dual-write 원자성

지금 도메인 코드는 **저장소 커밋 → 그 다음 포트 호출**(예: `changeRelay`가 트랜잭션을 커밋한 뒤 `devicePort.relayCut(...)`을 부르는 순서) 구조다. Kafka 브로커가 그 순간 죽어 있으면 **DB의 릴레이 상태는 이미 바뀌었는데 에지는 그 사실을 영영 모르는** 상태가 된다. `docs/backend_contract.md` §3.4는 *"승인 후 명령 실행과 감사 기록을 원자적으로 처리하고 실패 시 성공 응답이나 성공 이벤트를 내보내지 않는다"*를 요구하므로, 지금 순서 그대로는 계약 위반이다.

**권장 해법은 outbox 테이블이다.** 저장소 트랜잭션 안에서 도메인 상태 변경·`audit_log` INSERT와 **같이** "발행할 메시지"를 `outbox` 테이블에 INSERT한다. 별도 워커 프로세스가 그 테이블을 폴링(또는 `LISTEN/NOTIFY`)해 Kafka로 실제 발행한 뒤 해당 row를 지우거나 `sent_at`을 채운다. 이러면 원자성은 **DB 트랜잭션 하나**로 확보되고(Kafka 발행 실패는 워커가 재시도하면 그만이다), 도메인 코드는 "메시지가 나갔는가"를 신경 쓰지 않아도 된다.

**이 결정은 인프라 담당자가 내리되, 백엔드 담당자와 반드시 합의한다** — outbox를 택하면 도메인 코드의 호출 지점(`changeRelay`, `engageFailsafe` 등이 지금 저장소 커밋 후 직접 `devicePort.*`를 부르는 자리)이 "포트를 직접 부른다"에서 "저장소 트랜잭션 안에서 outbox에 넣는다"로 바뀐다 — 이건 `CellGuardStore` 인터페이스 경계를 넘나드는 변경이라 백엔드 담당자 쪽 코드도 같이 바뀐다.

### 14. Fail-Safe 구독 진입점

Consumer가 `battery-raw-metrics` 프레임을 처리할 때, `backend/src/server.ts`가 내보내는 아래 함수를 프레임마다 부르면 된다.

```ts
export async function runFailsafe(
  batteryId: string,
  profile: HardwareProfile,
  sample: FailsafeSample,
  thresholds: FailsafeThresholds
): Promise<FailsafeVerdict>
```

판정(`judgeFailsafe`)·인터락(`engageFailsafe`)·에지 통보(`devicePort.relayCut`)·WS 푸시(`broadcastAutoCut` → `relay.autoCut`)가 이미 그 안에 배선돼 있다(`backend/src/failsafeRunner.ts`의 `evaluateFailsafe`가 실체). Consumer가 할 일은 프레임마다 이 함수를 호출하는 것뿐이다.

- **`thresholds`는 인자로 받는다.** 현재 값(`backend/src/failsafe.ts`의 `UNSET_THRESHOLDS`)은 전부 `0`(미설정 sentinel)이라 어떤 계층도 차단하지 않는다. 하드웨어 실측 후(`mode1_backend_spec.md` §13 H8, `mode2_powerbank_diagnosis_spec.md` §8 H2) 나온 값을 설정에서 주입한다 — 값을 추정해 미리 채우지 않는다.
- **`sample`(`FailsafeSample`)의 6개 필드**를 프레임에서 채운다: `tempContact`, `tempIrSurface`, `tempRiseRateCPerMin`, `pressureRaw`, `pressureBaseline`, `gasRaw`. 그중 **`pressureBaseline`은 프레임에 없는 값이다** — **세션마다 시작 10초 중앙값으로 새로 계산해 Consumer가 직접 들고 있어야 한다**(CLAUDE.md — FSR은 예압에 따라 baseline이 매번 달라져 절대값이 무의미하다). 세션이 바뀌면 이 값도 다시 계산한다.
- **`profile`(`HardwareProfile`)**은 `"MODE1_EXTERNAL_CELL_V1"` 또는 `"COMBINED_EXISTING_PARTS_V1"`이며, 어느 트리거 코드가 활성인지(`AVAILABLE` 맵, `failsafe.ts:49`)를 결정한다 — 존재하지 않는 센서의 코드는 발생시키지 않는다.

#### 14b. ⚠️ TOCTOU 경합 — Consumer는 배터리별로 `runFailsafe` 호출을 직렬화할 것

`evaluateFailsafe`(`backend/src/failsafeRunner.ts:15-34`)는 "현재 인터락 상태를 읽고(`relayByBattery`) → 안 걸려 있으면 건다(`engageFailsafe`)"는 read-then-act 순서다. 이 사이에 경합 구간(race window)이 있다. **같은 `batteryId`에 대해 `runFailsafe`가 동시에 두 번 이상 호출되면**(예: 두 텔레메트리 프레임이 병렬로 처리되는 경우) 둘 다 "안 걸려 있다"고 읽은 뒤 둘 다 `engageFailsafe`를 부를 수 있다. `engageFailsafe`는 멱등이 아니므로(호출할 때마다 `RELAY_AUTO_CUT` 감사 로그를 새로 남긴다) 이러면 감사 로그가 중복 오염된다.

**Consumer는 같은 `batteryId`에 대한 `runFailsafe` 호출이 절대 겹치지 않도록 직렬화해야 한다** — 배터리별 큐, 배터리별 뮤텍스/락, 또는 파티션 키를 `battery_id`로 잡아 Kafka 파티션 자체가 순서를 보장하게 하는 방법 중 하나를 쓴다. 이건 PostgreSQL의 UNIQUE 제약(§6)처럼 DB가 대신 막아주는 경합이 아니다 — `engageFailsafe` 자체에는 동시 호출을 막는 장치가 없으므로 순전히 호출부(Consumer)의 책임이다.

#### 14c. ⚠️ WS 통보가 조용히 사라질 수 있다 — `broadcastAutoCut` 실패를 반드시 로깅할 것

`runFailsafe`가 넘기는 `onAutoCut` 콜백은 `backend/src/server.ts`에서 아래처럼 fire-and-forget이다.

```ts
onAutoCut: (relay, verdict) => { void broadcastAutoCut(battery, relay, verdict.triggerCode); }
```

`broadcastAutoCut`이 언젠가 reject하면(예: WS `broadcast()` 호출 내부에서 예외가 던져지면) 이건 **unhandled promise rejection**이 되고 어디에도 로깅되지 않는다. 즉 실제 Fail-Safe가 트리거되어 릴레이는 물리적으로 끊겼는데, 대시보드에 뜨는 `relay.autoCut` WS 알림만 아무 흔적 없이 사라질 수 있다 — 릴레이 차단 자체는 `relay_state`·`audit_log`에 남으므로 안전 기능은 정상 동작하지만, 운영자가 화면으로 그 사실을 놓칠 위험이다.

**Consumer를 배선할 때 다음 중 하나를 반드시 한다**:
- `broadcastAutoCut` 호출에 `.catch((err) => console.error("[failsafe] broadcast 실패", err))`를 붙인다, 또는
- `runFailsafe` 호출 지점 자체를 `try/catch`로 감싸고 실패를 로깅한다.

둘 중 아무것도 안 하면 이 갭은 코드 리뷰로도 잘 안 보인다 — `void` 키워드가 "의도적으로 무시함"처럼 읽혀서, 실패 시나리오를 실제로 재현해보기 전까지는 아무도 눈치채지 못한다.

### 15. ⚠️ 미결정 — `sessionEnded` 배선 지점

`DeviceCommandPort.sessionEnded(sessionId, endReason)`을 언제 부를지가 아직 정해지지 않았다. 세션 종료는 라우트 레벨의 명시적 액션이 아니라, `startSession`(새 세션이 이전 세션을 `SUPERSEDED`로 끝낼 때)과 `changeOpsStatus`(배터리를 `BLOCKED`로 바꿔 활성 세션이 강제 종료될 때) **안에서 저장소가 부수적으로 일으키는** 사건이다. 그래서 지금 라우트 코드에는 "세션이 방금 끝났다"를 알 수 있는 훅이 없다.

선택지 세 가지:

1. **저장소에 포트를 주입한다** — `CellGuardStore` 구현체가 `DeviceCommandPort`를 알게 되어, 저장소 계층과 전송 계층이 섞인다.
2. **저장소가 "이번 호출로 종료된 세션 목록"을 반환값에 실어 보내고, 라우트가 그걸 보고 발행한다** — `startSession`/`changeOpsStatus`의 반환 타입이 바뀐다(예: `{ battery, endedSessions: DemoSession[] }`).
3. **§13을 outbox로 정하면 이 문제도 같이 풀린다** — 저장소 트랜잭션 안에서 세션 종료와 함께 `sessionEnded` 메시지를 outbox에 넣기만 하면 되므로, 저장소가 전송 계층을 몰라도 되고 라우트 시그니처도 안 바뀐다.

**13번(dual-write 원자성)을 outbox로 정하면 15번도 자동으로 풀린다.** 두 미결정을 따로 풀지 말고 하나의 설계 결정(outbox 채택 여부)으로 묶어서 백엔드 담당자와 합의하는 것을 권장한다.

---

## 인계 후 남는 것 (요약)

- **PostgreSQL 구현체** — 본 문서 1부. `backend/src/store/postgres.ts` 신규 작성 + 계약 테스트 19건 통과 + FK 결정(§4) + 동시성 테스트(§6) 추가.
- **Kafka 구현체 + outbox 결정** — 본 문서 2부. `backend/src/device/kafka.ts` 신규 작성 + dual-write 원자성 결정(§13, 백엔드와 합의) + `sessionEnded` 배선(§15).
- **Consumer의 `battery_id` 태깅** — `docs/handover/b2-session-tagging.md` (Task 14 산출물, 규칙 5개 확정).
- **Fail-Safe 문턱값** — 하드웨어 실측 후 결정. `mode1_backend_spec.md` §13 H8(압력 baseline·상승률), `mode2_powerbank_diagnosis_spec.md` §8 H2(모드 2 표면온도 상승률). 값이 나오면 `UNSET_THRESHOLDS`를 실제 값으로 바꾸는 것만으로 그 계층이 살아난다 — 코드 변경이 필요 없다.
- **텔레메트리 구독 배선** — `runFailsafe`를 프레임마다 부르는 호출부 자체(§14)는 Consumer가 생긴 뒤 이 문서의 인프라 담당자가 연결한다.
