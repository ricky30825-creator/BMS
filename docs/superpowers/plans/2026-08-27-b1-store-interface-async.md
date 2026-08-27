# B1 1단계 — store 인터페이스 분리와 비동기 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backend/src/store.ts`의 인메모리 도메인 저장소를 교체 가능한 인터페이스 뒤로 옮기고, 전 함수를 `Promise` 반환으로 바꾼 뒤 호출부 80곳과 라우트 57개를 비동기로 전환한다. **PostgreSQL 구현체는 이 계획의 범위가 아니다** — 별도 담당자가 2단계로 만든다.

**Architecture:** `store.ts`(360줄)는 지금 타입·상수·인메모리 상태·24개 동기 함수를 한 파일에 갖고 있고, `server.ts`·`exports.ts`·`auth/middleware.ts` 세 곳이 이름으로 직접 import한다. 이 계획은 파일을 `store/types.ts`(타입·상수) / `store/contract.ts`(`CellGuardStore` 인터페이스) / `store/memory.ts`(인메모리 구현체)로 쪼개고, `store.ts`는 **이름을 그대로 유지하는 얇은 facade**로 남긴다. 호출부는 함수명을 바꾸지 않고 `await`만 추가하면 되므로 diff가 리뷰 가능한 크기로 유지된다. 마지막에 구현체와 무관하게 도는 계약 테스트 스위트를 만들어, 2단계 담당자가 "이 테스트를 통과시키면 끝"이라는 완료 판정을 갖게 한다.

**Tech Stack:** Node.js, TypeScript (strict), Express 4, Vitest 4 (backend에 이미 설치됨 — `backend/vitest.config.ts`).

**Spec:** `docs/implementation_status.md` §"3. B군" B1, `docs/backend_contract.md` §3.4(위험 제어 승인 절차), §1.10(에러 code 목록).

## Global Constraints

