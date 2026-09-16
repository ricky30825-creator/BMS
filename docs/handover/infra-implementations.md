# 인프라 담당자 인계 명세 — `CellGuardStore`(PostgreSQL) · `DeviceCommandPort`(Kafka)

> 작성일 2026-08-27 (Task 15, 백엔드 인계 계획의 마지막 태스크). 이 문서 하나로 두 구현체의 경계를 함께 정의한다 — 저장소 커밋과 에지 명령 발행이 서로 맞물려 있어서(§13·§14), 따로 인계하면 그 경계가 두 문서에 나뉘어 드리프트가 난다.
>
> 백엔드가 이미 끝낸 것: 비동기 `CellGuardStore` 인터페이스(`backend/src/store/contract.ts`) + 인메모리 구현체(`backend/src/store/memory.ts`) + 계약 테스트 20건, `DeviceCommandPort` 인터페이스(`backend/src/device/port.ts`) + 로깅 스텁(`backend/src/device/logging.ts`), 순수 `judgeFailsafe` 판정 함수(`backend/src/failsafe.ts`) + 그 저장소/에지/WS 배선(`backend/src/failsafeRunner.ts`, `backend/src/server.ts`).
> **2026-09-14 상태 갱신:** `CellGuardStore` PostgreSQL 구현체와 `DATA_MODE` 분기,
> 기동 스키마 검사, DB 없는 환경에서 명확히 skip하는 계약 테스트가 추가됐다.
> **2026-09-14 Raw Consumer 갱신:** `backend/src/telemetryConsumer.ts`가 raw
> 적재·session tagging·수동 offset commit·프레임별 Fail-Safe callback을 구현했다.
> **2026-09-14 Task 3 갱신:** PostgreSQL outbox 원자성과 durable identity/dedupe가
> `store/postgres.ts` 및 `008_outbox_identity.sql`에 구현됐다. 이후 Task 4에서
> outbox delivery worker와 DeviceCommandPort producer도 추가됐고, 이제 남은 것은
> 실 Kafka·DB 인수 검증이다.
> **2026-09-14 Task 4 갱신:** `OutboxWorker`와 Kafka DeviceCommand producer가
> `009_outbox_delivery.sql`의 lease·retry·poison 상태를 사용한다. 실제 Kafka
> broker/Timescale 인수 검증만 남았다.
> **2026-09-16 현재 상태:** migrations `000`~`012`가 연속 적용 대상이다.
> 영속 domain event·관리자 추이, 공지 DB CRUD·대시보드 연결, aggregate PDF,
> Fail-Safe 환경 설정·세션별 압력 baseline 소프트웨어 경로가 구현됐다. 다만
> `TEST_DATABASE_URL` 기반 PostgreSQL 검증과 Docker/Kafka/Timescale 실환경,
> 물리 relay actuation ACK는 미검증이다. Fail-Safe 설정 기본값은 모두 `0`이다.

---

## 1부 — `CellGuardStore` (PostgreSQL)

### 1. 구현 위치와 팩토리

`backend/src/store/postgres.ts`에 아래 팩토리 함수가 구현돼 있다.

```ts
import type pg from "pg";
import type { CellGuardStore } from "../store/contract.js";

export function createPostgresStore(pool: pg.Pool): CellGuardStore { /* ... */ }
```

인터페이스 정본은 `backend/src/store/contract.ts`다. 메서드 시그니처·타입·주석에 적힌 세 가지 규칙(에러는 `throw new Error("<CODE>")`, 반환값 방어 복사, 감사 로그 동반 메서드는 원자적)을 구현체가 지킨다. CSV 조회에는 선택적 `from`·`to` 범위가 추가돼 export job이 DB의 `telemetry_metric`을 직접 읽는다.

### 2. 완료 판정

`backend/src/store/contract.test.ts`에는 아래 호출이 이미 추가돼 있다. `TEST_DATABASE_URL`이 있을 때만 테스트 전용 DB를 초기화하고 계약 테스트 20건을 실행한다.

```ts
runStoreContractTests("postgres", async () => createPostgresStore(testPool));
```

`testPool`은 `TEST_DATABASE_URL`로 지정한 테스트 전용 PostgreSQL 인스턴스다. URL이 없으면 연결하지 않고 명시적 skip 1건만 남긴다. 실제 DB가 제공되면 20건 계약 스위트와 전역 active-session 경합 테스트를 함께 실행한다.

> **✅ 활성 세션 범위는 확정됐다 — 설비 전체에 1개다(2026-08-28).** `backend/src/store/memory.ts:145-146` 주석(*"for the whole installation"*)이 맞고, per-device를 적던 `docs/backend_contract.md` §3.2와 `001`의 `uq_active_session_device`를 이에 맞춰 고쳤다. 근거는 하드웨어다 — BQ27441(0x55)은 I2C 주소가 고정이라 한 번에 배터리 1개만 측정할 수 있다.
>
> **⚠️ 그래도 계약 테스트 20건은 이 차이를 검출하지 못한다.** `contract.test.ts:31-40`의 *"설비 전체에 활성 세션은 하나뿐"* 테스트가 제목과 달리 **같은 사용자·같은 진단기로만** `startSession`을 두 번 부르기 때문에, per-device로 짜도 통과한다. **"20건 통과"만으로는 이 항목이 맞게 구현됐는지 알 수 없으므로**, DB 제약(`uq_active_session_global`, §6)이 실질적인 유일한 방어선이다. 다른 진단기로 두 번째 세션을 여는 테스트를 PostgreSQL 구현체 쪽에 따로 추가한다.

### 3. 스키마