- **PostgreSQL 코드를 쓰지 않는다.** `pg` 쿼리, 마이그레이션 실행, `DATA_MODE=postgres` 게이트 해제 전부 범위 밖이다. `server.ts:331`의 503 fail-closed 가드는 **그대로 둔다**.
- **동작이 바뀌면 안 된다.** 이 계획은 순수 리팩터링이다. 모든 단계에서 기존 테스트(백엔드 26건 · 프론트 57건 · E2E 29건)가 통과해야 하며, API 응답 본문·상태코드·에러 code가 하나도 달라지면 안 된다. 유일한 예외는 Task 1(로그인 완화)이다.
- **함수 이름을 바꾸지 않는다.** `batteryById`는 계속 `batteryById`다. facade가 이름을 유지하므로 호출부는 `await`만 붙는다. 이름을 바꾸면 diff가 폭발해 리뷰가 불가능해진다.
- **Express 4는 async 핸들러의 rejection을 잡지 못한다.** `app.get("/x", async (req,res) => {...})`에서 throw하면 에러 미들웨어로 가지 않고 프로세스로 샌다. Task 5의 `asyncRoute` 래퍼를 **반드시** 거쳐야 한다. 57개 핸들러에 `try/catch`를 손으로 넣지 말 것.
- **에러 code를 새로 만들지 않는다.** `docs/backend_contract.md` §1.10의 목록이 고정이다. 새 code가 필요하다고 판단되면 멈추고 물어볼 것.
- **`store.ts`의 도메인 규칙을 "정리"하지 않는다.** `startSession`이 기존 세션을 `SUPERSEDED`로 끝내는 것, `changeOpsStatus`가 `BLOCKED`일 때 세션을 끊는 것, `createBattery`가 모드 2에 용량을 요구하는 것 — 전부 계약이다. 옮기되 고치지 말 것.
- 기존 코드 스타일을 따른다. `store.ts`는 한 줄 함수와 여러 줄 함수가 섞여 있다 — 옮길 때 원문 서식을 그대로 유지한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/src/store/types.ts` (신규) | `Demo*` 타입 8개, `F21_THRESHOLDS`, `INPUT_LIMITS`, `CSV_HEADER`, `csvRow` |
| `backend/src/store/contract.ts` (신규) | `CellGuardStore` 인터페이스 — 24개 메서드 전부 `Promise` 반환 |
| `backend/src/store/memory.ts` (신규) | `createMemoryStore(): CellGuardStore` — 현재 인메모리 로직 |
| `backend/src/store/contract.test.ts` (신규) | 구현체 무관 계약 테스트 스위트 |
| `backend/src/store.ts` (개편) | facade — 타입 재수출 + 활성 구현체에 위임하는 이름 유지 함수 |
| `backend/src/server.ts` (수정) | `asyncRoute` 래퍼 도입, 호출부 `await` |
| `backend/src/auth/middleware.ts` (수정) | `demoUserForToken`·`demoUserFromRequest` 비동기화, 로그인 완화 |
| `docs/handover/b1-postgres-store.md` (신규) | 2단계 담당자용 인수인계 명세 |

---

## Part A — 데모 로그인 완화

### Task 1: 로그인이 아무 비밀번호나 받고 그 값을 기억한다

시연에서 로그인 화면에 막히지 않게 한다. **단 재인증 게이트는 살려둔다** — `demoPasswordMatches`는 `server.ts:407`(비밀번호 변경)과 `server.ts:559`(릴레이 차단·복구 재인증)에서도 쓰이는데, 아무거나 통과시키면 계약 §3.4의 재인증이 무력화된다. 로그인 시 **입력한 값을 그 사용자의 비밀번호로 기억**해서, 재인증에서 같은 값을 치면 통과하게 만든다.

**Files:**
- Modify: `backend/src/server.ts:306-324` (`/api/demo/login` 핸들러 — `app.post("/api/demo/login"`가 306줄에서 시작한다)
- Test: `backend/src/demoLogin.test.ts` (신규)

**Interfaces:**
- Consumes: `setDemoPassword(userId: string, password: string): void` — `backend/src/auth/middleware.ts:63`에 이미 존재
- Produces: `resolveDemoUser(email: string, users: DemoUser[]): DemoUser | null` — 이메일로 데모 사용자를 고르는 순수 함수

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/demoLogin.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import { resolveDemoUser } from "./demoLogin.js";
import type { DemoUser } from "./store.js";

const users: DemoUser[] = [
  { id: "hong", email: "hong@cellguard.io", name: "홍길동", role: "USER", status: "ACTIVE", phone: "010-1234-5678", joinedAt: "2025-03-12T00:00:00.000Z" },
  { id: "leelab", email: "lee@lab.io", name: "이연구", role: "ADMIN", status: "ACTIVE", phone: "010-3456-7890", joinedAt: "2024-08-19T00:00:00.000Z" },
  { id: "parktest", email: "park@test.io", name: "박테스트", role: "USER", status: "SUSPENDED", phone: "010-4567-8901", joinedAt: "2025-06-10T00:00:00.000Z" },
];

describe("resolveDemoUser", () => {
  it("등록된 데모 이메일이면 그 사용자를 고른다", () => {
    expect(resolveDemoUser("lee@lab.io", users)?.id).toBe("leelab");
  });

  it("대소문자와 공백을 무시한다", () => {
    expect(resolveDemoUser("  LEE@Lab.io  ", users)?.id).toBe("leelab");
  });

  it("모르는 이메일이면 첫 번째 일반 사용자로 붙인다", () => {
    expect(resolveDemoUser("whatever@example.com", users)?.id).toBe("hong");
  });

  it("빈 이메일이어도 첫 번째 일반 사용자로 붙인다", () => {
    expect(resolveDemoUser("", users)?.id).toBe("hong");
  });

  it("정지된 계정은 이메일이 정확히 맞으면 그대로 고른다 — 정지 판정은 호출부가 한다", () => {
    expect(resolveDemoUser("park@test.io", users)?.id).toBe("parktest");
  });

  it("고를 사용자가 없으면 null", () => {
    expect(resolveDemoUser("x@y.z", [])).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && npx vitest run src/demoLogin.test.ts`
Expected: FAIL — `Failed to resolve import "./demoLogin.js"`

- [ ] **Step 3: 최소 구현**

`backend/src/demoLogin.ts` 생성:

```ts
import type { DemoUser } from "./store.js";

// 데모 로그인은 비밀번호를 검증하지 않는다(2026-08-27 결정). 이메일만 보고
// 사용자를 고르되, 등록된 데모 이메일이면 그 사람으로 붙여 관리자 시연
// (lee@lab.io)이 그대로 되게 한다. 모르는 이메일은 첫 일반 사용자로 보낸다.
export function resolveDemoUser(email: string, users: DemoUser[]): DemoUser | null {
  const normalized = email.trim().toLowerCase();
  const exact = users.find((user) => user.email === normalized);
  if (exact) return exact;
  return users.find((user) => user.role === "USER") ?? users[0] ?? null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd backend && npx vitest run src/demoLogin.test.ts`
Expected: PASS (6건)

- [ ] **Step 5: 로그인 핸들러를 배선한다**

`backend/src/server.ts:306-324`를 아래로 교체한다. `demoPasswordMatches` 호출이 사라지고 `setDemoPassword`가 들어가는 것이 핵심이다.

```ts
app.post("/api/demo/login", (req, res) => {
  if (env.AUTH_MODE !== "demo") {
    apiError(res, 404, "NOT_FOUND", "Demo authentication is disabled.");
    return;
  }
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // 비밀번호는 검증하지 않고 기억만 한다. 재인증(릴레이 차단·비밀번호 변경)은
  // 계속 진짜로 검사하므로, 로그인 때 친 값을 그대로 쳐야 통과한다.
  const user = resolveDemoUser(email, demoUsers);
  if (!user) {
    apiError(res, 401, "UNAUTHENTICATED", "Demo credentials are invalid.");
    return;
  }
  if (user.status !== "ACTIVE") {
    apiError(res, 403, "ACCOUNT_SUSPENDED", "The demo account is suspended.");
    return;
  }
  setDemoPassword(user.id, password);
  const token = issueDemoToken({ id: user.id, email: user.email, name: user.name, role: user.role, status: user.status });
  recordAudit({ actorId: user.id, action: "ADMIN_LOGIN", resource: "/api/demo/login", result: "SUCCESS", reason: null });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
});
```

`server.ts` 상단 import에 `resolveDemoUser`를 추가한다:

```ts
import { resolveDemoUser } from "./demoLogin.js";
```

`demoPasswordMatches`는 `:407`·`:559`에서 계속 쓰이므로 import에서 빼지 말 것.

- [ ] **Step 6: 재인증이 살아 있는지 손으로 확인한다**

```bash
cd backend && AUTH_MODE=demo DATA_MODE=memory PORT=3021 \
  DATABASE_URL=postgres://x:x@127.0.0.1:5432/x \
  BETTER_AUTH_URL=http://localhost:3021 \
  BETTER_AUTH_SECRET=$(printf 'x%.0s' {1..32}) npx tsx src/server.ts &
sleep 6
B=http://127.0.0.1:3021
# 아무 비밀번호나 로그인 성공
curl -s -X POST $B/api/demo/login -H 'content-type: application/json' \
  -d '{"email":"hong@cellguard.io","password":"아무거나"}'
# 관리자도 이메일로 붙는다
curl -s -X POST $B/api/demo/login -H 'content-type: application/json' \
  -d '{"email":"lee@lab.io","password":"zzz"}' | grep -o '"role":"[A-Z]*"'
```

Expected: 첫 요청은 `token`+`hong`, 둘째는 `"role":"ADMIN"`.

이어서 재인증이 **여전히 막는지** 확인한다:

```bash
TOK=$(curl -s -X POST $B/api/demo/login -H 'content-type: application/json' \
  -d '{"email":"hong@cellguard.io","password":"pw-A"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H="Authorization: Demo $TOK"
BAT=$(curl -s -H "$H" $B/api/batteries | python3 -c 'import sys,json;print([b["id"] for b in json.load(sys.stdin)["items"] if b["opsStatus"]!="BLOCKED"][0])')
curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: t1' -d "{\"batteryId\":\"$BAT\"}" >/dev/null
# 틀린 비밀번호 → 401 REAUTH_REQUIRED 여야 한다
curl -s -X POST $B/api/relay/cut -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: t2' \
  -d "{\"batteryId\":\"$BAT\",\"reason\":\"재인증 확인용 사유입니다\",\"password\":\"pw-B\"}"
# 로그인 때 친 값 → 통과해야 한다
curl -s -X POST $B/api/relay/cut -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: t3' \
  -d "{\"batteryId\":\"$BAT\",\"reason\":\"재인증 확인용 사유입니다\",\"password\":\"pw-A\"}" | head -c 80
pkill -f "tsx src/server.ts"
```

Expected: `pw-B`는 `REAUTH_REQUIRED`, `pw-A`는 `"decision":"APPROVED"`.
**둘 중 하나라도 어긋나면 멈추고 보고할 것.** 재인증이 뚫리면 이 Task는 실패다.

- [ ] **Step 7: 전체 테스트**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: PASS (기존 26건 + 신규 6건 = 32건)

- [ ] **Step 8: 커밋**

```bash
git add backend/src/demoLogin.ts backend/src/demoLogin.test.ts backend/src/server.ts
git commit -m "feat(auth): accept any demo password and remember it for reauth

Login no longer blocks on a fixed password, but demoPasswordMatches still
guards relay cut/restore and password change. Storing what was typed at
login keeps that gate real: the same value passes reauth, a different one
still returns REAUTH_REQUIRED."
```

---

## Part B — 모듈 분리 (동작 변경 없음)

### Task 2: 타입과 상수를 `store/types.ts`로 옮긴다

**Files:**
- Create: `backend/src/store/types.ts`
- Modify: `backend/src/store.ts` (타입·상수 정의 삭제 후 재수출)

**Interfaces:**
- Produces: `DemoRole`, `DemoStatus`, `OpsStatus`, `RelayState`, `DemoUser`, `DemoBattery`, `DemoSession`, `DemoDiagnosis`, `DemoAudit`, `DemoRelay`, `F21_THRESHOLDS`, `INPUT_LIMITS`, `CSV_HEADER`, `csvRow`

- [ ] **Step 1: 새 파일을 만든다**

`backend/src/store.ts`에서 아래 세 덩어리를 `backend/src/store/types.ts`로 **그대로 잘라 옮긴다.** 한 글자도 고치지 않는다.

| 옮길 것 | 줄 |
|---|---|
| 타입 선언 10개 (`DemoRole`·`DemoStatus`·`OpsStatus`·`RelayState`·`DemoUser`·`DemoBattery`·`DemoSession`·`DemoDiagnosis`·`DemoAudit`·`DemoRelay`) | 3–97 |
| `F21_THRESHOLDS`, `INPUT_LIMITS` | 99–108 |
| `CSV_HEADER`, `csvRow` | 355, 357–끝 |

`csvRow`는 `DemoBattery`만 참조하는 순수 함수라 그대로 옮겨진다.

⚠️ **`demoUsers`(131줄)는 옮기지 않는다.** 타입이 아니라 데이터이므로 Task 4에서 `store/memory.ts`의 클로저로 들어간다.

파일 맨 위에 주석을 단다:

```ts
// 도메인 타입과 상수. 저장소 구현체(memory/postgres)와 무관하므로 여기 둔다.
```

- [ ] **Step 2: `store.ts`가 재수출하게 한다**

`backend/src/store.ts` 맨 위에 추가:

```ts
export * from "./store/types.js";
import type { DemoAudit, DemoBattery, DemoDiagnosis, DemoRelay, DemoSession, DemoStatus, DemoUser, OpsStatus } from "./store/types.js";
import { CSV_HEADER, INPUT_LIMITS, csvRow } from "./store/types.js";
```

`export * from`이 있으므로 `server.ts`·`exports.ts`·`auth/middleware.ts`의 import는 **한 줄도 고칠 필요가 없다.**

- [ ] **Step 3: 회귀가 없는지 확인한다**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: PASS (32건). 타입 오류가 나면 옮기다 빠뜨린 심볼이 있는 것이다.

- [ ] **Step 4: 커밋**

```bash
git add backend/src/store/types.ts backend/src/store.ts
git commit -m "refactor(store): extract domain types and constants

Pure move, no behaviour change. store.ts re-exports so no import site
changes."
```

### Task 3: `CellGuardStore` 인터페이스를 정의한다

**Files:**
- Create: `backend/src/store/contract.ts`

**Interfaces:**
- Consumes: `store/types.ts`의 타입 전부
- Produces: `CellGuardStore` — 24개 메서드, 전부 `Promise` 반환

- [ ] **Step 1: 인터페이스를 쓴다**

`backend/src/store/contract.ts` 생성. **시그니처는 현재 `store.ts`의 것과 반환 타입만 `Promise<T>`로 감싼 것이 전부다.**

```ts
import type { DemoAudit, DemoBattery, DemoDiagnosis, DemoRelay, DemoSession, DemoStatus, DemoUser, OpsStatus } from "./types.js";

export type CreateBatteryInput = {
  label: string;
  maker?: string | null;
  model?: string | null;
  targetMode: 1 | 2;
  chemistry: "LI_ION" | "LI_PO";
  seriesCount?: number | null;
  capacityWh?: number | null;
  ratedOutputCurrentA?: number | null;
};

export type UpdateBatteryInput = {
  label?: string;
  maker?: string | null;
  model?: string | null;
  seriesCount?: number | null;
  memo?: string;
};

export type IdempotencyResult = { kind: "new" | "replay" | "conflict"; status?: number; body?: unknown };

// 도메인 저장소 계약. 인메모리와 PostgreSQL 구현체가 이 인터페이스를 공유하며,
// store/contract.test.ts가 두 구현체에 같은 테스트를 돌린다.
//
// 규칙 세 가지:
//  1. 실패는 전부 `throw new Error("<CODE>")`다. CODE는 docs/backend_contract.md
//     §1.10의 목록에 있는 것만 쓴다. server.ts의 errorFromDomain()이 HTTP 상태로
//     옮긴다.
//  2. 반환값은 호출부가 마음대로 고쳐도 저장소가 오염되지 않아야 한다(방어 복사).
//  3. 감사 로그를 함께 남기는 메서드는 원자적이어야 한다 — 계약 §3.4.
//     changeRelay / changeOpsStatus / saveMemo / changeUserStatus / startSession이
//     해당한다. PostgreSQL 구현체는 이들을 한 트랜잭션에 넣어야 한다.
export interface CellGuardStore {
  // 조회
  userById(id: string): Promise<DemoUser | undefined>;
  users(): Promise<DemoUser[]>;
  batteryById(id: string): Promise<DemoBattery | undefined>;
  batteries(ownerId?: string): Promise<DemoBattery[]>;
  activeSession(ownerId?: string): Promise<DemoSession | null>;
  sessionById(id: string): Promise<DemoSession | undefined>;
  sessionsForBattery(batteryId: string): Promise<DemoSession[]>;
  activeDiagnosis(batteryId?: string): Promise<DemoDiagnosis | null>;
  diagnosisById(id: string): Promise<DemoDiagnosis | undefined>;
  diagnosesForBattery(batteryId: string): Promise<DemoDiagnosis[]>;
  relayByBattery(id: string): Promise<DemoRelay>;
  audits(): Promise<DemoAudit[]>;

  // 변경
  createBattery(ownerId: string, input: CreateBatteryInput): Promise<DemoBattery>;
  updateBattery(ownerId: string, batteryId: string, input: UpdateBatteryInput): Promise<DemoBattery>;
  recordAudit(input: Omit<DemoAudit, "id" | "at">): Promise<DemoAudit>;
  startSession(ownerId: string, batteryId: string): Promise<DemoSession>;
  changeOpsStatus(actorId: string, batteryId: string, next: OpsStatus, reason: string, expectedVersion?: number): Promise<DemoBattery>;
  saveMemo(actorId: string, batteryId: string, memo: string, expectedVersion?: number): Promise<DemoBattery>;
  changeUserStatus(actorId: string, userId: string, status: DemoStatus, reason: string): Promise<DemoUser>;
  changeRelay(actorId: string, batteryId: string, action: "cut" | "restore", reason: string): Promise<DemoRelay>;
  startDiagnosis(ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): Promise<DemoDiagnosis>;
  abortDiagnosis(ownerId: string, batteryId: string): Promise<DemoDiagnosis>;

  // 멱등성
  idempotent(actorId: string, key: string, body: unknown): Promise<IdempotencyResult>;
  rememberIdempotency(actorId: string, key: string, body: unknown, status: number, response: unknown): Promise<void>;

  // 파생
  mode1Health(battery: DemoBattery): Promise<Record<string, unknown> | null>;
  csvForBattery(batteryId: string, sessionId: string | null): Promise<string>;
}
```

- [ ] **Step 2: 타입만 확인한다**

Run: `cd backend && npm run typecheck`
Expected: PASS. 이 파일은 아직 아무도 import하지 않으므로 통과해야 한다.

- [ ] **Step 3: 커밋**

```bash
git add backend/src/store/contract.ts
git commit -m "feat(store): define the CellGuardStore interface

Async signatures only; no implementation yet. This is the seam the
PostgreSQL implementation (B1 stage 2, separate owner) plugs into."
```

### Task 4: 인메모리 구현체를 `store/memory.ts`로 옮기고 async화한다

**Files:**
- Create: `backend/src/store/memory.ts`
- Modify: `backend/src/store.ts` (facade로 축소)

**Interfaces:**
- Consumes: `CellGuardStore`, `store/types.ts`
- Produces: `createMemoryStore(): CellGuardStore`
- Produces (facade): `store.ts`가 기존 이름 24개를 그대로 내보내되 전부 `Promise` 반환. `demoUsers`는 계속 배열로 내보낸다.

- [ ] **Step 1: 구현체를 만든다**

`backend/src/store.ts`에 남은 것(인메모리 상태 6개 + `makeBattery`·`normalizeReason`·`normalizeMemo`·`isoNow` 같은 내부 헬퍼 + 24개 함수)을 `backend/src/store/memory.ts`로 옮긴다.

구조는 **팩토리 함수**로 감싼다. 상태를 모듈 스코프가 아니라 클로저에 두어야 계약 테스트가 구현체를 새로 만들어 격리할 수 있다.

```ts
import { createHash, randomUUID } from "node:crypto";
import type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./contract.js";
import { CSV_HEADER, INPUT_LIMITS, csvRow } from "./types.js";
import type { DemoAudit, DemoBattery, DemoDiagnosis, DemoRelay, DemoSession, DemoStatus, DemoUser, OpsStatus } from "./types.js";

export function createMemoryStore(): CellGuardStore & { demoUsers: DemoUser[] } {
  const demoUsers: DemoUser[] = [ /* store.ts:131-136의 배열을 그대로 옮긴다 */ ];
  const demoBatteries: DemoBattery[] = [ /* store.ts:138-146을 그대로 옮긴다 */ ];
  const demoSessions = new Map<string, DemoSession>();
  const demoRelays = new Map<string, DemoRelay>();
  const demoDiagnoses = new Map<string, DemoDiagnosis>();
  const demoAudits: DemoAudit[] = [];
  const idempotency = new Map<string, { hash: string; status: number; body: unknown }>();

  // store.ts의 내부 헬퍼(isoNow / normalizeReason / normalizeMemo / makeBattery)를
  // 여기로 그대로 옮긴다.
  //
  // ⚠️ 데모 비밀번호 Map은 여기 두지 않는다. `demoPasswords`는
  // `backend/src/auth/middleware.ts:22`에 있고 인증 관심사이지 도메인 저장소가
  // 아니다. 그대로 둔다.

  return {
    demoUsers,
    async userById(id) { return demoUsers.find((user) => user.id === id); },
    async batteryById(id) { return demoBatteries.find((battery) => battery.id === id); },
    // ... 나머지 22개도 같은 방식: 기존 본문 앞에 async만 붙인다.
  };
}
```

**옮길 때 지킬 것:**
- 함수 본문을 **한 줄도 고치지 않는다.** `async`만 붙인다.
- 함수끼리 서로 부르는 곳(`startSession`이 `batteryById`·`activeSession`·`recordAudit`을 부름)은 클로저 안의 지역 함수로 만들어 `await` 없이 동기 호출하도록 두거나, `await this.x()` 대신 지역 함수를 쓴다. **`this`를 쓰지 말 것** — 객체 리터럴 메서드에서 `this` 바인딩은 facade를 통과하면 깨진다.
  구체적으로: 내부 로직은 동기 지역 함수로 유지하고, 반환하는 객체의 메서드는 그 지역 함수를 감싸는 얇은 `async` 껍데기로 만든다.

```ts
  // 내부는 동기로 유지 — 서로 부르기 쉽고 기존 로직을 그대로 옮길 수 있다.
  const findBattery = (id: string) => demoBatteries.find((battery) => battery.id === id);
  const findActiveSession = (ownerId?: string) => [...demoSessions.values()].find((s) => s.status === "ACTIVE" && (!ownerId || s.ownerId === ownerId)) ?? null;
  const audit = (input: Omit<DemoAudit, "id" | "at">): DemoAudit => { /* 기존 recordAudit 본문 */ };
  const beginSession = (ownerId: string, batteryId: string): DemoSession => { /* 기존 startSession 본문, findBattery/findActiveSession/audit 사용 */ };

  return {
    demoUsers,
    async batteryById(id) { return findBattery(id); },
    async activeSession(ownerId) { return findActiveSession(ownerId); },
    async recordAudit(input) { return audit(input); },
    async startSession(ownerId, batteryId) { return beginSession(ownerId, batteryId); },
    // ...
  };
```

- [ ] **Step 2: `store.ts`를 facade로 줄인다**

`backend/src/store.ts` 전체를 아래로 교체한다.

```ts
export * from "./store/types.js";
export type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./store/contract.js";

import { createMemoryStore } from "./store/memory.js";

// DATA_MODE=postgres는 server.ts:331의 가드가 /api/* 전체를 503으로 막으므로
// 여기까지 오지 않는다. PostgreSQL 구현체가 생기면(B1 2단계) 그때 분기한다.
const active = createMemoryStore();

export const demoUsers = active.demoUsers;

// 이름을 유지하는 위임 함수. 호출부는 `await`만 붙이면 되고 함수명은 그대로다.
export const userById = active.userById.bind(active);
export const users = active.users.bind(active);
export const batteryById = active.batteryById.bind(active);
export const batteries = active.batteries.bind(active);
export const activeSession = active.activeSession.bind(active);
export const sessionById = active.sessionById.bind(active);
export const sessionsForBattery = active.sessionsForBattery.bind(active);
export const activeDiagnosis = active.activeDiagnosis.bind(active);
export const diagnosisById = active.diagnosisById.bind(active);
export const diagnosesForBattery = active.diagnosesForBattery.bind(active);
export const relayByBattery = active.relayByBattery.bind(active);
export const audits = active.audits.bind(active);
export const createBattery = active.createBattery.bind(active);
export const updateBattery = active.updateBattery.bind(active);
export const recordAudit = active.recordAudit.bind(active);
export const startSession = active.startSession.bind(active);
export const changeOpsStatus = active.changeOpsStatus.bind(active);
export const saveMemo = active.saveMemo.bind(active);
export const changeUserStatus = active.changeUserStatus.bind(active);
export const changeRelay = active.changeRelay.bind(active);
export const startDiagnosis = active.startDiagnosis.bind(active);
export const abortDiagnosis = active.abortDiagnosis.bind(active);
export const idempotent = active.idempotent.bind(active);
export const rememberIdempotency = active.rememberIdempotency.bind(active);
export const mode1Health = active.mode1Health.bind(active);
export const csvForBattery = active.csvForBattery.bind(active);
```

- [ ] **Step 3: 타입체크로 호출부 목록을 뽑는다**

Run: `cd backend && npm run typecheck 2>&1 | tee /tmp/b1-errors.txt; wc -l /tmp/b1-errors.txt`

Expected: **대량의 타입 오류.** 이건 정상이다. `Promise<DemoBattery>`를 `DemoBattery`로 쓰는 곳이 전부 잡힌다. **이 오류 목록이 Part C의 작업 목록이다.** 파일별 오류 수를 세어 둔다:

```bash
grep -oE "^src/[a-zA-Z/]+\.ts" /tmp/b1-errors.txt | sort | uniq -c | sort -rn
```

- [ ] **Step 4: 커밋 (타입 오류가 있는 채로)**

이 커밋은 **의도적으로 빌드가 깨진 상태**다. 다음 Task들이 호출부를 고친다. 브랜치에서 작업 중이므로 문제없다.

```bash
git add backend/src/store/memory.ts backend/src/store.ts
git commit -m "refactor(store)!: move the in-memory store behind an async factory

store.ts becomes a facade that keeps every exported name, so call sites
only gain `await`. Call sites are fixed in the following commits — this
commit alone does not typecheck."
```

---

## Part C — 호출부 비동기 전환

### Task 5: `asyncRoute` 래퍼를 도입한다

Express 4는 async 핸들러의 rejection을 에러 미들웨어로 보내지 않는다. 57개 핸들러에 `try/catch`를 넣는 대신 래퍼 하나를 쓴다.

**Files:**
- Modify: `backend/src/server.ts` (헬퍼 추가 + `/health` 아래 첫 라우트 1개 전환)
- Test: `backend/src/asyncRoute.test.ts` (신규)

**Interfaces:**
- Produces: `asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/asyncRoute.test.ts` 생성:

```ts
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { asyncRoute } from "./asyncRoute.js";

describe("asyncRoute", () => {
  it("rejection을 next()로 넘겨 에러 미들웨어가 받게 한다", async () => {
    const boom = new Error("NOT_FOUND");
    const next = vi.fn() as unknown as NextFunction;
    asyncRoute(async () => { throw boom; })({} as Request, {} as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(boom);
  });

  it("정상 완료하면 next()를 부르지 않는다", async () => {
    const next = vi.fn() as unknown as NextFunction;
    const handler = vi.fn().mockResolvedValue(undefined);
    asyncRoute(handler)({} as Request, {} as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && npx vitest run src/asyncRoute.test.ts`
Expected: FAIL — `Failed to resolve import "./asyncRoute.js"`

- [ ] **Step 3: 구현한다**

`backend/src/asyncRoute.ts` 생성:

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4는 async 핸들러가 reject하면 에러 미들웨어로 넘기지 않고 프로세스로
// 흘려보낸다(unhandled rejection). 모든 async 라우트는 이 래퍼를 거쳐야 한다.
export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd backend && npx vitest run src/asyncRoute.test.ts`
Expected: PASS (2건)

- [ ] **Step 5: 라우트 1개로 패턴을 검증한다**

`server.ts` 상단에 `import { asyncRoute } from "./asyncRoute.js";`를 추가하고, `/api/batteries` GET 하나만 전환한다.

Before:
```ts
app.get("/api/batteries", requireSession, (req, res) => {
```
After:
```ts
app.get("/api/batteries", requireSession, asyncRoute(async (req, res) => {
```
그리고 핸들러 본문의 store 호출에 `await`를 붙이고, 닫는 `});`를 `}));`로 바꾼다.

- [ ] **Step 6: 그 라우트만 타입이 맞는지 본다**

Run: `cd backend && npm run typecheck 2>&1 | grep -c "api/batteries" || true`
Expected: `/api/batteries` 핸들러 관련 오류가 사라져 있어야 한다(다른 라우트 오류는 남아 있음).

- [ ] **Step 7: 커밋**

```bash
git add backend/src/asyncRoute.ts backend/src/asyncRoute.test.ts backend/src/server.ts
git commit -m "feat(server): add asyncRoute so route rejections reach the error handler

Express 4 drops async handler rejections instead of forwarding them.
Converts GET /api/batteries as the reference case."
```

### Task 6: 인증 미들웨어를 비동기로 전환한다

`auth/middleware.ts`가 `userById`·`recordAudit`을 부르므로 여기부터 처리한다. `requireSession`·`requireRole`은 이미 `async`라 시그니처는 안 바뀐다.

**Files:**
- Modify: `backend/src/auth/middleware.ts:48-53` (`demoUserForToken`), `:67-71` (`demoUserFromRequest`), `:80-95`·`:123-141` (호출부), `backend/src/server.ts` (WS upgrade 핸들러의 `demoUserForToken` 호출)

**Interfaces:**
- Produces: `demoUserForToken(token: string | null | undefined): Promise<AppUser | null>`

- [ ] **Step 1: 두 함수를 async로 바꾼다**

```ts
export async function demoUserForToken(token: string | null | undefined): Promise<AppUser | null> {
  if (env.AUTH_MODE !== "demo" || !token) return null;
  const userId = demoTokens.get(token);
  const user = userId ? await userById(userId) : undefined;
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } : null;
}