`backend/migrations/001_app_auth.sql`에 8개 테이블이 이미 있다: `app_user_profile`, `audit_log`, `battery_asset`, `measurement_session`, `relay_state`, `telemetry_metric`, `diagnosis`, `idempotency_key`. 컬럼은 `backend/src/store/types.ts`의 도메인 타입에 대응한다 — **다만 완전한 1:1은 아니다**(어긋나는 목록은 `schema-open-questions.md` §0).

**⚠️ 스키마를 바꾸면 `store/types.ts`도 같이 바뀐다.** 마이그레이션과 타입 정의는 한 쌍이므로, 컬럼을 추가·삭제·이름 변경하기 전에 반드시 백엔드 담당자와 합의한다. 합의 없이 한쪽만 바꾸면 타입은 컴파일되는데 런타임에서 컬럼이 없어 조용히 깨지거나, 반대로 타입에 없는 컬럼이 방치된다.

> **✅ 비어 있던 스키마와 진단 진행 스냅샷은 마이그레이션에 반영됐다** — 추론 결과 적재 테이블(`anomaly_score`), `age_ms`·`temp_points`·`mode`·`soc_basis`, TimescaleDB 하이퍼테이블, 진단기(`device`) 테이블, 중복 방지 키, `battery_asset.memo`는 `migrations/002`~`005`에, `diagnosis.progress_snapshot`은 `006`에, `telemetry_metric.raw_payload`는 `007`에 있다. 결정 기록과 "왜 그 안이었나"는 [`docs/handover/schema-open-questions.md`](schema-open-questions.md)에 있다.
>
> **기존 14개 테이블에 migration 010~012가 5개를 더했다** — `domain_event`, `notice`, `notice_view`, `notice_delivery_intent`, `failsafe_pressure_baseline`. `device`에는 Fail-Safe 프로필 제약도 반영된다.

> `battery_latest`·`battery_health`·`anomaly_score`는 기존 `DemoBattery`와 `mode1Health` 화면 매핑에 쓰인다. `telemetry_metric`은 Raw CSV와 `/api/trends` 집계를 제공하며 PDF도 같은 aggregate 경로를 사용한다. `domain_event`는 관리자 이벤트 추이의 영속 원천이다.

### 3-1. 처음 DB를 올리는 순서 — **막힘은 2026-08-28에 해소됐다**

> **예전 서술**: 2단계(Better Auth 코어 스키마)에서 멈추고 §4의 선택지를 먼저 골라야 했다.
> **지금**: `000_identity.sql`이 `"user"` 테이블을 직접 만들고 데모 4명을 seed하므로 1~3단계가 명령 하나로 끝난다(§4). provider와 게이트 배선은 구현됐고, 남은 것은 실제 DB 인수 검증이다.

| 단계 | 하는 일 | 상태 |
|---|---|---|
| 1 | PostgreSQL **+ TimescaleDB 확장** 설치, DB·계정 생성, `backend/.env`의 `DATABASE_URL` 설정 | ✅ 문서만으로 됨 (`backend/.env.example`) |
| 2 | `npm run db:migrate` — `migrations/*.sql`을 연속된 번호 순서대로 적용 | ✅ 실행기 있음 (`backend/scripts/migrate.mjs`); advisory lock·TimescaleDB 사전/사후 확인 포함 |
| 3 | `psql`로 테이블 생성 확인 | ✅ 마이그레이션 적용 확인 수단 |
| 4 | `backend/src/store/postgres.ts` 구현 (§1) | ✅ 구현 완료(2026-09-14) |
| 5 | `DATA_MODE` 게이트 열기 (§9) | ✅ 구현 완료(2026-09-14) |
| 6 | `TEST_DATABASE_URL`로 계약·동시성·재시작 검증 | 실 DB 인수 환경에서 수행 |

**마이그레이션 13개 파일** — 순서가 곧 의존성이다.

| 파일 | 내용 |
|---|---|
| `000_identity.sql` | `"user"` 테이블 + 데모 4명 seed. **001의 FK 4개가 이걸 전제한다** |
| `001_app_auth.sql` | 기존 8개 테이블 (**수정하지 않는다** — 백엔드의 기준 파일) |
| `002_domain_gaps.sql` | `app_user_profile` seed, `battery_asset.memo`, 활성 세션 전역 제약 교체, `device` 테이블 |
| `003_telemetry_columns.sql` | `age_ms`·`temp_points`(jsonb) + `mode`·`soc_basis` |
| `004_anomaly_and_health.sql` | `anomaly_score`, `battery_latest`, `battery_health`, `outbox` |
| `005_timescale.sql` | PK 교체 + 하이퍼테이블 2개 + 보존 60일 |
| `006_diagnosis_progress_snapshot.sql` | 진단 phase 경계 복구용 `progress_snapshot jsonb` |
| `007_telemetry_raw_payload.sql` | version-1 edge raw payload 보존용 `raw_payload jsonb` |
| `008_outbox_identity.sql` | outbox durable `event_id`, replay `dedupe_key`와 유일성 제약 |
| `009_outbox_delivery.sql` | outbox lease·retry 시각·claim token·poison `dead_at` |
| `010_domain_events.sql` | 영속 `domain_event`와 replay dedupe |
| `011_notices.sql` | 공지, 사용자별 조회 dedupe, delivery intent |
| `012_failsafe_profile_and_baseline.sql` | `MODE2_FULL` 프로필 제약과 세션별 pressure baseline |

> **TimescaleDB는 필수다.** `005` 또는 migration runner의 extension/hypertable
> 확인이 실패하면 `TIMESCALEDB_REQUIRED`로 전체 PostgreSQL 경로를 닫는다.
> `telemetry_metric`을 평범한 PostgreSQL 테이블로 사용하거나 memory 데이터로
> 대체하지 않는다. `DATA_MODE=postgres`를 열려면 TimescaleDB를 설치한 뒤
> `npm run db:migrate`가 `012`까지 완료되고 두 hypertable 확인을 통과해야 한다.

**예전에 2단계를 막던 것과, 어떻게 풀었는지:**

- **`"user"` 테이블 DDL이 없었다.** `001`은 첫 테이블부터 그걸 FK로 참조하는데(`:2`·`:22`·`:40`·`:65`) 만드는 DDL이 저장소 어디에도 없어 `relation "user" does not exist`로 첫 구문에서 멈췄다. → **`000_identity.sql`이 만든다.**
- **`npm run auth:generate`가 동작하지 않았다.** `better-auth` 패키지는 `bin`을 제공하지 않고 CLI는 별도 패키지 `@better-auth/cli`인데 설치돼 있지 않다. → **Better Auth를 지금 쓰지 않기로 해서(2026-08-28) 이 명령이 경로에서 빠졌다.** `package.json:14`의 `auth:generate`·`auth:migrate` 스크립트는 아직 그대로 남아 있으니 부르지 말 것. Better Auth를 켤 때 `@better-auth/cli`를 설치하면 그때 살아난다.

> **마이그레이션 실행기는 `backend/scripts/migrate.mjs`다(`npm run db:migrate`).** psql에 의존하지 않는다 — 호스트 PC는 Windows이고 개발 장비는 macOS라, 이미 의존성에 있는 `pg`로 도는 편이 양쪽에서 똑같이 동작한다. 적용한 파일은 `schema_migrations`에 기록되어 다시 실행되지 않고, 파일 하나가 트랜잭션 하나다. `start-local.bat`은 여전히 DB를 건드리지 않으므로 이 명령은 손으로 돌린다.

> **PostgreSQL 모드에서는 기동 전에 앱이 DB 스키마를 확인한다.** `store.ts`가
> `DATA_MODE`에 따라 provider를 선택하고, `initializeStore()`가 핵심 테이블과
> `progress_snapshot`을 확인한다. 검사가 실패하면 memory 데이터로 대체하지 않고
> 기동을 중단한다. DB 없는 기본 시연은 `DATA_MODE=memory`로 실행한다.

### 4. 외래키 문제 — **결정 완료 (2026-08-28)**

> **결정: (a)의 변형.** Better Auth는 지금 쓰지 않되, `"user"`라는 **이름과 자리를 우리가 선점**한다 — `000_identity.sql`이 Better Auth 코어 user 스키마와 같은 모양으로 테이블을 만들고 데모 4명을 seed한다. FK 4개는 그대로 살아 있고 `001`은 한 글자도 고치지 않는다. 나중에 Better Auth를 켜면 `session`·`account`·`verification` 3개만 추가하면 되고, 컬럼명이 어긋나면 `ALTER` 한 번으로 끝난다.
>
> **(b)(FK 제거)는 택하지 않았다** — DB가 고아 row를 막지 못하게 되고, 나중에 FK를 되살리는 비용이 더 크다.
>
> 아래는 그 결정의 근거가 된 원래 서술이다.

`battery_asset.owner_user_id`와 `measurement_session.owner_user_id`가 `not null references "user"(id)`인데, `"user"` 테이블은 Better Auth 코어 스키마라 **아직 생성되지 않았다**(§3-1). 반면 데모 사용자 `hong`·`kimeng`·`leelab`·`parktest`(각각 USER/USER/ADMIN/SUSPENDED, `backend/src/store/memory.ts:30-33`)는 인메모리 구현체 안에만 존재한다. `AUTH_MODE=demo DATA_MODE=postgres`로 띄우는 순간 이 4명으로 `battery_asset`에 INSERT를 시도하면 FK 위반으로 전부 실패한다.

두 선택지 중 하나를 반드시 고른다 — 아무것도 안 고르면 첫 배터리 등록에서 막힌다.

- **(a) 권장.** Better Auth 스키마를 생성·적용한 뒤(`npm run auth:generate` — ⚠️ **아래 경고를 먼저 읽을 것**), `AUTH_MODE=demo`로 부팅할 때 데모 4명을 `user`+`app_user_profile`에 `on conflict do nothing`으로 seed한다. 참조무결성이 그대로 유지되고, 나중에 `AUTH_MODE=betterauth`로 전환해도 스키마를 다시 안 건드린다.
- **(b) 대안.** 두 FK(`battery_asset.owner_user_id`, `measurement_session.owner_user_id`)를 제거하고 `text` 컬럼으로 둔다. 선행 작업이 없어 더 빠르지만, DB가 고아 row(존재하지 않는 owner_user_id)를 더 이상 막지 못한다.

> **⚠️ `npm run auth:generate`는 지금 그대로는 실패한다(§3-1).** `backend/package.json:14`가 `"auth:generate": "auth generate"`인데 `auth` 바이너리가 없다 — `better-auth` 패키지는 `bin`을 제공하지 않고, CLI는 **별도 패키지 `@better-auth/cli`**다. 현재 `backend/node_modules/.bin`에도 `dependencies`/`devDependencies` 어디에도 없다(`@better-auth/core`·`drizzle-adapter`만 설치돼 있다). **(a)를 택했다면 `@better-auth/cli` 설치가 선행돼야 한다.** `backend/README.md`의 Local Setup 5단계도 같은 명령을 안내하므로 함께 어긋나 있다.

이 결정은 인프라 담당자가 내리되, 마이그레이션 파일을 고치는 쪽이므로 백엔드 담당자에게 어느 쪽을 택했는지 알린다.

### 5. 반드시 한 트랜잭션에 넣어야 하는 메서드 6개