async function demoUserFromRequest(req: Request): Promise<AppUser | null> {
  if (env.AUTH_MODE !== "demo") return null;
  const token = req.get("authorization")?.match(/^Demo\s+(.+)$/i)?.[1];
  return demoUserForToken(token);
}
```

- [ ] **Step 2: 호출부에 await를 붙인다**

`requireSession`(`:80`)과 `requireRole`(`:123`) 안의 `const demoUser = demoUserFromRequest(req);`를 `const demoUser = await demoUserFromRequest(req);`로, `recordAudit({...})`를 `await recordAudit({...})`로 바꾼다. 해당 위치는 `:83`, `:126`, `:133`이다.

- [ ] **Step 3: WS upgrade 핸들러를 고친다**

`server.ts`의 upgrade 핸들러(`:934` 부근) `const demoUser = demoUserForToken(...)`에 `await`를 붙인다. 같은 핸들러의 `activeSession(userId)` 호출(`client` 생성부)에도 `await`를 붙인다. upgrade 핸들러는 이미 `async`다.

- [ ] **Step 4: 확인**

Run: `cd backend && npm run typecheck 2>&1 | grep "auth/middleware" | wc -l`
Expected: `0`

- [ ] **Step 5: 커밋**

```bash
git add backend/src/auth/middleware.ts backend/src/server.ts
git commit -m "refactor(auth): await the store from the session middleware"
```

### Task 7: 사용자 라우트를 전환한다 (`/api/me`, settings, account, batteries, sessions)

**Files:**
- Modify: `backend/src/server.ts` — `/api/account/*`, `/api/me*`, `/api/settings/*`, `/api/batteries*`, `/api/sessions`

- [ ] **Step 1: 라우트를 하나씩 전환한다**

각 라우트에 대해 똑같은 3단계를 적용한다.

1. `(req, res) => {` → `asyncRoute(async (req, res) => {`
2. 본문의 store 함수 호출 앞에 `await`를 붙인다 (`batteryById`, `batteries`, `activeSession`, `createBattery`, `updateBattery`, `startSession`, `recordAudit`, `idempotent`, `rememberIdempotency`, `mode1Health`, `sessionsForBattery`, `userById`)
3. 닫는 `});` → `}));`

`ensureOwner`·`ownerBatteries`·`batteryJson`·`dashboardJson` 같은 **모듈 스코프 헬퍼도 store를 부르면 async가 된다.** 그 헬퍼를 부르는 곳에도 `await`가 필요하다. 타입체커가 전부 짚어준다.

- [ ] **Step 2: 진행 상황을 센다**

Run: `cd backend && npm run typecheck 2>&1 | grep -oE "^src/server\.ts\([0-9]+" | wc -l`
남은 오류 수가 줄어드는지 확인한다.

- [ ] **Step 3: 손으로 확인한다**

```bash
cd backend && AUTH_MODE=demo DATA_MODE=memory PORT=3022 \
  DATABASE_URL=postgres://x:x@127.0.0.1:5432/x BETTER_AUTH_URL=http://localhost:3022 \
  BETTER_AUTH_SECRET=$(printf 'x%.0s' {1..32}) npx tsx src/server.ts &
sleep 6
B=http://127.0.0.1:3022
TOK=$(curl -s -X POST $B/api/demo/login -H 'content-type: application/json' -d '{"email":"hong@cellguard.io","password":"p"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
for p in /api/me /api/batteries /api/settings/alerts /api/settings/voice-alert; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Demo $TOK" "$B$p")  $p"
done
pkill -f "tsx src/server.ts"
```
Expected: 전부 `200`. **`500`이 하나라도 나오면 `await`를 빠뜨린 것이다.**

- [ ] **Step 4: 커밋**

```bash
git add backend/src/server.ts
git commit -m "refactor(server): await the store in account, settings, and battery routes"
```

### Task 8: 관제 라우트를 전환한다 (dashboard, relay, anomaly, events, trends, alerts, notices)

**Files:**
- Modify: `backend/src/server.ts` — `/api/dashboard`, `/api/relay*`, `/api/anomaly/*`, `/api/events`, `/api/trends`, `/api/alerts*`, `/api/notices*`

- [ ] **Step 1: Task 7과 같은 3단계를 적용한다**

`relayMutation`은 이미 `async`지만 안에서 `changeRelay`·`recordAudit`·`batteryById`를 부르므로 `await`가 필요하다. `relayJson`·`dashboardMetrics`·`quickTrend`도 store를 부르면 async가 된다.

**주의:** `broadcast("relay.changed", await relayJson(battery.id), ...)` 처럼 broadcast 인자 안에서 await하는 경우가 생긴다. broadcast 자체는 동기로 유지한다.

- [ ] **Step 2: 손으로 확인한다**

```bash
cd backend && AUTH_MODE=demo DATA_MODE=memory PORT=3023 \
  DATABASE_URL=postgres://x:x@127.0.0.1:5432/x BETTER_AUTH_URL=http://localhost:3023 \
  BETTER_AUTH_SECRET=$(printf 'x%.0s' {1..32}) npx tsx src/server.ts &
sleep 6
B=http://127.0.0.1:3023
TOK=$(curl -s -X POST $B/api/demo/login -H 'content-type: application/json' -d '{"email":"hong@cellguard.io","password":"p"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H="Authorization: Demo $TOK"
BAT=$(curl -s -H "$H" $B/api/batteries | python3 -c 'import sys,json;print([b["id"] for b in json.load(sys.stdin)["items"] if b["opsStatus"]!="BLOCKED"][0])')
curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: t8' -d "{\"batteryId\":\"$BAT\"}" >/dev/null
for p in /api/dashboard /api/relay /api/anomaly/summary /api/anomaly/evidence /api/events /api/trends /api/alerts /api/notices /api/relay/history; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B$p")  $p"
done
echo -n "BLOCKED 세션 시도(409 기대): "; curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: t8b' -d '{"batteryId":"PACK-001"}'
pkill -f "tsx src/server.ts"
```
Expected: 전부 `200`, 마지막은 `BATTERY_BLOCKED`.

- [ ] **Step 3: 커밋**

```bash
git add backend/src/server.ts
git commit -m "refactor(server): await the store in monitoring and relay routes"
```

### Task 9: 관리자·진단·내보내기 라우트를 전환하고 빌드를 초록으로 되돌린다

**Files:**
- Modify: `backend/src/server.ts` — `/api/admin/*`, `/api/diagnosis/*`, `/api/diagnoses/:id`, `/api/batteries/:id/diagnoses`, `/api/metrics/export.csv`, `/api/exports*`
- Modify: `backend/src/exports.ts` (`batteryById`·`sessionById`·`csvRow` 호출)

- [ ] **Step 1: 라우트를 전환한다**

Task 7과 같은 3단계. `userStatusMutation`·`diagnosisStart`는 이미 async다.

- [ ] **Step 2: `exports.ts`를 고친다**

`createExportJob`과 `scheduleExportCompletion`이 `sessionById`·`batteryById`·`csvRow`를 부른다. `csvRow`는 `store/types.ts`의 순수 함수라 그대로지만, 나머지 둘은 `await`가 필요하므로 두 함수가 async가 된다. 호출부(`server.ts`의 `/api/exports` POST)에도 `await`를 붙인다.

`scheduleExportCompletion`의 콜백은 `setTimeout` 안에서 돌므로, **콜백 내부에서 reject되면 아무도 잡지 않는다.** 이렇게 감싼다:

```ts
setTimeout(() => {
  void completeExportJob(jobId).then(onReady).catch((error) => {
    console.error("export job failed", error);
  });
}, delayMs);
```

- [ ] **Step 3: 빌드가 초록인지 확인한다**

Run: `cd backend && npm run typecheck`
Expected: **오류 0건.** 여기서 Part C가 끝난다.

- [ ] **Step 4: 전체 테스트**

Run: `cd backend && npx vitest run`
Expected: PASS (34건 — 기존 26 + demoLogin 6 + asyncRoute 2)

기존 `store.test.ts`·`exports.test.ts`가 동기 호출을 쓰고 있으므로 `await`를 붙여 고친다. 예:

```ts
it("returns the session that startSession created", async () => {
  const session = await startSession("hong", "DEMO-PACK-001");
  const found = await sessionById(session.id);
  expect(found).toEqual(session);
});
```

- [ ] **Step 5: 프론트엔드 회귀까지 확인한다**

```bash
cd frontend && npm run typecheck && npx vitest run && npx playwright test
```
Expected: 프론트 57건, E2E 29건 PASS. **프론트는 한 줄도 안 고쳤어야 한다** — API 응답이 그대로이므로.

- [ ] **Step 6: 브라우저로 최종 확인한다**

```bash
cd frontend && npm run build
cd ../backend && AUTH_MODE=demo DATA_MODE=memory PORT=3005 \
  DATABASE_URL=postgres://x:x@127.0.0.1:5432/x BETTER_AUTH_URL=http://localhost:3005 \
  BETTER_AUTH_SECRET=$(printf 'x%.0s' {1..32}) npx tsx src/server.ts
```
`http://localhost:3005`에서 로그인 → 배터리 연결 → 대시보드 → 릴레이 차단까지 손으로 돌려보고, 브라우저 콘솔에 에러가 없는지 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add backend/src/server.ts backend/src/exports.ts backend/src/store.test.ts backend/src/exports.test.ts
git commit -m "refactor(server): await the store in admin, diagnosis, and export routes

Backend typechecks again. No API response changed: frontend and e2e
suites pass untouched."
```

---

## Part D — 계약 테스트

### Task 10: 구현체 무관 계약 테스트 스위트

2단계 담당자의 완료 판정이 될 테스트다. **인메모리와 PostgreSQL 두 구현체에 같은 테스트를 돌린다.**

**Files:**
- Create: `backend/src/store/contract.test.ts`

**Interfaces:**
- Consumes: `CellGuardStore`, `createMemoryStore`
- Produces: `runStoreContractTests(name: string, makeStore: () => Promise<CellGuardStore>): void`

- [ ] **Step 1: 스위트를 쓴다**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { CellGuardStore } from "./contract.js";
import { createMemoryStore } from "./memory.js";

// 저장소 구현체가 지켜야 하는 도메인 계약. 인메모리와 PostgreSQL이 같은
// 스위트를 통과해야 한다. B1 2단계 담당자는 아래 한 줄을 추가하면 된다:
//   runStoreContractTests("postgres", async () => createPostgresStore(pool));
export function runStoreContractTests(name: string, makeStore: () => Promise<CellGuardStore>): void {
  describe(`CellGuardStore 계약 — ${name}`, () => {
    let store: CellGuardStore;
    beforeEach(async () => { store = await makeStore(); });

    it("소유자 스코프: batteries(ownerId)는 그 사용자 것만 준다", async () => {
      const all = await store.batteries();
      const mine = await store.batteries("hong");
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((battery) => battery.ownerId === "hong")).toBe(true);
      expect(all.length).toBeGreaterThanOrEqual(mine.length);
    });

    it("BLOCKED 배터리는 세션을 시작할 수 없다", async () => {
      const blocked = (await store.batteries()).find((battery) => battery.opsStatus === "BLOCKED");
      expect(blocked).toBeDefined();
      await expect(store.startSession("hong", blocked!.id)).rejects.toThrow("BATTERY_BLOCKED");
    });

    it("없는 배터리로 세션을 시작하면 NOT_FOUND", async () => {
      await expect(store.startSession("hong", "no-such-battery")).rejects.toThrow("NOT_FOUND");
    });

    it("설비 전체에 활성 세션은 하나뿐이고 이전 것은 SUPERSEDED로 끝난다", async () => {
      const usable = (await store.batteries()).filter((battery) => battery.opsStatus !== "BLOCKED");
      const first = await store.startSession("hong", usable[0].id);
      await store.startSession("hong", usable[0].id);
      const ended = await store.sessionById(first.id);
      expect(ended?.status).toBe("ENDED");
      expect(ended?.endReason).toBe("SUPERSEDED");
      const active = await store.activeSession();
      expect(active?.id).not.toBe(first.id);
    });

    it("version이 어긋나면 VERSION_CONFLICT", async () => {
      const battery = (await store.batteries())[0];
      await expect(
        store.changeOpsStatus("leelab", battery.id, "WATCH", "정상 사유입니다", battery.version + 5)
      ).rejects.toThrow("VERSION_CONFLICT");
    });

    it("같은 상태로 바꾸면 NO_STATUS_CHANGE", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await expect(store.changeOpsStatus("leelab", battery.id, "NORMAL", "정상 사유입니다")).rejects.toThrow("NO_STATUS_CHANGE");
    });

    it("상태를 바꾸면 version이 오르고 감사 로그가 남는다 — 원자성", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      const before = (await store.audits()).length;
      const after = await store.changeOpsStatus("leelab", battery.id, "WATCH", "감사 로그 확인용 사유");
      expect(after.version).toBe(battery.version + 1);
      expect((await store.audits()).length).toBe(before + 1);
    });

    it("BLOCKED로 바꾸면 그 배터리의 활성 세션이 끊긴다", async () => {
      const usable = (await store.batteries()).find((battery) => battery.opsStatus === "NORMAL")!;
      const session = await store.startSession(usable.ownerId, usable.id);
      await store.changeOpsStatus("leelab", usable.id, "BLOCKED", "차단 사유입니다");
      const ended = await store.sessionById(session.id);
      expect(ended?.status).toBe("ENDED");
      expect(ended?.endReason).toBe("BLOCKED");
    });

    it("릴레이 차단은 상태와 감사 로그를 함께 남긴다 — 원자성", async () => {
      const battery = (await store.batteries())[0];
      const before = (await store.audits()).length;
      const relay = await store.changeRelay("hong", battery.id, "cut", "차단 사유입니다");
      expect(relay.state).toBe("OPEN");
      expect((await store.audits()).length).toBe(before + 1);
    });

    it("인터락이 걸려 있으면 복구할 수 없다", async () => {
      const blocked = (await store.batteries()).find((battery) => battery.opsStatus === "BLOCKED")!;
      const relay = await store.relayByBattery(blocked.id);
      expect(relay.interlockEngaged).toBe(true);
      await expect(store.changeRelay("hong", blocked.id, "restore", "복구 사유입니다")).rejects.toThrow("INTERLOCK_LOCKED");
    });

    it("사유가 비면 REASON_REQUIRED", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await expect(store.changeOpsStatus("leelab", battery.id, "WATCH", "   ")).rejects.toThrow("REASON_REQUIRED");
      await expect(store.changeRelay("hong", battery.id, "cut", "")).rejects.toThrow("REASON_REQUIRED");
    });

    it("자기 자신을 정지시킬 수 없다", async () => {
      await expect(store.changeUserStatus("leelab", "leelab", "SUSPENDED", "정지 사유입니다")).rejects.toThrow("SELF_SUSPEND_FORBIDDEN");
    });

    it("모드 2 배터리는 용량 없이 만들 수 없다", async () => {
      await expect(
        store.createBattery("hong", { label: "보조배터리", targetMode: 2, chemistry: "LI_ION" })
      ).rejects.toThrow("CAPACITY_REQUIRED");
    });

    it("이름이 비면 BATTERY_NAME_REQUIRED", async () => {
      await expect(
        store.createBattery("hong", { label: "   ", targetMode: 1, chemistry: "LI_ION" })
      ).rejects.toThrow("BATTERY_NAME_REQUIRED");
    });

    it("같은 키·같은 본문은 replay, 다른 본문은 conflict", async () => {
      const body = { batteryId: "X" };
      expect((await store.idempotent("hong", "k1", body)).kind).toBe("new");
      await store.rememberIdempotency("hong", "k1", body, 202, { id: "job-1" });
      const replay = await store.idempotent("hong", "k1", body);
      expect(replay.kind).toBe("replay");
      expect(replay.status).toBe(202);
      expect(replay.body).toEqual({ id: "job-1" });
      expect((await store.idempotent("hong", "k1", { batteryId: "Y" })).kind).toBe("conflict");
    });

    it("멱등성 키는 사용자별로 분리된다", async () => {
      const body = { batteryId: "X" };
      await store.rememberIdempotency("hong", "shared", body, 202, { id: "hong-job" });
      expect((await store.idempotent("kimeng", "shared", body)).kind).toBe("new");
    });

    it("반환값을 고쳐도 저장소가 오염되지 않는다", async () => {
      const battery = (await store.batteries())[0];
      battery.label = "손으로 바꾼 이름";
      const again = await store.batteryById(battery.id);
      expect(again?.label).not.toBe("손으로 바꾼 이름");
    });
  });
}

runStoreContractTests("memory", async () => createMemoryStore());
```

- [ ] **Step 2: 인메모리로 통과시킨다**

Run: `cd backend && npx vitest run src/store/contract.test.ts`

**실패하는 테스트가 있으면 테스트가 아니라 기대값을 확인한다.** 이 스위트는 현재 동작을 기술한 것이므로, 실패한다면 (a) 내가 현재 동작을 잘못 읽었거나 (b) Task 4에서 옮기다 로직이 바뀐 것이다. (b)라면 `git diff`로 원본과 대조해 되돌린다.

Expected: PASS (17건)

- [ ] **Step 3: 전체 테스트**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: PASS (51건 — 기존 26 + demoLogin 6 + asyncRoute 2 + contract 17)

- [ ] **Step 4: 커밋**

```bash
git add backend/src/store/contract.test.ts
git commit -m "test(store): add the implementation-agnostic contract suite

Same suite will run against the PostgreSQL store (B1 stage 2). Pins owner
scoping, the single-active-session rule, optimistic version conflicts,
interlock, idempotency namespacing, and defensive copying."
```

---

## Part E — 인수인계

### Task 11: 2단계 담당자용 명세를 쓴다

**Files:**
- Create: `docs/handover/b1-postgres-store.md`
- Modify: `docs/implementation_status.md` (B1 항목을 1단계 완료 / 2단계 대기로 갱신)

- [ ] **Step 1: 명세를 쓴다**

`docs/handover/b1-postgres-store.md`에 아래 내용을 담는다. **각 항목을 실제 값으로 채워 쓸 것 — "적절히", "필요시" 같은 표현 금지.**

1. **무엇을 만드나** — `backend/src/store/postgres.ts`에 `createPostgresStore(pool: pg.Pool): CellGuardStore`를 구현한다. 인터페이스는 `backend/src/store/contract.ts`가 정본이다.
2. **완료 판정** — `backend/src/store/contract.test.ts` 맨 아래에 아래 한 줄을 추가하고 전부 통과시킨다.
   ```ts
   runStoreContractTests("postgres", async () => createPostgresStore(testPool));
   ```
3. **스키마** — `backend/migrations/001_app_auth.sql`에 8개 테이블이 이미 있다. 컬럼이 `store/types.ts`의 타입과 1:1로 맞는다. **스키마를 바꾸면 `store/types.ts`도 같이 바뀌므로 반드시 합의 후 변경한다.**
4. **⚠️ 먼저 풀어야 할 외래키 문제** — `battery_asset.owner_user_id`와 `measurement_session.owner_user_id`가 `not null references "user"(id)`인데, `"user"`는 Better Auth 코어 테이블이라 **아직 생성되지 않았고**(`npm run auth:generate` 미실행), 데모 사용자 `hong`·`kimeng`·`leelab`·`parktest`는 `store/memory.ts` 안에만 있다. 둘 중 하나를 골라야 한다.
   - (a) Better Auth 스키마를 생성·적용한 뒤, `AUTH_MODE=demo`로 부팅할 때 데모 4명을 `user`+`app_user_profile`에 `on conflict do nothing`으로 seed한다 — **권장**. 참조무결성이 유지되고 나중에 `AUTH_MODE=betterauth`로 바꿔도 스키마를 안 건드린다.
   - (b) 두 FK를 제거하고 `text` 컬럼으로 둔다 — 선행 작업이 없지만 고아 row를 DB가 막지 못한다.
5. **반드시 한 트랜잭션에 넣어야 하는 메서드 5개** — `changeRelay`, `changeOpsStatus`, `saveMemo`, `changeUserStatus`, `startSession`. 전부 도메인 변경 + `audit_log` 쓰기를 함께 하며, 계약 §3.4가 *"승인 후 명령 실행과 감사 기록을 원자적으로 처리"*를 요구한다. `backend/src/db.ts`의 `inTransaction()`을 쓴다.
6. **애플리케이션 체크에 의존하지 말 것** — 마이그레이션에 부분 유니크 인덱스가 이미 있다.
   ```sql
   unique (device_id)  where status = 'ACTIVE'    -- measurement_session
   unique (battery_id) where status = 'RUNNING'   -- diagnosis
   ```
   동시 요청 두 개가 "찾아보고 없으면 만든다"를 동시에 통과하므로, **제약 위반(PostgreSQL `23505`)을 잡아 `throw new Error("...")`로 옮긴다.**
   ⚠️ **계약 테스트는 이걸 못 잡는다.** 인메모리 구현체에는 동시성이 없어 스위트가 단일 스레드로 돌기 때문이다. PostgreSQL 구현체 쪽에 동시 `startSession` 두 건을 `Promise.all`로 던지는 테스트를 **따로** 추가해야 한다 — 하나는 성공, 하나는 도메인 에러여야 하고 활성 세션은 1건으로 남아야 한다.
7. **에러 code는 새로 만들지 않는다** — `docs/backend_contract.md` §1.10 목록이 고정이다. `server.ts`의 `errorFromDomain()`이 code→HTTP 상태를 매핑한다.
8. **방어 복사** — 반환한 객체를 호출부가 고쳐도 저장소가 오염되면 안 된다. SQL은 매번 새 객체를 만들므로 자연히 지켜지지만, 캐시를 넣는다면 이 규칙을 깨지 않아야 한다.
9. **게이트를 여는 시점** — 구현이 끝나면 `backend/src/server.ts:331`의 `DATA_MODE=postgres` 503 가드를 풀고, `backend/src/store.ts`의 `createMemoryStore()` 선택을 `DATA_MODE`에 따라 분기한다. **그전까지는 503이 정상이다.**
10. **최종 확인** — `AUTH_MODE=demo DATA_MODE=postgres`로 띄워 브라우저에서 로그인 → 배터리 연결 → 대시보드 → 릴레이 차단까지 돌고, **프로세스를 재시작해도 데이터가 남아 있을 것.**

- [ ] **Step 2: 상태 문서를 갱신한다**

`docs/implementation_status.md`의 §3 B1 항목에 아래를 반영한다.

- 제목을 `### B1. store.ts → PostgreSQL 리포지토리 교체 — **1단계 완료(2026-08-27) / 2단계 대기**`로 바꾼다
- 1단계 결과를 적는다: 인터페이스 `store/contract.ts`, 인메모리 구현체 `store/memory.ts`, facade `store.ts`, 계약 테스트 16건, 라우트 57개 async 전환, `asyncRoute` 래퍼
- 2단계는 별도 담당자이며 명세가 `docs/handover/b1-postgres-store.md`에 있다고 링크한다
- §"현재 저장소 상태" 표의 `백엔드 도메인 데이터 저장` 행을 `미착수` → `인터페이스 분리 완료 / PostgreSQL 구현체 대기`로 고친다

- [ ] **Step 3: 문서 린터를 돌린다**

Run: `cd /Users/jungjeahwan/Desktop/claude/han && python3 tools/contract_lint.py docs/product_contract.md`
Expected: `위반 0건`

- [ ] **Step 4: 커밋**

```bash
git add docs/handover/b1-postgres-store.md docs/implementation_status.md
git commit -m "docs: hand the PostgreSQL store implementation over as stage 2

The contract test suite is the acceptance criterion. Flags the user-table
foreign key that blocks any insert under AUTH_MODE=demo, and names the
five methods that must stay atomic with their audit-log write."
```

---

## 완료 판정 (전체)

- [ ] `cd backend && npm run typecheck` — 오류 0건
- [ ] `cd backend && npx vitest run` — 51건 PASS
- [ ] `cd frontend && npm run typecheck && npx vitest run && npx playwright test` — 57건 + 29건 PASS, **프론트 소스는 한 줄도 안 고쳤을 것**
- [ ] 단일 오리진(`localhost:3005`)에서 로그인 → 배터리 연결 → 대시보드 → 릴레이 차단까지 손으로 동작, 브라우저 콘솔 에러 0
- [ ] 아무 비밀번호로 로그인되고, 릴레이 재인증은 **로그인 때 친 값만** 통과
- [ ] `docs/handover/b1-postgres-store.md`가 존재하고 FK 문제·트랜잭션 5개·완료 판정을 담고 있음

## 범위 밖 (건드리지 말 것)

- PostgreSQL 구현체, 마이그레이션 실행, `DATA_MODE=postgres` 게이트 해제 — 2단계
- B3 Fail-Safe 판정 — B1 이후
- Better Auth 실인증(C2b), WS upgrade의 `DATA_MODE` 체크 — 보류 항목
- 카카오톡 발송 — 보류 항목
- `GET /api/trends/export.pdf` — 범위 밖 확정