`changeRelay`, `engageFailsafe`, `changeOpsStatus`, `saveMemo`, `changeUserStatus`, `startSession`. 전부 도메인 상태 변경 + `audit_log` 쓰기를 함께 하며, `docs/backend_contract.md` §3.4가 *"승인 후 명령 실행과 감사 기록을 원자적으로 처리하고 실패 시 성공 응답이나 성공 이벤트를 내보내지 않는다"*를 요구한다. `backend/src/store/postgres.ts`의 transaction helper를 쓴다 — `pool.connect()` → `begin` → `fn(client)` → `commit`/실패 시 `rollback` → `release`를 감싼다. 팩토리가 테스트용 pool도 받을 수 있어 전역 `db.ts` helper를 직접 호출하지 않는다.

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
unique (status)     where status = 'ACTIVE'    -- measurement_session (전역 1개, 002)
unique (battery_id) where status = 'RUNNING'   -- diagnosis
```

> `measurement_session` 쪽은 **`uq_active_session_global`**이다. `status` 컬럼에 partial unique를 걸면 인덱스에 들어오는 행이 전부 `ACTIVE`라 그런 행이 최대 1개가 된다 — 001의 per-device 제약을 이 결정으로 교체했다.

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

### 8-1. `advanceDiagnosis`의 `progress` — **결정: ㉰ phase 경계 스냅샷 (2026-09-14)**

**이 문서가 여태 한 번도 다루지 않은 메서드다.** 스토어 계약에는 있다:

```ts
// backend/src/store/contract.ts:66
advanceDiagnosis(id: string, phase: string, progress: DiagnosisProgress): Promise<DemoDiagnosis>;
```

`diagnosis`에 `progress_snapshot jsonb`를 추가하는 `006_diagnosis_progress_snapshot.sql`을
적용한다. 인메모리 구현체와 PostgreSQL provider 모두 호출 중 최신 progress를
런타임 메모리에 유지하고, PostgreSQL은 phase가 바뀌는 순간에만 스냅샷을 쓴다.

`DiagnosisProgress`(`backend/src/store/types.ts:67`)는 진행 중 진단의 작업 상태다 — 단계별 집계 창(`windows`: 전압 원자료 배열 + 온도 샘플 배열), 안전 판정용 롤링 온도 창(`tempTrail`), 누적 Wh, 부분 지표. **완료 결과(`result`)와 달리 완료되면 버려지는 값이다.**

**실측 (빠른 진단 1회, 1초 tick, 2026-09-02)**

| 항목 | 값 |
|---|---|
| `advanceDiagnosis` 호출 횟수 | **179회** (진단 1회당) |
| 마지막 tick의 `progress` 직렬화 크기 | **7.6KB** |
| 세션 1회 누적 기록량(매 tick 저장 시) | **813KB** |

⚠️ **이건 1초 tick 기준이다.** 에지·Kafka consumer가 **100ms 프레임**을 넣기 시작하면 tick 수도, 창당 샘플 수도 10배가 된다. 같은 경고가 `runner.ts`의 `appendTempSample`에도 붙어 있다(창을 개수가 아니라 시간으로 트리밍하는 이유).

> 참고: 2026-09-02에 빠른 진단에 P7(발열 탐침) 구간이 추가되며 총 시간이 120초 → 180초가 됐다. 위 수치는 그 이후 값이며, 이전 대비 약 1.5배다.

**결정된 동작**

| 안 | 내용 | 대가 |
|---|---|---|
| **㉰ 단계 전환에서만 쓴다** | 창을 메모리에 들고, `phase`가 바뀌는 순간에만 `progress_snapshot` 저장 | 쓰기가 179회 → **7회**로 준다. 재시작 시 마지막 단계 경계까지 복구된다 |

**결정에 필요한 사실 3가지**

1. **`progress`는 완료 결과가 아니다.** 이력·리포트가 읽는 건 `result`(§4.13 `Diagnosis` 객체)뿐이고, `progress`는 완료 시점에 버려진다. 즉 **영속성이 필요한 이유는 "재시작 복구" 하나뿐**이다.
2. **`WebSocket diagnosis.progress` 이벤트는 단계 전환에서만 나간다**(`docs/backend_contract.md` §5). 매 tick 저장이 실시간 전송 때문에 필요한 것은 아니다.
3. **`result`는 `jsonb`라 이번에 추가된 원값 3개(`thermalProbeLoadA`·`thermalPerWattCPerMinPerW`·`recoverySlopeCPerMin`)는 마이그레이션이 필요 없다.** 다만 그 자산의 첫 `QUICK` 값을 기준선으로 뽑으려면(스펙 §8 H21 ②) `result->'quick'->>'thermalPerWattCPerMinPerW'` 경로 조회가 되고 **인덱스가 없다.** 기준선을 `battery_asset` 컬럼으로 승격할지가 H21 ②의 실질적 내용이다.

### 9. 게이트를 여는 시점

구현 완료 후 두 지점이 다음처럼 열려 있다:

- `backend/src/server.ts`의 `app.use("/api", ...)` DATA_MODE 가드는 `memory`와 `postgres` provider를 통과시킨다. PostgreSQL은 listen 전에 `initializeStore()`가 스키마를 확인한다.
- `backend/src/store.ts`(facade)는 `DATA_MODE`에 따라 `createMemoryStore()` 또는 `createPostgresStore(pool)`을 선택한다.

스키마가 불완전하거나 DB 연결이 실패하면 서버가 시작되지 않는다. 이 fail-closed
경로가 PostgreSQL provider의 memory fallback을 막는다.

### 10. 최종 확인

`AUTH_MODE=demo DATA_MODE=postgres`로 띄워 브라우저에서 로그인 → 배터리 연결 → 대시보드 → 릴레이 차단까지 끝까지 돌리고, **프로세스를 재시작해도 데이터가 남아 있는지 확인한다.** 특히 `engageFailsafe`로 걸린 인터락(`relay_state.interlock_engaged = true`)이 재시작 후에도 유지되어, 그 상태에서 릴레이 복구를 시도하면 `409 INTERLOCK_LOCKED`가 그대로 나와야 한다. 이 실제 DB 인수 시나리오는 `TEST_DATABASE_URL`을 제공하는 환경에서 수행할 최종 확인으로 남아 있다.

---

## 2부 — `DeviceCommandPort` (Kafka)

### 11. 무엇을 만들었나

`backend/src/device/kafka.ts`에 KafkaJS producer를 구현하고,
`backend/src/outboxWorker.ts`에 PostgreSQL transactional outbox delivery worker를
구현했다. `backend/src/server.ts`는 PostgreSQL + `KAFKA_ENABLED=true`일 때만
worker를 시작하고, memory 경로에서는 기존 logging stub을 유지한다.

```ts
import type { DeviceCommandPort } from "./port.js";

export function createKafkaDeviceCommandPort(/* producer, topic 등 */): DeviceCommandPort { /* ... */ }
```

인터페이스는 `backend/src/device/port.ts`가 정본이며 메서드 4개다 — `relayCut(batteryId, reasonCode)`, `relayRestore(batteryId)`, `sessionStarted(sessionId, batteryId, targetMode)`, `sessionEnded(sessionId, batteryId, endReason)`. 전부 `battery-events` 토픽으로 발행한다. 이 단계에서 타입이 고정하는 것은 백엔드→에지 outbound 4종이며, 공유 토픽의 에지 센서 오류·`DIAG_*` 이벤트 전체를 이 인터페이스가 대표하지 않는다. `sessionEnded`의 `batteryId`는 세션 행에서 가져와 outbox payload와 Kafka 파티션 키에 함께 넣는다. 이 인터페이스는 전송 수단을 모르는 채로 설계돼 있으므로 파일 안에 Kafka 클라이언트 세부사항(브로커 주소, 파티션 키, 직렬화 포맷)을 감춰도 된다 — 도메인 코드(`server.ts`, `failsafeRunner.ts`)는 이 4개 메서드 시그니처만 안다.

> **Kafka wire contract와 실행 설정 골격은 1단계에서 마련됐다.** `backend/src/kafka.ts`가 `version: 1`·세 토픽·Zod payload·파티션 키 규칙을 고정하고, `backend/package.json`은 `kafkajs`를 의존성으로 둔다. `backend/.env.example`과 `backend/src/config/env.ts`에는 `KAFKA_*` 값이 있으며, Consumer는 `KAFKA_CONSUMER_ENABLED`, DeviceCommand outbox worker는 `KAFKA_ENABLED`를 별도 gate로 사용한다.
>
> **즉 §9의 "건드리지 말 것" 두 지점과 달리 `backend/src/config/env.ts`는 고쳐야 한다.** 브로커 주소와 배포별 topic alias는 이 스키마에 두고(`DATABASE_URL`과 같은 방식), canonical topic 이름·payload 검증·파티션 키 규칙은 `backend/src/kafka.ts`에서 유지한다. 백엔드 파일이므로 변경 사실을 백엔드 담당자에게 알린다.

### 12. 메시지에 문구를 넣지 않는다

발행하는 페이로드는 `code` + `params`만 담는다(`docs/hardware/mode1_backend_spec.md:787`). 라즈베리파이가 이 `code`로 로컬에 미리 저장된 한국어 음성 파일(MP3/WAV)을 선택해 재생하므로, 서버가 한국어 문장을 조립해서 보내면 안 된다 — CLAUDE.md의 "서버는 사용자에게 보일 문구를 만들지 않는다" 규칙이 여기도 적용된다. 예: `relayCut`은 `{ code: "RELAY_CUT", params: { batteryId, reasonCode } }` 형태로 나가야지, `{ message: "배터리 PACK-001의 릴레이가 차단되었습니다" }` 형태로 나가면 안 된다.

### 13. dual-write 원자성 — **결정: outbox 채택 (2026-08-28)**

> **`outbox` 테이블은 이미 만들었다**(`migrations/004_anomaly_and_health.sql`). 도메인 트랜잭션 안에서 상태 변경·`audit_log` INSERT와 **함께** 발행할 메시지를 여기 넣고, 별도 워커가 발행 후 `sent_at`을 채운다.
>
>
> **2026-09-14 구현:** `store/postgres.ts`가 `SESSION_STARTED`, `SESSION_ENDED`,
> `RELAY_CUT`, `RELAY_RESTORE` payload를 상태·감사 INSERT와 같은 transaction에서
> 기록한다. Fail-Safe는 `RELAY_AUTO_CUT` 감사와 wire `RELAY_CUT`을 함께 남긴다.
> `008_outbox_identity.sql`의 `event_id`는 durable command identity이고,
> `dedupe_key`는 relay Idempotency-Key replay를 포함한 중복 방지 근거다.
> PostgreSQL server 경로는 commit 뒤 `DeviceCommandPort`를 호출하지 않으며,
> memory 경로는 기존 logging port를 유지한다.
>
> 아래는 그 결정의 근거가 된 원래 서술이다.

지금 도메인 코드는 **저장소 커밋 → 그 다음 포트 호출**(예: `changeRelay`가 트랜잭션을 커밋한 뒤 `devicePort.relayCut(...)`을 부르는 순서) 구조다. Kafka 브로커가 그 순간 죽어 있으면 **DB의 릴레이 상태는 이미 바뀌었는데 에지는 그 사실을 영영 모르는** 상태가 된다. `docs/backend_contract.md` §3.4는 *"승인 후 명령 실행과 감사 기록을 원자적으로 처리하고 실패 시 성공 응답이나 성공 이벤트를 내보내지 않는다"*를 요구하므로, 지금 순서 그대로는 계약 위반이다.

**권장 해법은 outbox 테이블이다.** 저장소 트랜잭션 안에서 도메인 상태 변경·`audit_log` INSERT와 **같이** "발행할 메시지"를 `outbox` 테이블에 INSERT한다. 별도 워커 프로세스가 그 테이블을 폴링(또는 `LISTEN/NOTIFY`)해 Kafka로 실제 발행한 뒤 해당 row를 지우거나 `sent_at`을 채운다. 이러면 원자성은 **DB 트랜잭션 하나**로 확보되고(Kafka 발행 실패는 워커가 재시도하면 그만이다), 도메인 코드는 "메시지가 나갔는가"를 신경 쓰지 않아도 된다. 이 저장소 배선과 identity/dedupe는 위 구현으로 닫혔고, 실제 producer/worker는 다음 담당 범위다.

**이 결정은 인프라 담당자가 내리되, 백엔드 담당자와 반드시 합의한다** — 완료된 구현은 도메인 저장소가 outbox에만 기록하고, producer/worker가 commit 이후 실제 Kafka 발행을 담당한다.

### 14. Fail-Safe 구독 진입점

`RawMetricsConsumer`가 `battery-raw-metrics` 프레임을 DB transaction으로
처리한 뒤 `onDurableFrame` callback을 호출한다. 현재 서버 wiring은 이 callback에서
`backend/src/server.ts`의 `runFailsafe`를 부른다.

```ts
export async function runFailsafe(
  batteryId: string,
  profile: HardwareProfile,
  sample: FailsafeSample,
  thresholds: FailsafeThresholds
): Promise<FailsafeVerdict>
```

판정(`judgeFailsafe`)·인터락(`engageFailsafe`)은 `backend/src/failsafeRunner.ts`의 `evaluateFailsafe`가 수행한다. PostgreSQL에서는 상태·감사·`RELAY_CUT` outbox를 원자 기록한 직후 WS를 보내지 않는다. 별도 `OutboxWorker`가 `FAILSAFE_*` 사유와 `failsafe-relay-cut:<batteryId>:<reasonCode>:` dedupe identity가 맞는 command를 Kafka에 발행하고 `sent_at` ACK까지 기록한 뒤 `relay.autoCut`을 한 번 발신한다. 이 ACK는 브로커 전달 확인이며 실물 relay actuation ACK가 아니다(Task 7). memory demo는 `DeviceCommandPort` 성공 뒤 기존 WS를 발신한다. Consumer는 callback을 battery별로 직렬화하며, callback과 DB transaction이 끝난 뒤에만 Kafka offset을 commit한다.

#### 14a. Consumer 프로세스 경계 — **결정: backend 프로세스에 embedded (2026-09-14)**

> **Raw Consumer를 backend 프로세스 안에서 명시적으로 시작한다.** `telemetryConsumer.ts`는 `server.ts`를 import하지 않고 callback을 주입받으므로 HTTP server의 module side effect나 `EADDRINUSE`가 없다. startup/shutdown은 `DATA_MODE=postgres` + `KAFKA_CONSUMER_ENABLED=true`에서만 배선한다.
>
> `KAFKA_ENABLED=true`도 함께 요구하며, invalid configuration은 HTTP listen 전에 실패한다. memory/test mode에서는 Kafka client를 만들거나 connect하지 않는다.
>
> 아래는 그 결정의 근거가 된 원래 서술이다.

**`runFailsafe`를 별도 프로세스에서 `import`하면 서버가 하나 더 뜬다.** `backend/src/server.ts:1233`이 이 함수를 export하는데, **같은 파일 톱레벨 `:1249`에 `httpServer.listen(env.PORT, ...)`이 있다.** ES 모듈은 import 시 톱레벨이 실행되므로 `import { runFailsafe } from "./server.js"` 한 줄에 두 번째 HTTP 서버가 같은 포트로 뜨고 `EADDRINUSE`가 난다.

그런데 `docs/handover/b2-session-tagging.md` 헤더는 Consumer를 *"대상 구성요소: Kafka Consumer (인프라 코드) — **이 저장소 밖**"*으로 규정하고, CLAUDE.md 아키텍처 그림도 Consumer를 백엔드와 별개 상자로 그린다. **두 서술이 그대로는 양립하지 않는다.**

선택지 세 가지 — **아무것도 고르지 않으면 §14를 구현할 수 없다**:

1. **Consumer를 백엔드 프로세스 안에서 돌린다.** 코드 변경이 가장 적다(같은 모듈이라 그냥 부르면 된다). 대신 적재 부하와 API 서빙이 한 프로세스를 공유하고, Consumer가 죽으면 API도 같이 죽는다.
2. **`runFailsafe`를 `server.ts` 밖으로 뺀다** — 예: `backend/src/failsafeEntry.ts`. 순수 로직은 이미 `failsafe.ts`·`failsafeRunner.ts`에 분리돼 있고 `server.ts:1233`은 저장소·포트·WS를 묶는 얇은 래퍼일 뿐이라, 그 래퍼만 옮기면 된다. **백엔드 파일을 고치는 일이므로 합의 대상이다.**
3. **Consumer가 HTTP로 백엔드를 부른다.** 프로세스가 완전히 분리되지만 프레임마다 왕복이 생겨 100ms 주기에 부담이고, 새 내부 엔드포인트가 필요하다(계약에 없다).

**embedded wiring을 채택한다** — 현재 요청이 backend startup/shutdown과 기존 server safety/WS hook을 같은 프로세스에서 닫도록 명시하기 때문이다.

- **`thresholds`는 Raw Consumer에 전용 환경 설정으로 전달한다.** `FAILSAFE_TEMP_CONTACT_CAP_C`, `FAILSAFE_TEMP_IR_CAP_C`, `FAILSAFE_TEMP_RISE_RATE_C_PER_MIN`, `FAILSAFE_PRESSURE_RISE_PCT`, `FAILSAFE_GAS_RAW` 다섯 값은 기본 `0` sentinel이라 계층별 차단을 비활성화한다. 하드웨어 실측·승인 전에는 값을 활성화하지 않는다.
- **`sample`(`FailsafeSample`)에는** `tempContact`, `tempIrSurface`, `tempRiseRateCPerMin`, `pressureRaw`, `pressureBaseline`, `gasRaw`가 있다. `pressureBaseline`은 edge 프레임에 없으며 DB의 세션별 baseline 상태에서 읽는다.
- mode1 pressure baseline은 `failsafe_pressure_baseline`에 세션별로 영속화된다. 최초 10초 sample 중앙값을 한 번 고정하고, baseline `<500`이면 `PRESSURE_SENSOR_ATTACHMENT_INVALID` domain event를 기록한 뒤 그 세션의 압력 계층을 비활성화한다. 이 규칙은 세션 간 baseline 재사용을 막는다.
- **`profile`(`HardwareProfile`)**은 `"MODE1_EXTERNAL_CELL_V1"`, `"MODE2_FULL"` 또는 `"COMBINED_EXISTING_PARTS_V1"`이며, 어느 트리거 코드가 활성인지(`AVAILABLE` 맵)를 결정한다 — 존재하지 않는 센서의 코드는 발생시키지 않는다.

#### 14b. ⚠️ TOCTOU 경합 — Consumer는 배터리별로 `runFailsafe` 호출을 직렬화할 것

`evaluateFailsafe`(`backend/src/failsafeRunner.ts:15-34`)는 "현재 인터락 상태를 읽고(`relayByBattery`) → 안 걸려 있으면 건다(`engageFailsafe`)"는 read-then-act 순서다. 이 사이에 경합 구간(race window)이 있다. **같은 `batteryId`에 대해 `runFailsafe`가 동시에 두 번 이상 호출되면**(예: 두 텔레메트리 프레임이 병렬로 처리되는 경우) 둘 다 "안 걸려 있다"고 읽은 뒤 둘 다 `engageFailsafe`를 부를 수 있다. `engageFailsafe`는 멱등이 아니므로(호출할 때마다 `RELAY_AUTO_CUT` 감사 로그를 새로 남긴다) 이러면 감사 로그가 중복 오염된다.

**구현은 `RawMetricsConsumer`의 battery-keyed Promise queue다.** DB 적재는 transaction으로 각자 수행하되, 기존 `evaluateFailsafe`의 read-then-act hook은 같은 `batteryId`에서 겹치지 않는다. 이건 PostgreSQL의 UNIQUE 제약처럼 DB가 대신 막아주는 경합이 아니다.

#### 14c. Fail-Safe WS와 전달 확인의 경계

memory demo는 `DeviceCommandPort` 성공 뒤 기존 `relay.autoCut` 동작을 유지한다. PostgreSQL 경로는 평가/DB commit 시점에 WS를 보내지 않는다. `OutboxWorker`가 `FAILSAFE_*` 사유의 `RELAY_CUT`을 Kafka에 발행하고 DB `sent_at` ACK까지 성공한 뒤 `relay.autoCut`을 발신한다. publish/retry/poison/ACK 실패에는 WS를 보내지 않으며, WS callback 실패는 event identity와 함께 로그로 남기고 이미 ACK된 command를 재발행하지 않는다. 수동 `RELAY_CUT`은 자동 차단 WS로 취급하지 않는다.

Kafka publish와 outbox `sent_at` ACK는 브로커 전달까지만 확인한다. Edge consumer가 command를 처리했거나 GPIO 릴레이가 물리적으로 OPEN 됐다는 확인이 아니며, 실제 relay actuation ACK와 Raspberry Pi 인수는 Task 7 범위로 남는다.

### 15. `sessionEnded` 배선 지점 — **결정: 3번(outbox)으로 함께 해결 (2026-08-28)**

> §13을 outbox로 정했으므로 이 항목도 같이 닫혔다. `startSession`의
> SUPERSEDED 종료와 `changeOpsStatus(BLOCKED)`의 세션 종료는 세션 행의
> `battery_id`를 포함한 `SESSION_ENDED` 메시지를 같은 transaction에 넣는다.
> 저장소가 전송 계층을 알 필요도 라우트 시그니처가 바뀔 필요도 없다.
> 워커는 그 `batteryId`를 파티션 키로 사용한다. 세션 종료 outbox는 신규
> `SESSION_STARTED`보다 먼저 삽입되며, 모드/배터리 전환이면 이전 릴레이
> `RELAY_CUT`이 그보다 먼저 삽입된다.
>
> 아래는 그 결정의 근거가 된 원래 서술이다.

`DeviceCommandPort.sessionEnded(sessionId, batteryId, endReason)`을 언제 부를지가 아직 정해지지 않았다. 세션 종료는 라우트 레벨의 명시적 액션이 아니라, `startSession`(새 세션이 이전 세션을 `SUPERSEDED`로 끝낼 때)과 `changeOpsStatus`(배터리를 `BLOCKED`로 바꿔 활성 세션이 강제 종료될 때) **안에서 저장소가 부수적으로 일으키는** 사건이다. 그래서 지금 라우트 코드에는 "세션이 방금 끝났다"를 알 수 있는 훅이 없다. 다만 payload의 `batteryId`는 종료되는 세션 행에서 확정한다.

선택지 세 가지:

1. **저장소에 포트를 주입한다** — `CellGuardStore` 구현체가 `DeviceCommandPort`를 알게 되어, 저장소 계층과 전송 계층이 섞인다.
2. **저장소가 "이번 호출로 종료된 세션 목록"을 반환값에 실어 보내고, 라우트가 그걸 보고 발행한다** — `startSession`/`changeOpsStatus`의 반환 타입이 바뀐다(예: `{ battery, endedSessions: DemoSession[] }`).
3. **§13을 outbox로 정하면 이 문제도 같이 풀린다** — 저장소 트랜잭션 안에서 세션 종료와 함께 `sessionEnded` 메시지를 outbox에 넣기만 하면 되므로, 저장소가 전송 계층을 몰라도 되고 라우트 시그니처도 안 바뀐다.

**13번(dual-write 원자성)을 outbox로 정하면 15번도 자동으로 풀린다.** 두 미결정을 따로 풀지 말고 하나의 설계 결정(outbox 채택 여부)으로 묶어서 백엔드 담당자와 합의하는 것을 권장한다.

### 16. Outbox delivery worker — **구현 완료 (2026-09-14)**

`backend/src/outboxWorker.ts`의 `OutboxWorker`는 PostgreSQL outbox를
`FOR UPDATE SKIP LOCKED`로 claim한다. claim query의 `NOT EXISTS` 조건은
같은 `partition_key`의 더 오래된 미전송·비-poison row를 선행 blocker로
취급하므로, 앞 row가 retry backoff 또는 다른 worker lease 중일 때 뒤
명령을 건너뛰지 않는다. 다른 배터리 파티션은 같은 batch에서 진행한다.

claim에는 worker별 `claim_token`과 만료 `lease_until`이 붙고, worker 시작 시
만료 claim을 해제해 재시작 복구를 수행한다. publish 실패는 `sent_at`을
건드리지 않고 `attempts`, `last_error`, `next_attempt_at`을 갱신한다.
publish 성공 뒤에만 `sent_at`을 기록하며, 그 사이 프로세스가 죽으면
at-least-once 재발행이 가능하다.

Kafka record는 payload를 version-1 `code + params` 그대로 JSON 직렬화하고,
`params.batteryId`를 key로 사용한다. 008의 durable `event_id`는
`x-cellguard-event-id` header로 전달돼 edge가 replay를 멱등 처리할 수 있다.
payload·topic·partition key가 계약과 맞지 않는 row는 `dead_at`과 `POISON:`
오류로 보존하고 `sent_at`은 null로 남겨 해당 배터리의 후속 명령을 막지
않는다. 서버는 PostgreSQL + `KAFKA_ENABLED=true`이고 test가 아닐 때만
worker를 시작하며, memory/test 경로는 Kafka client를 만들거나 연결하지
않는다.

---

## 인계 후 남는 것 (요약)

> **2026-09-16 현재 상태** — PostgreSQL store·Raw/Anomaly Consumer·outbox worker와
> 영속 domain event·공지·관리자 추이·aggregate PDF·Fail-Safe software wiring이
> 구현됐다. 남은 것은 TEST_DATABASE_URL을 이용한 실 DB 계약/동시성 검증과
> Docker/Kafka/Timescale·물리 relay 인수다.

- ✅ **스키마** — `migrations/000`~`012`, `npm run db:migrate`로 적용. 결정 근거는 `schema-open-questions.md`와 §13·§16.
- ✅ **PostgreSQL 구현체** — 본 문서 1부. `backend/src/store/postgres.ts`, 계약 테스트 wiring, 전역 active-session unique 경합 테스트를 추가했다. `TEST_DATABASE_URL`이 없으면 실제 DB 테스트는 명시적으로 skip한다.
- ✅ **`advanceDiagnosis`의 `progress` 영속화 방침** — 본 문서 §8-1. 런타임 메모리 + phase 경계 `progress_snapshot` 저장으로 결정했고 `006`에 반영했다.
- ✅ **`store/types.ts`·`contract.ts` 델타** — CSV의 선택적 날짜 범위를 계약에 추가하고, 최신값·건강·텔레메트리 매핑을 기존 반환 타입에 연결했다.
- ✅ **Kafka 구현체** — `backend/src/device/kafka.ts`의 version-1 producer와 `backend/src/outboxWorker.ts`의 polling/claim/retry/lease 복구. 발행 성공 뒤에만 `sent_at`을 갱신하고 durable `event_id`를 Kafka header로 전달한다. 실 broker 인수 검증은 남았다.
- ✅ **Raw Consumer의 `battery_id` 태깅** — `backend/src/telemetryConsumer.ts`와 `docs/handover/b2-session-tagging.md`; 실 Kafka·DB 인수 검증은 남았다.
- **모드 1 SOH/RUL 산출 주체** — `battery_health` 테이블은 만들었지만 **누가 계산해 넣는지는 아직 미정**이다(`backend_contract.md` §9 Q6은 모드 2만 확정). DB는 저장만 맡는다.
- **Fail-Safe 문턱값** — `FAILSAFE_*` 환경 설정 5개는 Raw Consumer에 전달되고 기본값 `0`은 미설정 sentinel이다. 실제 승인값은 mode1 `mode1_backend_spec.md` §13 H8, mode2 `mode2_powerbank_diagnosis_spec.md` §8 H2 실측 후 정한다. 현재 코드 통합은 완료됐지만 기본값에서는 해당 계층이 비활성화되며 실물 relay actuation ACK는 미검증이다.
