# 셀가드 백엔드 API 계약서 (REST + WebSocket)

> **이 문서는 프론트엔드가 백엔드에 요구하는 인터페이스 계약이다.**
> 백엔드 내부 구현(DB 스키마, Kafka 컨슈머 설계, 인덱스 전략)은 이 문서의 범위가 아니다.
> 다만 **§3 도메인 불변식**은 구현 방식과 무관하게 반드시 지켜져야 한다.

| 항목 | 값 |
|---|---|
| 작성일 | 2026-07-22 |
| 근거 기준 | `설계 산출물/셀가드 프로토타입_v3.html`, `docs/feature_definition.md`(REQ-WEB-001~072), `docs/admin_feature_definition.md`(REQ-WEB-101~136), `PLAN.md` |
| 검증 방법 | v3 번들에서 앱 소스 복원(코드 실측) + **로컬 HTTP로 띄워 전 화면 육안 확인**(2026-07-22, 사용자 10화면 + 관리자 6화면) |
| 대상 화면 | 19개 영역 (공개 3 · 일반 사용자 10 · 관리자 6) |

> **기능정의서보다 v3 화면이 우선한다.** `docs/feature_definition.md`는 v1(2026-07-10) 기준이라 v3와 어긋나는 항목이 여럿 확인됐다. 이 문서는 어긋난 곳마다 실측 결과를 명시했다 — §11에 모아 두었다.

## 0. 표기 규칙

각 항목 끝의 대괄호는 **근거 등급**이다. 백엔드 개발자는 `[정의 필요]`만 별도로 합의하면 된다.

| 표기 | 의미 |
|---|---|
| `[v3]` | v3 프로토타입에 실제로 존재하는 화면·데이터. 계약 확정. |
| `[REQ-xxx]` | 기능정의서 요구사항 근거. 계약 확정. |
| `[PLAN]` | `PLAN.md`/`CLAUDE.md`의 확정 스펙. |
| `[제안]` | 화면 요구를 만족시키기 위해 이 문서가 제안하는 설계. 백엔드가 더 나은 안을 내면 대체 가능. |
| `[정의 필요]` | 아직 결정되지 않음. **§9에 모아 두었다. 여기부터 합의할 것.** |

---

## 1. 공통 규약

### 1.1 기본

| 항목 | 값 |
|---|---|
| Base URL | `https://<host>/api` |
| 버전 | 경로 버전 없음. 파괴적 변경 시 `/api/v2` 신설 `[제안]` |
| Content-Type | `application/json; charset=utf-8` |
| 문자 인코딩 | UTF-8 |
| 시각 | **모든 timestamp는 ISO 8601 UTC (`2026-07-22T14:32:10.000Z`)**. 서버는 KST 문자열을 절대 내려보내지 않는다. 로컬 시간 변환은 프론트 책임. `[제안]` |
| 상대시간 | 서버는 `"3시간 전"` 같은 표현을 만들지 않는다. v3의 `time: '3시간 전'`은 프로토타입 하드코딩이며, 실제로는 절대 시각만 내려온다. `[v3 보정]` |
| 숫자 | 물리량은 **문자열이 아닌 number**로 내려준다. v3 mock이 `volt: '11.9'`처럼 문자열인 것은 프로토타입 편의이며 계약이 아니다. `[v3 보정]` |

### 1.2 인증

Better Auth 세션 쿠키 기반. `[PLAN]`

- `/api/auth/*`는 Better Auth 핸들러가 담당한다. 이 문서에서 재정의하지 않는다.
- 그 외 모든 엔드포인트는 **세션 쿠키(HttpOnly, SameSite=Lax, Secure)** 로 인증한다.
- 프론트는 모든 요청에 `credentials: 'include'`를 붙인다.
- 상태 변경(POST/PATCH/DELETE) 요청에는 CSRF 토큰이 필요하다. `[정의 필요 — Q1]`

### 1.3 권한

| 역할 | 값 | 접근 |
|---|---|---|
| 일반 사용자 | `USER` | `/api/*` (본인 소유 리소스만) |
| 관리자 | `ADMIN` | 위 전체 + `/api/admin/*` |

- **소유권 검증은 서버 책임이다.** `GET /api/batteries/{id}`에 남의 battery_id를 넣으면 `404`(존재 은폐)를 반환한다. `403`은 "존재는 한다"를 노출하므로 쓰지 않는다. `[제안]`
- 일반 사용자가 `/api/admin/*` 접근 시 `403 FORBIDDEN` + **감사 로그 기록**. v3 감사 로그에 `관리자 페이지 접근 실패 · 권한 없음 (RBAC)` 항목이 실제로 존재한다. `[v3]` `[REQ-WEB-133]`

### 1.4 에러 응답

모든 4xx/5xx는 아래 형태로 통일한다. `[제안]`

```json
{
  "error": {
    "code": "BATTERY_ALREADY_CONNECTED",
    "message": "다른 배터리가 이미 측정 중입니다.",
    "details": { "connectedBatteryId": "b1f2...", "sessionId": "s9a8..." }
  }
}
```

- `code`: 프론트가 분기하는 **기계용 식별자**. 절대 변경 금지.
- `message`: 사용자에게 그대로 보여줄 수 있는 한국어 문장. `[정의 필요 — Q2: 다국어]`
- `details`: 선택. 프론트가 후속 UI를 그리는 데 쓴다.

**공통 에러 코드**

| HTTP | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 입력 검증 실패. `details.fields[]`에 필드별 사유 |
| 401 | `UNAUTHENTICATED` | 세션 없음/만료 → 프론트는 로그인 화면으로 |
| 401 | `REAUTH_REQUIRED` | 위험 제어 재인증 실패 (§3.4) |
| 403 | `FORBIDDEN` | 권한 부족 |
| 403 | `ACCOUNT_SUSPENDED` | 정지된 계정 `[REQ-WEB-117]` |
| 404 | `NOT_FOUND` | 없거나 소유자가 아님 |
| 409 | `BATTERY_ALREADY_CONNECTED` | active 세션 중복 (§3.2) |
| 409 | `NO_ACTIVE_SESSION` | 세션 없이 측정 대상 동작 요청 |
| 409 | `INTERLOCK_LOCKED` | Fail-Safe 인터락이 사용자 조작을 거부 (§3.3) |
| 409 | `DEVICE_OFFLINE` | 대상 진단기 오프라인 → 릴레이 제어 불가 |
| 422 | `REASON_REQUIRED` | 사유 입력 필수인 동작에 사유 누락 |
| 429 | `RATE_LIMITED` | `Retry-After` 헤더 동반 |
| 500 | `INTERNAL_ERROR` | 그 외 |

### 1.5 목록 조회 공통 규약 `[제안]`

목록을 반환하는 모든 엔드포인트는 아래 쿼리와 응답 봉투를 공유한다.

**쿼리 파라미터**

| 이름 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `page` | int | `1` | 1-base |
| `size` | int | `20` | 최대 100 |
| `sort` | string | 엔드포인트별 | `필드,방향` 예: `score,desc` |
| `q` | string | — | 검색어. 대상 필드는 엔드포인트별로 명시 |
| `from` / `to` | ISO8601 | — | 기간 필터 (`from` 이상, `to` 미만) |

**응답 봉투**

```json
{
  "items": [ /* ... */ ],
  "page": { "number": 1, "size": 20, "total": 116, "totalPages": 6 }
}
```

> v3 이벤트 이력이 `전체 116건 중 1–5`를 표시한다 `[v3]`. `total`은 필터 적용 후 건수다.

### 1.6 이상점수(anomaly score) 스케일 규약 — **중요**

v3 UI는 이상점수를 **0–100 정수**로 표시하고(`score: 82`), `PLAN.md`/`CLAUDE.md`의 AI 스펙은 **0.0–1.0 실수**다. 두 스케일이 문서마다 섞여 있어 실제로 v3에 등급 판정 버그가 존재한다(아래).

**계약:**

- API는 **`score`를 0.0–1.0 실수(소수점 4자리)로 내려준다.** AI 파이프라인이 산출하는 원값 그대로다. `[PLAN]`
- API는 **`grade`를 함께 내려준다.** 프론트는 절대 임계값을 직접 비교하지 않는다.
- 화면 표시용 0–100 정수는 프론트가 `Math.round(score * 100)`으로 만든다.

```json
{ "score": 0.8213, "grade": "DANGER" }
```

**임계치는 시스템 고정값이다.** 사용자·관리자 모두 변경할 수 없다(임계치 설정 기능은 제거됨). 그래도 `grade`를 서버가 계산해 동봉하는 이유는 **판정 로직을 한 곳에만 두기 위해서다** — 프론트·백엔드·AI가 각자 임계값을 들고 있으면 v3에서 실제로 벌어진 것과 똑같은 3-벌 분기 사고가 재현된다.

> **프론트 작업 메모:** v3의 Raw 데이터 모달은 `anomaly_score`를 `82`로 표시한다. "원본 데이터"를 표방하는 화면이 가공값을 보여주는 셈이므로, 실제 구현에서는 `0.82`로 고친다.

**등급 정의** `[PLAN]`

| grade | 한국어 | score 범위 |
|---|---|---|
| `NORMAL` | 정상 | 0.0 ≤ s < 0.3 |
| `CAUTION` | 주의 | 0.3 ≤ s < 0.6 |
| `WARNING` | 경고 | 0.6 ≤ s < 0.8 |
| `DANGER` | 위험 | 0.8 ≤ s ≤ 1.0 |

**⚠ v3 프로토타입의 알려진 버그 — 구현하지 말 것**

v3에는 판정 로직이 **세 벌** 존재하고 서로 어긋난다.

| 위치 | 로직 | 등급 수 |
|---|---|---|
| 랜딩 게이지 (`scoreLabel` 계산) | `≥80 위험 / ≥60 경고 / ≥30 주의` | 4등급 — **정상** |
| 대시보드 (`dScoreLabel` 계산) | `≥70 위험 / ≥40 주의` | 3등급 — **버그** |
| 게이지 범례 (`T.band0/band40/band70`) | `정상 0–39 / 주의 40–69 / 위험 70+` | 3등급 — **버그** |
| 관리자 배터리 목록 (`scCol` 계산) | `≥70 / ≥40` | 3등급 — **버그** |

계약은 **4등급(0.3/0.6/0.8)** 하나뿐이다. 백엔드는 v3의 70/40을 참고하지 말 것.

**브라우저 실측 증거 (2026-07-22)**

- 배터리 관리 화면의 **PACK-003은 이상점수 33인데 배지가 `정상`** 이다. 4등급이면 `주의`여야 한다. 3등급 버그가 화면에 그대로 드러난 사례.
- 반대로 관리자 배터리 운영 로그에는 **`이상점수 위험 구간 진입 — 82 (위험 임계 80)`** 이라고 적혀 있다. **v3 자신도 일부 화면에서는 80을 정답으로 쓰고 있다.**
- 대시보드 게이지 범례 `정상 0–39 / 주의 40–69 / 위험 70+` 는 화면에 실재하며, 4등급으로 교체해야 한다.

**등급 판정은 서버가 한다.** 사용자가 설정 화면에서 임계치를 조정할 수 있기 때문이다(§4.4 임계치 탭 `[v3]`). 임계치가 사용자별로 다르므로 프론트가 하드코딩하면 반드시 어긋난다.

### 1.7 상태·등급 enum 일람

프론트/백엔드가 공유하는 문자열 상수. **한국어 라벨은 프론트가 매핑한다. 서버는 enum 코드만 내려준다.** `[제안]`

| 도메인 | enum |
|---|---|
| 이상 등급 | `NORMAL` `CAUTION` `WARNING` `DANGER` |
| 배터리 운영 상태 (관리자) | `NORMAL` `WATCH` `BLOCKED` `[v3]` `[REQ-WEB-121]` |
| 계정 상태 | `ACTIVE` `SUSPENDED` `[v3]` `[REQ-WEB-112]` |
| 계정 권한 | `USER` `ADMIN` `[REQ-WEB-113]` |
| 디바이스 상태 | `ONLINE` `DELAYED` `OFFLINE` `[v3]` |
| 릴레이 상태 | `CLOSED`(정상 연결) `OPEN`(차단됨) `[v3]` |
| 측정 모드 | `1` `2` `3` (정수) `[PLAN]` |
| 배터리 종류 | `LI_ION` `LI_PO` `[v3: newChem='li_ion']` |
| 세션 상태 | `ACTIVE` `COMPLETED` `ABORTED` `[제안]` |
| 이벤트 심각도 | `NORMAL` `CAUTION` `WARNING` `DANGER` `CUT`(차단) `[v3: evtChips]` |
| 알림 채널 | `KAKAO` `EMAIL` `SMS` `WEBPUSH` `INAPP` `[v3]` `[REQ-WEB-065]` |
| 공지 카테고리 | `IMPORTANT`(중요) `MAINTENANCE`(점검) `FEATURE`(기능) `INFO`(안내) `[v3]` |
| 공지 게시 상태 | `PUBLISHED` `DRAFT` `ARCHIVED` `[v3]` `[REQ-WEB-131/132]` |

> 이벤트 필터 칩은 v3에서 `전체·위험·경고·주의·차단·정상` 6종이다 `[v3]`. `차단`은 등급이 아니라 이벤트 종류(릴레이 차단)이므로 심각도 enum에 `CUT`을 추가했다.

### 1.8 단위 규약 `[PLAN]`

| 필드 | 단위 |
|---|---|
| `voltageV` | V |
| `currentA` | A |
| `powerW` | W |
| `socPct` | % (0–100 정수) |
| `tempContact`, `tempIrSurface` | °C |
| `insulationMohm` | MΩ |
| `gasRaw`, `pressureRaw`, `acousticRaw` | ADC raw (무차원 정수) |
| `dTdt` | °C/min `[v3: '+2.8 °C/min']` |

---

## 2. 리소스 식별자 규약 `[제안]`

v3는 배터리를 `PACK-001` 문자열로 식별하지만, `PLAN.md`는 `battery_id`를 UUID로 규정한다. 둘 다 필요하다.

| 필드 | 타입 | 용도 |
|---|---|---|
| `id` | UUID | **API 경로·참조에 쓰는 유일 키.** 사용자에게 노출하지 않음 |
| `label` | string | 사용자가 보는 표시명. v3의 `PACK-001`에 해당. 사용자 내에서 유일 `[정의 필요 — Q4]` |

동일 규칙을 `session`(v3 `SES-2041`), `device`(v3 `SN-00124`)에도 적용한다.

> **프론트는 URL과 상태에 `id`만 쓴다.** `label`은 렌더링 전용이다. 백엔드가 `label`을 경로 키로 받도록 만들면, 사용자가 배터리 이름을 바꾸는 순간 링크가 깨진다.

---

## 3. 도메인 불변식 — 서버가 반드시 강제할 것

프론트가 UI로 막더라도 **서버에서 다시 막아야 한다.** 아래는 전부 v3 화면 동작에서 실측한 규칙이다.

### 3.1 배터리 미연결 시 기능 잠금 게이트 `[v3]` **← 기존 기능정의서에 없는 항목**

v3 소스(내비게이션 항목 생성 함수 `item()`):

```js
const gated = !this.state.isAdmin && !connectedId;
const locked = gated && r !== 'battery';
```

**연결된 배터리가 없는 일반 사용자는 `배터리 자산관리`를 제외한 8개 메뉴가 전부 잠긴다.** (대시보드·이상 탐지·추세·이벤트·알림 센터·공지사항·릴레이 제어·설정)

안내 문구도 실재한다 — *"먼저 측정할 배터리를 선택하세요. — 배터리를 연결해야 대시보드·측정 세션·이상 탐지에 접근할 수 있습니다."* `[v3: T.pickFirst]`

**서버 요구사항:** active 세션이 없는 사용자가 대시보드/이상탐지/릴레이 계열 엔드포인트를 호출하면 `409 NO_ACTIVE_SESSION`. 관리자는 예외.

> 이 규칙은 `docs/` 문서 4종 어디에도 기록되어 있지 않다. 프론트 라우팅 가드와 서버 검증이 동시에 필요하다.

### 3.2 배터리 연결 단일성 (active 세션 1개) `[v3]` `[PLAN: S-MSESSN]`

*"한 번에 하나의 배터리만 연결됩니다. 기존 연결은 해제됩니다."* `[v3: T.cnOneAtTime]`

- 사용자당 `ACTIVE` 상태 `measurement_session`은 **최대 1개**.
- 새 배터리 연결 요청 시 서버가 **기존 세션을 원자적으로 종료하고** 새 세션을 연다. 프론트가 "종료 → 시작" 2콜로 나누지 않는다(중간 실패 시 무세션 상태로 빠짐).
- 모드 인터락: 새 세션의 `targetMode`가 이전과 다르면 **이전 모드 릴레이를 먼저 차단**한 뒤 전환한다. `[PLAN: S-LWVJRY]`

### 3.3 Fail-Safe 우선순위 `[v3]` `[PLAN: S-VMNNAM]`

*"Fail-Safe 인터락은 사용자 조작보다 우선합니다."* `[v3: T.failsafeNote]`

- 가스·압력·음향 임계 초과 또는 온도 상한 초과 시, **AI 판정과 무관하게** 즉시 릴레이 차단. `[PLAN]`
- 인터락이 걸린 상태에서 사용자의 릴레이 복구 요청은 `409 INTERLOCK_LOCKED`.
- 자동 차단이 발생하면 **WebSocket으로 즉시 푸시**해야 한다. 프론트는 이때 자동 차단 모달을 띄운다. `[v3: autoCutOpen]` `[REQ-WEB-064]`

### 3.4 위험 제어 승인 절차 `[v3]` `[REQ-WEB-062/063]`

*"이 조작은 사유 입력과 재인증을 요구하며, 승인자·시간·IP가 감사 추적에 기록됩니다."* `[v3: T.rmNote]`

릴레이 차단/복구 요청은 **한 번의 호출에 사유와 비밀번호를 함께** 받는다.

- `reason` 누락 → `422 REASON_REQUIRED`
- `password` 불일치 → `401 REAUTH_REQUIRED`
- 성공 시 감사 로그에 `{ actorId, action, targetId, reason, ip, userAgent, at }` 기록

### 3.5 감사 로그 불변성 `[v3]` `[REQ-WEB-136]`

*"수정·삭제 불가"* `[v3: T.aaImmutable]`

- 감사 로그에는 **생성과 조회 엔드포인트만 존재한다.** `PATCH`/`DELETE`를 만들지 않는다.
- 관리자 UI에서도 수정 수단을 제공하지 않는다.
- 보존 기간 `[정의 필요 — Q5]`

### 3.6 감사 대상 동작 목록 `[v3]` `[REQ-WEB-118/126]`

아래 동작은 **반드시** 감사 로그를 남긴다.

| action | 대상 | 사유 필수 |
|---|---|---|
| `RELAY_CUT` / `RELAY_RESTORE` | battery | ✅ |
| `RELAY_AUTO_CUT` (Fail-Safe) | battery | 시스템 자동 (사유=트리거 조건) |
| `USER_SUSPEND` / `USER_RESTORE` | user | ✅ `[REQ-WEB-117]` |
| `USER_UPDATE` | user | — |
| `USER_PASSWORD_RESET` | user | — `[REQ-WEB-116]` |
| `BATTERY_OPS_STATUS_CHANGE` | battery | `BLOCKED`로 변경 시 ✅ `[REQ-WEB-125]` |
| `BATTERY_MEMO_UPDATE` | battery | — `[REQ-WEB-124]` |
| `NOTICE_PUBLISH` / `NOTICE_ARCHIVE` / `NOTICE_DELETE` | notice | — |
| `ADMIN_ACCESS_DENIED` | route | 시스템 자동 |
| `ADMIN_LOGIN` | — | 시스템 자동 |

---

## 4. REST API

### 4.1 세션 · 내 정보

#### `GET /api/me` — 앱 부팅 시 1회

앱 셸이 렌더링되기 전에 필요한 모든 것을 한 번에 준다. `[제안]`

```json
{
  "user": {
    "id": "u_01H...",
    "name": "홍길동",
    "email": "hong@cellguard.io",
    "phone": "010-1234-5678",
    "role": "USER",
    "status": "ACTIVE",
    "avatarUrl": null,
    "createdAt": "2025-03-12T00:00:00.000Z"
  },
  "activeSession": {
    "id": "s_01H...",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "mode": 1,
    "startedAt": "2026-07-22T05:12:00.000Z"
  },
  "unreadAlertCount": 2,
  "activeAnomalyCount": 9,
  "preferences": { "theme": "light", "lang": "ko" }
}
```

- `activeSession`이 `null`이면 프론트는 **§3.1 게이트 모드**로 진입한다.
- `unreadAlertCount` → 사이드바 `알림 센터` 배지 `[v3: badge '2']`
- `activeAnomalyCount` → 사이드바 `이상 탐지` 배지 `[v3: badge '9']`

#### `POST /api/auth/sign-out` — Better Auth 위임 `[REQ-WEB-014]`

### 4.2 배터리 자산관리 (F6)

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/batteries` | `[REQ-WEB-032]` |
| `POST` | `/api/batteries` | `[REQ-WEB-036/037]` |
| `GET` | `/api/batteries/{id}` | `[REQ-WEB-040]` |
| `PATCH` | `/api/batteries/{id}` | `[REQ-WEB-038]` |
| `GET` | `/api/batteries/{id}/sessions` | `[REQ-WEB-041]` |

#### `GET /api/batteries`

쿼리: `mode`(1\|2\|3, 미지정=전체 `[REQ-WEB-033]`), `sort`(`recent`\|`score`\|`soc`, 기본 `recent` `[REQ-WEB-051]`), `page`, `size`

```json
{
  "items": [{
    "id": "b_01H...",
    "label": "PACK-001",
    "chemistry": "LI_ION",
    "seriesCount": 3,
    "maker": "Samsung SDI",
    "model": "18650",
    "targetMode": 1,
    "isConnected": true,
    "latest": {
      "voltageV": 11.9,
      "currentA": 2.4,
      "tempC": 58.0,
      "socPct": 78,
      "score": 0.82,
      "grade": "DANGER",
      "measuredAt": "2026-07-22T14:32:10.000Z"
    },
    "lastMeasuredAt": "2026-07-22T14:32:10.000Z"
  }],
  "page": { "number": 1, "size": 20, "total": 5, "totalPages": 1 }
}
```

- `latest`는 **아직 한 번도 측정되지 않은 배터리에서 `null`** 이다. 프론트는 이 경우 대시보드 값을 `—`로 그린다.
- `model`은 v3에서 `'18650 Li-ion · 3S'`처럼 합성 문자열이지만, 계약에서는 **`maker`/`model`/`chemistry`/`seriesCount`를 분리해 내려준다.** 표시 문자열 조립은 프론트 책임. `[v3 보정]`

#### `POST /api/batteries` `[REQ-WEB-037]`

```json
{
  "label": "PACK-006",
  "chemistry": "LI_ION",
  "seriesCount": 3,
  "targetMode": 2,
  "maker": "Samsung SDI",
  "model": "18650"
}
```

- `chemistry` **필수** `[PLAN]`
- `seriesCount` 선택 `[PLAN]`
- `targetMode` 필수 — 재연결 시 모드 재선택을 없애기 위해 배터리에 고정된다 `[PLAN]`
- 201 응답 본문은 생성된 배터리 객체 전체 (프론트가 목록에 즉시 삽입)

- `maker` / `model` **선택** — 카드·상세의 `18650 Li-ion · 3S` 표시에 쓴다.

> **v3 등록 폼에는 `maker`/`model` 입력이 없다** `[v3 실측]`. 입력은 `배터리 이름 / 종류(리튬이온·리튬폴리머) / 측정 모드(1·2·3) / 직렬 셀 수(S)` 4개뿐이고, 안내 문구는 `등록 시 battery_id(UUID)가 발급되고 측정 모드가 자산에 고정됩니다`이다.
> **결정: 등록 폼에 입력을 추가한다.** 백엔드 스키마는 위 요청 본문 그대로 가고, **프론트가 등록·수정 모달에 `제조사`·`모델` 입력 2개를 추가한다**(§12-11). 둘 다 선택 입력이므로 미입력 시 카드 표시는 `리튬이온 · 3S`로 축약한다.

#### `GET /api/batteries/{id}` — 배터리 상세/이력 (F7) `[REQ-WEB-040/044]`

```json
{
  "id": "b_01H...",
  "label": "PACK-001",
  "chemistry": "LI_ION",
  "seriesCount": 3,
  "targetMode": 1,
  "owner": { "id": "u_01H...", "name": "홍길동" },
  "current": {
    "voltageV": 11.9, "currentA": 2.4, "tempC": 58.0, "socPct": 78,
    "score": 0.82, "grade": "DANGER", "measuredAt": "..."
  },
  "health": {
    "sohPct": 87.4,
    "rulCycles": 480,
    "cycleCount": 312,
    "internalResistanceMohm": 24.8,
    "calculatedAt": "2026-07-22T00:00:00.000Z"
  },
  "scoreTrend30d": [
    { "date": "2026-06-23", "maxScore": 0.44, "avgScore": 0.21 }
  ]
}
```

- `health` 4개 필드는 v3 화면에 실측 확인했다 — `SOH 92% · RUL ~480 사이클 · 누적 사이클 312 · 내부 저항 18.4 mΩ` `[v3]` `[REQ-WEB-044]`.
  **이 값들을 누가 계산하는지는 `[정의 필요 — Q6]`.** AI 파이프라인 산출물인지 백엔드 집계인지 미정.
- `scoreTrend30d`는 일 단위 집계 30건 `[v3: T.scoreTrend30]`.
- 상세 화면은 `battery_id`의 UUID 앞자리를 **화면에 직접 노출한다**(`battery_id · a7f3c9-…`) `[v3]`. §2의 `id`/`label` 분리가 v3 설계와 일치한다.
- 상세 화면에는 **V·I·T·SOC 추세 4차트 + 기간 탭(24시간/7일/30일)** 이 함께 있다 `[v3]`. §4.7 `GET /api/trends`를 `batteryIds` 1개로 호출해 재사용한다.

> **셀 단위 데이터는 전부 범위에서 제외한다.** v3 상세 화면에 `셀 온도 히트맵 · 24셀 (3S8P)`가 렌더링되고 이벤트·알림에도 셀 번호가 붙지만(`온도 임계값 초과 · 셀 3`, Raw 모달의 `cell_index: 3`), **셀 단위 측정을 하지 않기로 결정되었다.**
> 따라서 셀별 온도 배열 API도, 이벤트·알림의 `cellIndex`도 만들지 않는다. 배터리 등록에 병렬 셀 수(P)도 받지 않는다. 온도는 `temp_contact`(접촉)·`temp_ir_surface`(IR 표면) 두 값뿐이다 `[PLAN]`.

#### `GET /api/batteries/{id}/sessions` `[REQ-WEB-041]`

v3 테이블 컬럼: `세션 ID · 기간 · 최고 이상점수 · 상태 · 보기` `[v3]`

```json
{
  "items": [{
    "id": "s_01H...",
    "label": "SES-2041",
    "startedAt": "2026-06-29T05:20:00.000Z",
    "endedAt": "2026-06-29T07:40:00.000Z",
    "peakScore": 0.82,
    "peakGrade": "DANGER",
    "status": "COMPLETED"
  }],
  "page": { "number": 1, "size": 20, "total": 3, "totalPages": 1 }
}
```

### 4.3 측정 세션 (배터리 연결/해제)

#### `POST /api/sessions` — 배터리 연결 & 측정 시작 `[REQ-WEB-039]`

```json
{ "batteryId": "b_01H...", "deviceId": "d_01H..." }
```

- **§3.2에 따라 기존 active 세션을 서버가 원자적으로 종료한다.** 별도 종료 호출을 요구하지 않는다.
- `deviceId`는 `[정의 필요 — Q7]`. v3에는 진단기 선택 UI가 없다(디바이스 화면 `devices`는 도달 불가 고아 라우트). 사용자당 진단기가 1대라고 가정하면 서버가 자동 선택할 수 있다.
- 응답 `201`:

```json
{
  "id": "s_01H...", "label": "SES-2045",
  "batteryId": "b_01H...", "batteryLabel": "PACK-001",
  "mode": 1, "status": "ACTIVE", "startedAt": "..."
}
```

- 대상 배터리의 진단기가 오프라인이면 `409 DEVICE_OFFLINE`.

#### `DELETE /api/sessions/{id}` — 측정 종료

응답 `200` + 종료된 세션 요약(`peakScore`, `endedAt`).

> **에지 음성 안내 연동:** 세션 시작/종료는 `battery-events` 토픽으로 발행되어 라즈베리파이가 로컬 음성파일을 재생한다 `[PLAN: S-VOCALR]`. 이 발행은 백엔드 책임이며 프론트는 관여하지 않는다.

### 4.4 실시간 관제 (F4)

#### `GET /api/dashboard` — 초기 스냅샷 `[REQ-WEB-019/021/024]`

WebSocket 연결 **전에** 화면을 채우기 위한 1회 조회. 이후 갱신은 §5 WebSocket이 담당한다. `[제안]`

**v3 대시보드의 실제 구성** (브라우저 실측): 배터리 헤더 + 상태 배너 + 이상점수 게이지 → 빠른 추세 4카드(V/I/T/SOC, 각 카드에 개별 상태 배지) → V·I·T·SOC 추세 차트 1개(지표 선택 버튼) → 공지사항 3건. **이게 전부다.**

> **REQ-WEB-025(위험도 분포)·REQ-WEB-026(최근 이벤트)은 대시보드에 없다.** 둘 다 이상 탐지 화면(F8)에 있다. 기능정의서가 v1 기준이라 낡았다. → §4.5로 옮겼다.

```json
{
  "session": { "id": "s_01H...", "batteryId": "b_01H...", "batteryLabel": "PACK-001", "mode": 1, "startedAt": "..." },
  "metrics": {
    "voltageV":     { "value": 11.9, "status": "OK" },
    "currentA":     { "value": 2.4,  "status": "OK" },
    "powerW":       { "value": 28.5, "status": "OK" },
    "tempContact":  { "value": 58.0, "status": "WARN" },
    "tempIrSurface":{ "value": 59.2, "status": "WARN" },
    "socPct":       { "value": 78,   "status": "OK" },
    "measuredAt": "2026-07-22T14:32:10.000Z"
  },
  "anomaly": {
    "score": 0.82, "grade": "DANGER",
    "aeScore": 0.79, "informerScore": 0.86,
    "evaluatedAt": "..."
  },
  "relay": { "state": "OPEN", "reason": "FAILSAFE_TEMP", "changedAt": "..." },
  "notices": [ /* NoticeSummary × 3 */ ],
  "quickTrend": {
    "metric": "temp",
    "points": [{ "at": "...", "value": 57.2 }]
  }
}
```

**`metrics` 각 항목은 `{ value, status }` 객체다.** v3 빠른 추세 카드가 전압 `정상`, 온도 `⚠ 경고`처럼 지표마다 배지를 따로 단다 `[v3 실측]`. 이상점수 등급과 **다른 축**이며, **서버가 지표별 고정 임계값으로 판정해 `status`를 동봉한다.**

- `status`: `OK` \| `WARN` \| `CRIT`
- **프론트는 물리량 임계값을 하드코딩하지 않는다.** §1.6의 이상점수와 같은 원칙 — 판정 로직은 서버 한 곳에만 둔다.
- 임계값은 **시스템 고정**이며 사용자가 바꿀 수 없다(임계치 설정 기능 제거와 일관).
- 구체적 수치는 안전 스펙에서 확정한다 `[정의 필요 — Q27]`. v3 코드에 남아 있는 유일한 근거는 온도 `>= 55°C → 경고`(`dTempWarn`)뿐이다. 전압은 `chemistry`·`seriesCount`에 따라 셀당 상·하한을 환산해야 하므로 배터리마다 값이 달라진다.

> **Fail-Safe 임계와 구분할 것.** 이 `status`는 **표시용 경고**다. 릴레이를 차단하는 물리 임계(§3.3)와 같은 값을 쓸 필요는 없으며, 오히려 `CRIT`이 Fail-Safe보다 먼저 뜨도록 낮게 잡는 편이 경고 목적에 맞다.
- `aeScore`/`informerScore`는 이중 모델 개별 점수 `[PLAN: S-FGKMXE]`. v3 화면에는 없다. 없으면 `null`.
- `notices`는 대시보드 하단 공지 3건 `[v3]` `[REQ-WEB-028]`. §4.9 `NoticeSummary`와 동일 스키마(제목·카테고리·요약·게시일).
- `quickTrend.metric`은 `volt|curr|temp|soc` 중 프론트가 선택 `[v3: dMetric]` `[REQ-WEB-024]`. 쿼리 `?metric=temp`로 지정.

> **임계치 설정 API는 없다.** v3 코드에 `T.thWatch/thWarn/thDanger/tempCap` 라벨이 남아 있지만 설정 화면에 렌더링되지 않으며(탭은 `알림 수신 / 계정 정보 / 테마·캘리브레이션` 3개뿐), **임계치 설정 기능은 제거하기로 결정되었다.** 등급 임계값은 §1.6의 고정값(0.3/0.6/0.8)이다.

### 4.5 이상 탐지 (F8)

#### `GET /api/anomaly/summary` `[REQ-WEB-042]` `[REQ-WEB-025]`

```json
{
  "activeCount": 9,
  "todayCount": 23,
  "peakScore": 0.91,
  "peakAt": "2026-06-29T05:24:00.000Z",
  "model": { "status": "RUNNING", "lastInferenceAt": "...", "version": "ae-1.3+informer-0.9" },
  "riskDistribution": { "NORMAL": 3, "CAUTION": 1, "WARNING": 0, "DANGER": 1 }
}
```

- `model.status`: `RUNNING` \| `DEGRADED` \| `STOPPED` `[v3: T.modelStatus/running]`
- **`riskDistribution`은 요청한 사용자가 소유한 배터리만 집계한다.** v3 화면은 `정상 112 / 주의 11 / 경고 3 / 위험 2`(합 128)를 보여주지만 해당 계정의 배터리는 5개뿐이며, 이는 프로토타입 더미 숫자다. 실제로는 소유 배터리 수와 합이 일치해야 한다.
- 4등급 전부를 키로 내려준다. 0건인 등급도 `0`으로 포함한다(프론트가 4칸 고정 레이아웃).

#### `GET /api/anomaly/evidence` — XAI 기여 요인 `[REQ-WEB-043]`

v3가 표시하는 4개 특징: `dT/dt(온도 상승률)`, `I_smooth(전류 변화량)`, `V_drop(전압 강하)`, `SOC_delta(SOC 변화율)` `[v3: T.f1~f4]`

```json
{
  "batteryId": "b_01H...",
  "score": 0.82,
  "evaluatedAt": "...",
  "contributions": [
    { "feature": "dT_dt",     "label": "dT/dt (온도 상승률)",     "contribution": 0.42 },
    { "feature": "I_smooth",  "label": "I_smooth (전류 변화량)",  "contribution": 0.28 },
    { "feature": "V_drop",    "label": "V_drop (전압 강하)",      "contribution": 0.19 },
    { "feature": "SOC_delta", "label": "SOC_delta (SOC 변화율)",  "contribution": 0.11 }
  ]
}
```

- **합이 1이 되도록 정규화하지 않는다.** v3 실측값은 `+0.42 / +0.28 / +0.16 / +0.09`로 합이 **0.95**다. 각 특징이 이상점수에 기여한 양이며 서로 독립이다. 프론트는 최댓값 기준으로 막대 폭을 잡는다.
- **`contribution`은 0 이상 실수다.** 음의 기여(이상점수를 낮추는 방향)는 내려보내지 않는다. 따라서 프론트는 단방향 막대만 그리면 된다.
- 내림차순 정렬 보장.
- `label`을 서버가 줄지 프론트가 매핑할지는 `[정의 필요 — Q2]`(다국어와 연동).

#### `GET /api/anomaly/events` — 활성 이상 이벤트 `[REQ-WEB-045]`

`/api/events`의 `?status=active` 뷰. §4.6과 동일 스키마.

### 4.6 이벤트 이력 (F10)

#### `GET /api/events` `[REQ-WEB-049~053]`

쿼리: `q`(이벤트명·배터리 라벨 검색), `severity`(`DANGER|WARNING|CAUTION|CUT|NORMAL`, 복수 가능), `batteryId`, `from`, `to`, `page`, `size`

**정렬 파라미터는 없다.** v3 이벤트 화면에 정렬 UI가 없다(검색창 + 상태 칩 6종 + 페이지네이션뿐). 항상 `occurredAt desc` 고정이다. `REQ-WEB-051`이 말하는 `최근 측정순 / 이상점수 높은순 / SOC 낮은순` 드롭다운은 **배터리 관리 화면(F6)의 것**이며, 기능정의서가 이벤트 화면으로 잘못 분류했다 `[v3 실측]`.

```json
{
  "items": [{
    "id": "e_01H...",
    "occurredAt": "2026-07-22T14:32:10.000Z",
    "name": "릴레이 자동 차단 (Kill-Switch)",
    "type": "RELAY_AUTO_CUT",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "score": null,
    "grade": null,
    "severity": "CUT",
    "source": "SYSTEM",
    "cause": "온도 임계값 초과에 따른 Fail-Safe 자동 차단",
    "action": "자동 차단 후 관제팀 알림 발송"
  }],
  "page": { "number": 1, "size": 20, "total": 116, "totalPages": 6 }
}
```

- `source`: `SYSTEM`(시스템 자동) \| `AI`(이상탐지 엔진) \| `INGEST`(수집 서버) \| `USER` `[v3: by 필드]`
- `score`는 릴레이 차단·하트비트 누락처럼 점수가 없는 이벤트에서 `null` (v3는 `'—'` 문자열) `[v3 보정]`
- **`cellIndex`는 없다.** v3 이벤트명이 `온도 임계값 초과 · 셀 3`이지만 셀 단위 측정을 하지 않기로 했다(§4.2). 이벤트명에서 `· 셀 N`을 뺀다.
- 상세 모달은 목록 항목만으로 렌더링 가능하다 — v3 상세는 `배터리/이상점수/발생 시각/탐지 주체/원인/조치` 6행이며 전부 위 필드에 포함된다 `[v3]`. **별도 상세 엔드포인트 불필요.**
- 목록의 `시간` 컬럼은 `14:32:10`처럼 시:분:초만 표시하고 상세에서 `2026-07-03 14:32:10`으로 날짜를 보여준다 `[v3]`. 서버는 §1.1대로 항상 완전한 ISO 8601을 내려주고, 잘라 쓰는 건 프론트가 한다.

> **CSV/PDF 내보내기는 이벤트 화면에 없다** `[v3 실측]`. 버튼은 **추세 차트 화면**에 있다 → §4.7 참조. `REQ-WEB-054/055`가 "이벤트 또는 이력 조회 결과"라고 적은 것은 v3와 맞지 않는다.

### 4.7 추세 차트 (F9)

#### `GET /api/trends` `[REQ-WEB-046/047/048]`

쿼리:

| 이름 | 값 | 근거 |
|---|---|---|
| `period` | `24h` \| `7d` \| `30d` | `[v3: periodCfg]` `[REQ-WEB-046]` |
| `batteryIds` | 콤마 구분, 최대 N개 | `[v3: comparePacks]` `[REQ-WEB-048]` |
| `sessionIds` | 콤마 구분 (배터리 대신 세션 비교) | `[v3: cmpTitle '다중 배터리 / 세션 비교']` |

**`metrics` 파라미터는 없다.** v3 추세 화면은 전압·전류·온도·SOC **4개 차트를 항상 동시에** 렌더링한다. 지표 선택 UI가 없으므로 응답은 항상 4지표 전부를 담는다 `[v3 실측]`. (`REQ-WEB-047`이 말하는 "표시 지표 선택"은 **대시보드**의 지표 버튼이며, 추세 화면의 기능이 아니다.)

```json
{
  "period": "7d",
  "buckets": ["2026-06-23T00:00:00.000Z", "..."],
  "series": [{
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "metric": "temp",
    "unit": "°C",
    "points": [34.2, 35.1, null, 38.9]
  }]
}
```

- **버킷 시각은 `buckets`에 한 번만, 각 시리즈는 값 배열만.** 시리즈마다 `{at, value}` 객체를 반복하면 30일 × 4지표 × 5배터리에서 페이로드가 수 MB가 된다.
- 데이터 없는 구간은 `null` (0이 아님). 프론트는 선을 끊는다.
- 다운샘플링 규칙 `[정의 필요 — Q10]`: `24h`=1시간, `7d`=1일, `30d`=1일 집계를 제안. v3 포인트 수는 각각 25/7/30이다 `[v3: periodCfg.n]`.
- 집계 방식(avg/max)도 함께 정해야 한다. **온도·이상점수는 `max`, 전압·SOC는 `avg`가 안전하다** — 피크를 평균으로 뭉개면 열폭주 전조가 사라진다. `[제안]`

#### `GET /api/trends/export` `[REQ-WEB-054/055]`

CSV·PDF 버튼은 **추세 화면 상단, 기간 탭 옆**에 있다 `[v3 실측]`.

쿼리: `GET /api/trends`의 파라미터 전부 + `format=csv|pdf`

- 응답: `200` + `Content-Disposition: attachment`
- 대용량 대비 비동기 처리 필요 여부 `[정의 필요 — Q9]`

### 4.8 알림 센터 (F11)

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/alerts` | `[REQ-WEB-056]` |
| `GET` | `/api/alerts/summary` | `[v3 실측]` |
| `POST` | `/api/alerts/{id}/ack` | `[REQ-WEB-057]` |
| `POST` | `/api/alerts/ack-all` | `[REQ-WEB-058]` |

#### `GET /api/alerts/summary` — 오늘의 알림 요약

v3 알림 센터 상단에 **"오늘의 알림 요약 — 확인이 필요한 알림 N건"** 카드가 있고, 우측에 `위험 1 / 경고 2 / 정상·점검 2` 3칸이 붙는다 `[v3 실측]`. 기능정의서에 없던 항목이다.

```json
{
  "unacknowledgedCount": 1,
  "today": { "DANGER": 1, "WARNING": 2, "NORMAL_OR_CHECK": 2 }
}
```

> **3칸이다.** `정상`과 `점검`(디바이스 이벤트)을 한 칸에 합쳐 보여준다. 4등급 분포와 다른 축이므로 §4.5의 `riskDistribution`을 재사용하지 말 것.

```json
{
  "items": [{
    "id": "al_01H...",
    "severity": "DANGER",
    "title": "온도 임계값 초과",
    "description": "표면 온도 60.4°C, dT/dt 급상승이 감지되었습니다. 즉시 확인이 필요합니다.",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "subjectType": "BATTERY",
    "occurredAt": "...",
    "acknowledgedAt": null,
    "channels": ["KAKAO", "INAPP", "SMS"],
    "metricsSummary": "60.4°C · 이상점수 0.82",
    "rawSnapshot": {
      "timestamp": "2026-07-10T14:22:03Z",
      "batteryId": "b_01H...",
      "tempIrSurface": 60.4,
      "dTdt": 2.8,
      "voltageV": 11.62,
      "currentA": 2.9,
      "socPct": 78,
      "anomalyScore": 0.82,
      "relayState": "OPEN"
    }
  }],
  "page": { "number": 1, "size": 20, "total": 5, "totalPages": 1 }
}
```

- `subjectType`: `BATTERY` \| `DEVICE` — v3에 `진단기 C 하트비트 미수신` 알림이 있어 배터리가 아닌 대상이 존재한다 `[v3: thumb:'device']`
- `rawSnapshot` → **Raw 데이터 보기 모달** `[v3: rawModal, T.rawView]`. v3에서 신규 추가된 기능이다. 필드 구성은 알림 종류마다 다르며, 값이 없으면 키를 생략한다.
- **`확인(Ack)`·`Raw 데이터 보기` 버튼은 미확인 알림에만 노출된다** `[v3 실측]`. 즉 `acknowledgedAt !== null`이면 프론트가 두 버튼을 감춘다. 서버는 이미 확인된 알림에 대한 `ack` 재요청을 멱등 처리한다(에러 아님).
- `POST /ack` 응답은 갱신된 알림 객체. `ack-all`은 `{ "acknowledgedCount": 3 }`.

> **Raw 모달은 키를 snake_case 그대로 화면에 찍는다** (`voltage_v`, `soc_pct`, `anomaly_score`, `relay_state`) `[v3 실측]`. 반면 이 계약의 나머지 JSON은 camelCase다. 서버는 camelCase로 통일해 내려주고, Raw 모달의 snake_case 라벨은 **프론트가 표시용으로 매핑**한다 — 이 화면의 목적이 "에지/AI가 발행하는 원본 필드명을 그대로 보여주는 것"이기 때문이다.

### 4.9 공지사항 (F13) — 사용자

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/notices` | `[REQ-WEB-028/059]` |
| `GET` | `/api/notices/{id}` | `[REQ-WEB-060]` |

쿼리: `category`(`IMPORTANT|MAINTENANCE|FEATURE|INFO`, 미지정=전체)

```json
{
  "items": [{
    "id": "n_01H...",
    "category": "IMPORTANT",
    "title": "펌웨어 v5.2 긴급 업데이트 안내",
    "body": "릴레이 인터락 안정성이 개선됩니다. ...",
    "publishedAt": "2026-07-01T00:00:00.000Z"
  }],
  "page": { "number": 1, "size": 20, "total": 4, "totalPages": 1 }
}
```

- 사용자 엔드포인트는 `PUBLISHED`만 반환한다. `DRAFT`/`ARCHIVED`는 관리자 전용.
- `body`는 목록에도 포함한다 — v3는 목록 항목 클릭 시 추가 요청 없이 상세 모달을 연다 `[v3]`. 본문이 길어지면 `GET /{id}`로 분리 `[정의 필요 — Q11]`.

### 4.10 릴레이 제어 (F12)

#### `GET /api/relay` `[REQ-WEB-061]`

```json
{
  "batteryId": "b_01H...",
  "state": "OPEN",
  "changedAt": "...",
  "changedBy": { "type": "SYSTEM", "name": "Fail-Safe" },
  "reason": "온도 임계값 초과",
  "interlock": { "engaged": true, "condition": "TEMP_OVER_CAP", "canRestore": false },
  "autoRecoverEnabled": true
}
```

- `interlock.canRestore: false`면 프론트는 복구 버튼을 비활성화한다. 서버도 `409 INTERLOCK_LOCKED`로 막는다 (§3.3).
- `autoRecoverEnabled` — 자동 복구 조건은 `[정의 필요 — Q12]`.

> **`interlock`·`autoRecoverEnabled`는 v3 화면에 표시되지 않는다** `[v3 실측]`. `T.interlock('인터락 조건')`·`T.autoRecover('자동 복구')` 라벨이 코드에 정의돼 있으나 렌더링되지 않으며, 실제 릴레이 화면은 `현재 상태(차단됨) / 릴레이 복구 버튼 / 실행하기 / 최근 제어 이력` 뿐이다.
> 그래도 **두 필드는 계약에 유지한다** — §3.3의 Fail-Safe 우선 규칙을 서버가 강제하려면 인터락 상태가 필요하고, 프론트는 최소한 복구 버튼 활성/비활성 판단에 `canRestore`를 써야 한다. 표시 여부는 프론트가 정한다.

#### `POST /api/relay/cut` / `POST /api/relay/restore` `[REQ-WEB-062/063]`

```json
{ "reason": "셀 3번 온도 임계값 초과로 긴급 차단", "password": "••••••••" }
```

§3.4 승인 절차 적용. 성공 시 갱신된 릴레이 상태 객체 반환 + WebSocket 브로드캐스트.

> 기존 `backend/src/server.ts:44`의 `POST /api/relay/kill-switch/confirm`이 이 계약의 `POST /api/relay/cut`에 해당한다. **경로 통일 필요** `[정의 필요 — Q13]`.

#### `GET /api/relay/history` `[v3: T.recentCtrl '최근 제어 이력']`

```json
{
  "items": [{
    "id": "rl_01H...",
    "action": "RELAY_AUTO_RESTORE",
    "at": "...",
    "actor": { "type": "SYSTEM", "name": "Fail-Safe" },
    "reason": "온도 정상 복귀, 인터락 해제 조건 충족"
  }]
}
```

### 4.11 설정 (F14)

**v3 설정 탭은 3개다** `[v3 실측]`: `알림 수신` / `계정 정보` / `테마 · 캘리브레이션`.

| 메서드 | 경로 | 탭 | 근거 |
|---|---|---|---|
| `GET`/`PATCH` | `/api/settings/alerts` | 알림 수신 | `[REQ-WEB-065/066]` |
| `PATCH` | `/api/me` | 계정 정보 | `[REQ-WEB-067]` |
| `POST` | `/api/me/password` | 비밀번호 변경 | `[REQ-WEB-068]` |
| `GET`/`PATCH` | `/api/settings/preferences` | 테마 · 캘리브레이션 | `[REQ-WEB-070/015]` |
| `GET` | `/api/calibrations` | 테마 · 캘리브레이션 | `[REQ-WEB-071]` |
| `GET`/`PATCH` | `/api/settings/voice-alert` | **화면 없음** | `[REQ-WEB-072]` `[PLAN]` |

> **임계치 탭은 없다** — 기능 자체가 제거되었다(§4.4 참조).
> **음성 안내 설정은 v3 어느 화면에도 없다.** 그러나 `PLAN.md`에 모델·API가 이미 확정돼 있고 에지 하드웨어 동작과 직결되므로 **계약에 포함한다.** 프론트가 설정 화면에 탭 또는 섹션을 새로 만들어야 한다.

**`/api/settings/alerts`** `[v3: kakaoOn/emailOn/smsOn/pushOn]`

```json
{
  "channels": { "KAKAO": true, "EMAIL": true, "SMS": false, "WEBPUSH": true },
  "policy": {
    "sendOn": ["DANGER", "WARNING"],
    "smsOnlyDanger": true,
    "dedupeWindowMinutes": 5
  }
}
```

- `dedupeWindowMinutes: 5` — *"동일 이벤트는 5분 내 중복 발송을 억제합니다."* `[v3: T.dedupeNote]` `[REQ-WEB-066]`
- v3는 토글을 켤 때 확인 모달을 띄운다 `[v3: toggleConfirm]`. 순수 UI이며 API에 영향 없음.

**`/api/settings/voice-alert`** — 필드는 `PLAN.md`에 이미 확정되어 있다 `[PLAN]`

```json
{
  "enabled": true, "volume": 70,
  "connectionEnabled": true, "anomalyEnabled": true, "failsafeRelayEnabled": true,
  "deviceErrorEnabled": true, "networkEnabled": false,
  "updatedAt": "..."
}
```

**`GET /api/calibrations`** `[v3: T.calibHist]` `[REQ-WEB-071]`

```json
{
  "items": [{
    "sensor": "DS18B20",
    "sensorLabel": "DS18B20 · 접촉 온도",
    "calibratedAt": "2026-06-20",
    "calibratedBy": "김엔지",
    "status": "VALID",
    "expiresAt": "2026-09-20"
  }]
}
```

- `status`: `VALID` \| `EXPIRING` \| `EXPIRED` `[v3: T.calValid/calExpiring]`
- 등록/수정 UI는 v3에 없다. **조회 전용.** 등록 경로는 `[정의 필요 — Q14]`.

> **REQ-WEB-069(프로필 사진 변경)는 범위에서 제외되었다** — `docs/superpowers/specs/2026-07-22-...` 검증 결과 반영. 아바타 업로드 엔드포인트는 만들지 않는다.
> 다만 **`사진 변경` 버튼은 v3 계정 정보 탭에 실제로 렌더링돼 있다** `[v3 실측]`. 프론트가 이 버튼을 제거해야 한다. 남겨두면 백엔드에 없는 기능을 사용자가 누르게 된다.

> **`측정 담당자` 표기는 제거한다.** v3는 사이드바 하단과 계정 탭에 이름 아래 `측정 담당자`(관리자는 `시스템 관리자`)를 표시하지만 `[v3 실측]`, 이 표기를 쓰지 않기로 결정했다. **`user.jobTitle` 같은 직함 필드를 만들지 않는다.** 프론트가 해당 라인을 제거한다(§12-12).

### 4.12 관리자 (F15~F20)

모두 `ADMIN` 권한. 경로 접두어 `/api/admin`.

#### `GET /api/admin/overview` — 통합 관제 (F15) `[REQ-WEB-104~107]`

v3 실측 구성: KPI 카드 4개 → 이벤트 추이 차트 + 배터리 상태 분포 → 최근 위험 배터리 / 공지사항 / 최근 관리자 조작.

```json
{
  "summary": {
    "totalUsers": 342, "newUsers7d": 18,
    "totalBatteries": 1284, "newBatteries7d": 42,
    "activeSessions": 37,
    "riskBatteries": 5, "anomalies24h": 23
  },
  "statusDistribution": { "NORMAL": 1152, "WATCH": 127, "BLOCKED": 5 },
  "modeDistribution": { "1": 612, "2": 448, "3": 224 },
  "eventTrend7d": [
    { "bucket": "2026-07-16", "caution": 8, "warning": 3, "danger": 1 }
  ],
  "recentRiskBatteries": [ /* AdminBatteryRow × 3 */ ],
  "recentAdminActions": [ /* AuditEntry × 3 */ ],
  "recentNotices": [ /* NoticeSummary × 3 */ ]
}
```

- **KPI 카드는 4개다** — `전체 유저 / 전체 배터리 / 활성 세션 / 위험·경고 배터리` `[v3 실측]`. `REQ-WEB-104`가 언급한 **오프라인 디바이스 카드는 화면에 없다.** 디바이스 화면(F5)이 제외된 것과 일관되므로 `offlineDevices`를 뺐다.
- `modeDistribution` — 배터리 상태 분포 카드 하단에 `모드 1 / 2 / 3 → 612 / 448 / 224`로 표시된다 `[v3 실측]`. 내가 처음에 누락했던 항목이다.
- `statusDistribution` 키는 운영 상태(`NORMAL/WATCH/BLOCKED`)이며, 이상 탐지 화면의 `riskDistribution`(이상 등급)과 **다른 축이다.** 혼동 주의.
  - 화면 라벨은 `정상 / 주시 / 제한`이다 `[v3 실측]`. `제한` = `BLOCKED`. 목록 필터 칩은 영문 `NORMAL / WATCH / BLOCKED`를 쓰므로 **같은 값에 두 벌의 한국어 라벨이 존재한다.** 프론트가 하나로 통일해야 한다.

#### `GET /api/admin/event-trend` — 이벤트 추이 (F20) `[REQ-WEB-107/108]`

쿼리: `period=24h|7d|30d`

```json
{
  "period": "7d",
  "buckets": [{ "label": "월", "at": "2026-07-16", "caution": 8, "warning": 3, "danger": 1 }],
  "summary": { "total": 66, "dangerTotal": 12, "peakBucket": "토", "peakTotal": 24 }
}
```

`summary` 3개 지표는 v3 화면에 존재 `[v3: evT.total/peak/danger]`.

#### 유저 계정 관리 (F16)

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/admin/users` | `[REQ-WEB-110~113]` |
| `GET` | `/api/admin/users/{id}` | `[REQ-WEB-114]` |
| `PATCH` | `/api/admin/users/{id}` | `[REQ-WEB-115]` |
| `POST` | `/api/admin/users/{id}/password-reset` | `[REQ-WEB-116]` |
| `POST` | `/api/admin/users/{id}/suspend` | `[REQ-WEB-117]` |
| `POST` | `/api/admin/users/{id}/restore` | `[REQ-WEB-117]` |

**목록** 쿼리: `q`(이름·이메일 `[REQ-WEB-111]`), `status`(`ACTIVE|SUSPENDED` `[REQ-WEB-112]`), `role`(`USER|ADMIN` `[REQ-WEB-113]`)

```json
{
  "items": [{
    "id": "u_01H...", "name": "홍길동", "loginId": "hong",
    "email": "hong@cellguard.io", "phone": "010-1234-5678",
    "role": "USER", "status": "ACTIVE",
    "batteryCount": 5,
    "joinedAt": "2025-03-12T00:00:00.000Z",
    "lastSeenAt": "2026-07-22T14:30:00.000Z"
  }]
}
```

**상세** — 목록 필드 + `batteries[]`(id, label, opsStatus) + `activityLogs[]` `[v3]` `[REQ-WEB-114]`

```json
{
  "batteries": [{ "id": "b_01H...", "label": "PACK-001", "opsStatus": "BLOCKED" }],
  "activityLogs": [{
    "at": "...", "action": "LOGIN",
    "summary": "로그인", "meta": "203.0.113.24 · Chrome"
  }]
}
```

**정지/해제** — `{ "reason": "..." }` 필수 (`422 REASON_REQUIRED`), 감사 기록 `[REQ-WEB-117/118]`

> 정지된 사용자의 **진행 중 세션 처리**는 `[정의 필요 — Q15]`. v3 mock에 `측정 중단 · 소유자 계정 정지`라는 로그가 있어 세션이 강제 종료되는 것으로 보인다 `[v3]`.

#### 배터리 운영 관리 (F17)

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/admin/batteries` | `[REQ-WEB-119~121]` |
| `GET` | `/api/admin/batteries/{id}` | `[REQ-WEB-122]` |
| `PATCH` | `/api/admin/batteries/{id}/ops-status` | `[REQ-WEB-123/125]` |
| `PATCH` | `/api/admin/batteries/{id}/memo` | `[REQ-WEB-124]` |

**목록** 쿼리: `q`(배터리 라벨·소유자명 `[REQ-WEB-120]`), `opsStatus`(`NORMAL|WATCH|BLOCKED` `[REQ-WEB-121]`)

```json
{
  "items": [{
    "id": "b_01H...", "label": "PACK-001",
    "owner": { "id": "u_01H...", "name": "홍길동" },
    "maker": "Samsung SDI", "model": "18650", "chemistry": "LI_ION", "seriesCount": 3,
    "mode": 1,
    "score": 0.82, "grade": "DANGER",
    "opsStatus": "BLOCKED",
    "latest": { "tempC": 61.4, "voltageV": 11.9, "socPct": 74, "measuredAt": "..." }
  }]
}
```

**상세** — 위 + `info[]`(직렬 구성·설치 위치·연결 진단기·관리자 메모) + `opsLogs[]`

```json
{
  "opsLogs": [{
    "at": "...", "severity": "DANGER",
    "summary": "릴레이 자동 차단 (Fail-Safe)", "meta": "온도 61.4°C 임계 초과"
  }]
}
```

> **v3 상세 모달은 조회 전용이다** `[v3 실측]`. 실제로 열어보면 `이상점수 / 온도 / 전압 / SOC` 4칸과 `운영 로그` 목록, 그리고 `닫기` 버튼뿐이다. **운영 상태를 바꾸는 UI도, 관리자 메모를 입력하는 UI도 없다.** 코드에 정의된 `info[]`(직렬 구성·설치 위치·연결 진단기·관리자 메모)조차 렌더링되지 않는다.
> 그럼에도 `REQ-WEB-123/124/125`는 **계약에 포함하기로 결정했다** — 감사 로그에 이미 `배터리 상태 변경 · NORMAL → BLOCKED` 기록이 존재하므로 기획상 있어야 하는 기능이다. **프론트가 상세 모달에 입력 UI를 추가해야 한다.**

**운영 상태 변경** — `{ "opsStatus": "BLOCKED", "reason": "열폭주 징후" }`
`BLOCKED`로 변경 시 `reason` **필수** `[REQ-WEB-125]`, 감사 기록 `[REQ-WEB-126]`.

**관리자 메모** — `{ "memo": "열폭주 징후로 차단 유지" }`, 감사 기록 `[REQ-WEB-124/126]`.

> `BLOCKED`가 릴레이 물리 차단까지 유발하는지는 `[정의 필요 — Q16]`. 운영 라벨일 뿐인지, 실제 제어인지 구분이 필요하다.

#### 공지사항 관리 (F18) `[REQ-WEB-127~132]`

| 메서드 | 경로 |
|---|---|
| `GET` | `/api/admin/notices` (`DRAFT` 포함 전체) |
| `POST` | `/api/admin/notices` |
| `PATCH` | `/api/admin/notices/{id}` |
| `POST` | `/api/admin/notices/{id}/archive` |
| `DELETE` | `/api/admin/notices/{id}` (`DRAFT`만 허용) |

```json
{
  "category": "IMPORTANT",
  "audience": "ALL",
  "title": "펌웨어 v5.2 긴급 업데이트 안내",
  "body": "...",
  "status": "PUBLISHED",
  "notifyChannels": ["WEBPUSH", "KAKAO"]
}
```

- `status: "DRAFT"`로 저장 = 임시 저장 `[REQ-WEB-131]`
- `notifyChannels` — 게시와 동시에 발송할 채널 `[REQ-WEB-130]`. 빈 배열이면 발송 없음.
- `audience` 공개 범위 값 목록 `[정의 필요 — Q17]`. v3에 입력 필드는 있으나 옵션이 확정되지 않았다.
- 관리자 목록에는 `viewCount`가 표시된다 `[v3: views '1,204']` — 조회수 집계 방식 `[정의 필요 — Q18]`.
- **삭제는 `DRAFT`만.** 게시된 공지는 `archive`만 가능 `[v3]`.

#### 감사 로그 (F19) `[REQ-WEB-133/134/136]`

`GET /api/admin/audit-logs` — **조회 전용** (§3.5)

쿼리: `from`, `to`(기본 최근 7일 `[v3: T.aaPeriod7]`), `action`, `targetType`, `actorId`, `page`, `size`

v3 테이블 컬럼: `시간 · 관리자 · 행위 · 대상 · 변경 내용` 5개 `[v3 실측]`

```json
{
  "items": [{
    "id": "au_01H...",
    "at": "2026-06-29T05:32:00.000Z",
    "actor": { "id": "u_01H...", "name": "이연구", "role": "ADMIN" },
    "action": "BATTERY_OPS_STATUS_CHANGE",
    "actionLabel": "배터리 상태 변경",
    "targetType": "BATTERY",
    "targetId": "b_01H...",
    "targetLabel": "PACK-001",
    "changeSummary": "NORMAL → BLOCKED"
  }]
}
```

- **`changeSummary`는 문자열 한 칸이다.** `before`/`after` 객체가 아니다 — v3 `변경 내용` 컬럼에 들어가는 값이 항목 유형마다 성격이 다르기 때문이다 `[v3 실측]`:

| action | changeSummary 실측값 |
|---|---|
| 배터리 상태 변경 | `NORMAL → BLOCKED` |
| 계정 정지 | `ACTIVE → SUSPENDED` |
| 메모 변경 | `주시 사유 기록` |
| 관리자 페이지 접근 실패 | `권한 없음 (RBAC)` |
| 관리자 로그인 | `203.0.113.24` |

- 시스템이 주체인 항목(`ADMIN_ACCESS_DENIED`)은 `actor.name`이 `—`로 비어 있고 `targetLabel`에 시도한 계정 이메일이 들어간다 `[v3 실측]`.
- 프론트는 **수정·삭제 UI를 렌더링하지 않는다.** 서버도 해당 메서드를 노출하지 않는다. 화면 우상단에 `수정·삭제 불가` 칩이 상시 표시된다 `[v3]` `[REQ-WEB-136]`.

> **`REQ-WEB-135`(감사 로그 상세 확인)는 계약에서 제외한다.** v3에서 행을 클릭해도 아무 반응이 없다(상세 모달 미구현) `[v3 실측]`. 나중에 상세를 만들려면 `before`/`after` 구조화가 필요하므로, 그때 `GET /api/admin/audit-logs/{id}`를 신설한다.

---

## 5. WebSocket 계약

### 5.1 연결

| 항목 | 값 |
|---|---|
| 엔드포인트 | `wss://<host>/ws` |
| 인증 | 연결 시 세션 쿠키. 실패 시 `4401` 코드로 close `[제안]` |
| 하위 프로토콜 | 없음 |
| 프레임 | JSON 텍스트 |

### 5.2 메시지 봉투

**모든** 메시지는 아래 형태를 따른다. `[제안]`

```json
{ "type": "metrics.tick", "at": "2026-07-22T14:32:10.000Z", "payload": { } }
```

### 5.3 클라이언트 → 서버

| type | payload | 용도 |
|---|---|---|
| `subscribe` | `{ "topics": ["metrics", "anomaly", "relay", "alerts"] }` | 구독 시작 |
| `unsubscribe` | `{ "topics": [...] }` | 구독 해제 |
| `ping` | `{}` | 하트비트 (30초 주기) |

- 구독 범위는 **서버가 세션에서 결정한다.** 클라이언트가 `batteryId`를 지정해 남의 배터리를 구독할 수 없다.
- 관리자는 `admin.*` 토픽을 추가로 구독할 수 있다 `[정의 필요 — Q19]`.

### 5.4 서버 → 클라이언트

| type | 주기/트리거 | payload |
|---|---|---|
| `metrics.tick` | 1초 `[정의 필요 — Q20]` | §4.4 `metrics`와 **동일 구조** — 각 지표가 `{ value, status }`, 끝에 `measuredAt` |
| `anomaly.score` | 추론 결과 도착 시 | `{ score, grade, aeScore, informerScore, evaluatedAt }` |
| `anomaly.gradeChanged` | 등급 전이 시에만 | `{ from, to, score, batteryId, batteryLabel }` |
| `relay.changed` | 상태 변경 시 | `{ state, reason, changedBy, interlock, changedAt }` |
| `relay.autoCut` | Fail-Safe 발동 시 | `{ batteryId, batteryLabel, tempC, trigger, cutAt }` |
| `alert.created` | 새 알림 | `Alert` 객체 (§4.8) |
| `event.created` | 새 이벤트 | `Event` 객체 (§4.6) |
| `session.ended` | 세션 강제 종료 | `{ sessionId, reason }` |
| `device.status` | 진단기 상태 변경 | `{ deviceId, status, lastSeenAt }` |
| `pong` | `ping` 응답 | `{}` |

**중요한 설계 지점**

- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 에지는 100ms 주기로 발행하지만 `[PLAN]`, 브라우저가 초당 10프레임 상태 갱신을 감당하지 못한다. 서버가 **1초 단위로 다운샘플링**해 푸시한다.
  - **v3가 이를 뒷받침한다** — 랜딩 히어로와 로그인 모달이 각각 *"전압·전류·온도·SOC를 **1초 단위**로 수집하고"*, *"**1초 단위** 실시간 모니터링"* 이라고 사용자에게 약속한다 `[v3 실측]`. 제품 카피가 이미 1초다.
  - 다만 `CLAUDE.md`·`PLAN.md`의 수집 주기는 100ms다. **둘 다 맞다** — 에지→Kafka→DB 적재는 100ms, 브라우저 푸시는 1초로 보면 모순이 없다. 문서에 그렇게 명시할 것 `[정의 필요 — Q20]`.
- **`relay.autoCut`은 별도 타입으로 분리한다.** 프론트가 이 메시지 하나로 자동 차단 모달을 띄운다 `[REQ-WEB-064]`. `relay.changed`에 섞으면 "사용자가 직접 차단한 경우"와 구분이 안 된다.
- **`anomaly.gradeChanged`도 별도다.** 매 tick마다 등급을 비교하는 대신 서버가 전이만 알려주면, 프론트는 토스트·알림음·모달 트리거를 안전하게 걸 수 있다.

### 5.5 재연결 규약 `[제안]`

- 클라이언트는 지수 백오프로 재연결한다 (1s → 2s → 4s → … 최대 30s).
- **재연결 직후 프론트는 `GET /api/dashboard`를 다시 호출해 스냅샷을 맞춘다.** WebSocket은 누락된 메시지를 재전송하지 않는다.
- 서버는 순단 중 발생한 이벤트를 큐에 쌓아두지 않아도 된다. 상태 동기화는 스냅샷 재조회로 해결한다.

> v3 공지 본문에 *"WebSocket 순단이 발생할 수 있으나 자동 재연결되며, 측정 데이터는 버퍼링 후 복원됩니다"* 라는 문장이 있다 `[v3]`. **데이터 버퍼링은 에지→Kafka 구간의 이야기이며, WebSocket 재전송 보장을 뜻하지 않는다.** 혼동 주의.

---

## 6. 화면 ↔ 엔드포인트 매핑

| # | 영역 | 라우트 | 필요한 엔드포인트 |
|---|---|---|---|
| F1 | 랜딩 | `landing` | 없음 (정적) |
| F2 | 회원가입 | `signup` | `/api/auth/*` |
| F3 | 계정 찾기 | `find` | `/api/auth/*` |
| F4 | 실시간 관제 | `dashboard` | `GET /api/dashboard`, WS `metrics.tick`·`anomaly.score`·`relay.*` |
| F6 | 배터리 자산관리 | `battery` | `GET/POST/PATCH /api/batteries`, `POST /api/sessions` |
| F7 | 배터리 상세·이력 | `batteryDetail` | `GET /api/batteries/{id}`, `/sessions`, `GET /api/trends?batteryIds={id}` |
| F8 | 이상 탐지 | `anomaly` | `GET /api/anomaly/summary`(위험도 분포 포함), `/evidence`, `/events` |
| F9 | 추세 | `trend` | `GET /api/trends`, `/trends/export` |
| F10 | 이벤트 이력 | `events` | `GET /api/events` |
| F11 | 알림 센터 | `alertHistory` | `GET /api/alerts`, `/alerts/summary`, `POST /ack`, `/ack-all` |
| F12 | 릴레이 제어 | `relay` | `GET /api/relay`, `/history`, `POST /cut`, `/restore` |
| F13 | 공지사항 | `notices` | `GET /api/notices` |
| F14 | 설정 | `settings` | `/api/settings/alerts`, `/preferences`, `/voice-alert`, `PATCH /api/me`, `POST /api/me/password`, `GET /api/calibrations` |
| F15 | 관리자 통합 관제 | `admin` | `GET /api/admin/overview` |
| F16 | 유저 계정 관리 | `adminUsers` | `/api/admin/users/*` |
| F17 | 배터리 운영 관리 | `adminBattery` | `/api/admin/batteries/*` |
| F18 | 공지사항 관리 | `adminNotice` | `/api/admin/notices/*` |
| F19 | 감사 로그 | `adminAudit` | `GET /api/admin/audit-logs` |
| F20 | 이벤트 추이 | `adminEventTrend` | `GET /api/admin/event-trend` |

> **F5 `devices`(디바이스 상태)는 제외되었다.** v3에 섹션과 데이터가 존재하지만 해당 라우트로 전환하는 코드가 0건인 고아 라우트다(browser 검증 완료, `docs/superpowers/specs/2026-07-22-...`). `REQ-WEB-030/031`은 현재 도달 불가 기능이므로 **백엔드 구현 대상에서 뺀다.** 되살릴 경우 `GET /api/devices`가 추가로 필요하다.

---

## 7. 구현 우선순위 제안

프론트가 화면을 붙이는 순서 기준. `[제안]`

| 순위 | 범위 | 이유 |
|---|---|---|
| 1 | `GET /api/me`, `/api/batteries`, `POST /api/sessions` | **§3.1 게이트 때문에 세션이 없으면 다른 화면을 아예 못 연다.** 여기가 막히면 나머지 전부 대기 |
| 2 | `GET /api/dashboard` + WS `metrics.tick`·`anomaly.score` | 핵심 화면. 목 데이터로 붙이다가 실 데이터로 교체 |
| 3 | `GET /api/events`, `/api/alerts` | 목록 공통 규약(§1.5) 검증. 여기서 페이지네이션 형태를 확정하면 나머지가 복제 |
| 4 | `/api/relay/*` | 안전 기능. 승인 절차(§3.4) 구현 비용이 있음 |
| 5 | `/api/settings/*`, `/api/notices`, `/api/trends` | |
| 6 | `/api/admin/*` | 관리자 화면 6종 |

---

## 8. 목(mock) 서버 요청

프론트가 백엔드 완성 전에 개발하려면 아래 중 하나가 필요하다. `[정의 필요 — Q21]`

1. **백엔드가 스텁 응답을 먼저 배포** — 실제 경로에 고정 JSON 반환. 가장 좋음(경로·필드명 오타가 조기에 잡힌다)
2. 이 문서를 기준으로 프론트가 MSW 목을 자체 작성 — 계약 드리프트 위험
3. OpenAPI 스펙을 백엔드가 제공하고 프론트가 자동 생성

---

## 9. 미결정 항목 — **백엔드 개발자와 먼저 합의할 것**

| # | 항목 | 선택지 / 메모 |
|---|---|---|
| Q1 | CSRF 토큰 방식 | Better Auth 기본 제공 여부 확인 후 결정. 쿠키+헤더(double submit)가 무난 |
| Q2 | 다국어 | v3에 한/영 토글이 실재한다 `[REQ-WEB-015]`. 서버가 한국어 문장을 주면 영어 전환이 깨진다. **서버는 코드만, 문구는 프론트** 를 제안하나 에러 메시지·XAI 라벨·이벤트 `cause`/`action`은 결정 필요 |
| ~~Q3~~ | ~~`scoreDisplay` 서버 제공 여부~~ | **해결** — `score`(0.0–1.0)만 내려준다. 0–100 변환은 프론트 |
| Q4 | `label` 유일성 범위 | 사용자 내 유일? 전역 유일? 중복 허용? |
| Q5 | 감사 로그 보존 기간 | 법적 요구 여부 확인 필요 |
| Q6 | SOH/RUL/사이클/내부저항 산출 주체 | AI 파이프라인 vs 백엔드 집계. 갱신 주기도 함께 |
| Q7 | `deviceId` 지정 방식 | v3에 진단기 선택 UI가 **없음을 실측 확인**. 연결 모달은 배터리만 묻는다. 사용자당 1대 가정 가능한가? |
| ~~Q8~~ | ~~`tempCapC`와 Fail-Safe 관계~~ | **해결** — 임계치 설정 기능이 제거되어 사용자 입력 자체가 없다. 온도 상한은 서버/에지 고정값 |
| Q9 | CSV/PDF 내보내기 | 동기 다운로드 vs 비동기 작업+알림. 최대 건수 상한. **대상은 추세 데이터**(§4.7) |
| Q10 | 추세 다운샘플링·집계 | 버킷 크기, avg/max 선택 (§4.7 제안 참조) |
| Q11 | 공지 `body` 목록 포함 여부 | 본문 길이 상한과 함께 결정 |
| Q12 | 릴레이 자동 복구 조건 | 어떤 조건에서 자동 복구되는가. 사용자 토글 가능한가 |
| Q13 | 기존 `POST /api/relay/kill-switch/confirm` | 이 계약의 `/api/relay/cut`으로 통일할지 |
| Q14 | 캘리브레이션 등록 경로 | 웹 UI 없음 — 내부 도구/스크립트인가 |
| Q15 | 계정 정지 시 진행 중 세션 | 강제 종료? 릴레이 차단까지? |
| Q16 | `BLOCKED` 운영 상태의 물리적 효과 | 라벨인가 실제 차단인가 |
| Q17 | 공지 `audience` 값 목록 | 전체/특정 역할/특정 사용자? |
| Q18 | 공지 조회수 집계 | 중복 카운트 방지 기준 |
| Q19 | 관리자 WebSocket 토픽 | 전체 배터리 실시간 구독이 필요한가 (F15 통합 관제) |
| Q20 | 수집 100ms vs 푸시 1초 | v3 제품 카피는 "1초 단위 수집", CLAUDE.md는 100ms. **적재 100ms / 푸시 1초**로 정리하면 되는지 확인만 하면 됨 |
| Q21 | 목 서버 제공 방식 | §8 참조 |
| ~~Q22~~ | ~~`cellIndex` 특정 방법~~ | **해결** — 셀 단위 측정 안 함. `cellIndex` 제거, 이벤트명에서 `· 셀 N` 삭제 |
| ~~Q23~~ | ~~`maker`/`model` 처리~~ | **해결** — 계약 유지. 프론트가 등록·수정 폼에 입력 2개 추가 |
| ~~Q24~~ | ~~지표별 상태 배지 기준~~ | **해결** — 지표별 고정 임계값으로 **서버 판정**, `metrics.*.status` 동봉 |
| ~~Q25~~ | ~~XAI 기여도 범위·부호~~ | **해결** — 0 이상 실수, 합 제약 없음, 내림차순 |
| ~~Q26~~ | ~~`측정 담당자` 표기~~ | **해결** — 표기 제거. `jobTitle` 필드 없음 |
| **Q27** | **지표별 상태 임계값 수치** | Q24의 후속. `OK`/`WARN`/`CRIT` 경계를 지표마다 확정해야 한다. v3 근거는 온도 `≥55°C → 경고` 하나뿐이고, 전압은 `chemistry`·`seriesCount`로 셀당 환산이 필요하다 |

### 브라우저 실측으로 해결된 항목

| 항목 | 결론 |
|---|---|
| 이상점수 스케일 | `score` 0.0–1.0 단일. Raw 모달도 `0.82`로 고친다 |
| 임계치 설정 | **기능 제거됨.** `/api/settings/thresholds` 없음. 0.3/0.6/0.8 고정 |
| 위험도 분포 범위 | **소유 배터리 기준.** v3의 128건은 더미 |
| 셀 단위 데이터 전반 | **범위 제외.** 히트맵·`cellIndex`·이벤트명의 `· 셀 N` 모두 삭제 |
| 지표별 상태 배지 | **서버 판정.** `metrics.*.status` = `OK`/`WARN`/`CRIT`, 고정 임계값 |
| `측정 담당자` 표기 | **제거.** 직함 필드 없음 |
| 감사 로그 상세(135) | **제외.** v3 미구현, `changeSummary` 문자열로 충분 |
| 관리자 운영상태·메모(123/124/125) | **포함.** v3 미구현이나 프론트가 입력 UI를 추가 |
| 음성 안내 설정(072) | **포함.** v3 화면 없으나 에지 하드웨어와 직결 |

---

## 10. 부록 — 백엔드가 참고할 기존 문서

| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | 아키텍처, Kafka 토픽 규약, 센서 JSON 스키마, AI 모델 파라미터, 측정 모드 |
| `PLAN.md` §2 | 기술 스택, Kafka 토픽 설계, 배터리 자산 데이터 모델 |
| `PLAN.md` §5 | 스펙 33개 (S-xxx ID) |
| `docs/feature_definition.md` | 일반 사용자 요구사항 72개 |
| `docs/admin_feature_definition.md` | 관리자 요구사항 36개 |
| `docs/userflow.md`, `docs/admin_userflow.md` | 화면 전환 흐름 |
| `설계 산출물/셀가드 프로토타입_v3.html` | **동작하는 프로토타입. 애매하면 이걸 기준으로.** |

---

## 11. 기능정의서와 v3의 불일치 — 실측 기록

`docs/feature_definition.md`·`docs/admin_feature_definition.md`는 v1(2026-07-10) 기준이다. v3를 브라우저로 띄워 확인한 차이는 아래와 같으며, **이 계약서는 전부 v3를 따랐다.**

### 위치가 다른 것

| 요구사항 | 문서가 말하는 위치 | 실제 v3 위치 |
|---|---|---|
| REQ-WEB-025 위험도 분포 | 대시보드 | **이상 탐지 화면** |
| REQ-WEB-026 최근 이벤트 | 대시보드 | **이상 탐지 화면** (`활성 이상 이벤트`) |
| REQ-WEB-051 정렬 | 이벤트 이력 | **배터리 관리 화면** (최근 측정순·이상점수순·SOC순) |
| REQ-WEB-054/055 CSV·PDF | 이벤트 이력 | **추세 차트 화면** |
| REQ-WEB-047 지표 선택 | 추세 차트 | **대시보드** (추세 화면은 4차트 동시 표시) |

### 화면에 없는 것

| 요구사항 | 상태 | 계약 처리 |
|---|---|---|
| REQ-WEB-030/031 디바이스 상태 | 라우트 도달 불가 (고아) | **제외** |
| REQ-WEB-123/124/125 운영상태·메모 | 상세 모달이 조회 전용 | **포함** — 프론트가 입력 UI 추가 |
| REQ-WEB-135 감사 로그 상세 | 행 클릭 무반응 | **제외** |
| REQ-WEB-072 음성 안내 설정 | 어느 화면에도 없음 | **포함** — 프론트가 설정에 섹션 추가 |
| 임계치 설정 | 라벨만 있고 미렌더링 | **제외** (기능 자체가 제거됨) |
| 셀 온도 히트맵 | 렌더링됨 | **제외** (쓰지 않기로 결정) |

### 입력 항목이 다른 것

| 요구사항 | 문서 | 실제 v3 폼 |
|---|---|---|
| REQ-WEB-037 배터리 등록 | 이름·종류·모드·직렬 셀 수·**제조사/모델** | 이름·종류·모드·직렬 셀 수 **4개뿐** |

### 문서에 없는데 v3에 있는 것

- **배터리 미연결 시 8메뉴 전면 잠금** (§3.1) — 문서 4종에 0건
- **알림 센터 "오늘의 알림 요약"** 카드 (위험/경고/정상·점검 3칸)
- **관리자 대시보드 모드별 배터리 분포** (모드 1/2/3)
- **대시보드 지표별 상태 배지** (전압·전류·온도·SOC 각각 정상/경고)
- **Raw 데이터 보기 모달** (v3 신규, `rawModal`)

---

## 12. 프론트엔드 작업 목록 — 계약과 v3를 맞추려면

백엔드와 무관하게 **프론트가 고쳐야 하는 것들**이다. 실측 중 발견했다.

| # | 항목 | 이유 |
|---|---|---|
| 1 | 등급 판정 로직 3곳을 4등급으로 통일 | 대시보드 `dScoreLabel`, 게이지 범례, 관리자 목록 `scCol`이 전부 3등급(70/40). PACK-003이 33점인데 `정상`으로 표시되는 버그 |
| 2 | 게이지 범례 문구 교체 | `정상 0–39 / 주의 40–69 / 위험 70+` → `정상 0–29 / 주의 30–59 / 경고 60–79 / 위험 80+` (4칸) |
| 3 | Raw 모달 `anomaly_score`를 `0.82`로 | "원본 데이터" 화면이 가공값(82)을 보여주고 있음 |
| 4 | `사진 변경` 버튼 제거 | REQ-WEB-069 범위 제외인데 버튼이 남아 있음 |
| 5 | 셀 온도 히트맵 섹션 제거 | 범위 제외 결정 |
| 6 | 관리자 배터리 상세에 운영상태·메모 입력 UI 추가 | 계약에 포함했으나 v3는 조회 전용 |
| 7 | 설정에 음성 안내 섹션 추가 | 계약에 포함했으나 v3에 없음 |
| 8 | 운영 상태 한국어 라벨 통일 | 관리자 대시보드는 `정상/주시/제한`, 목록 필터는 `NORMAL/WATCH/BLOCKED` — 두 벌 공존 |
| 9 | 상대시간 표시를 클라이언트 계산으로 | 서버는 절대 시각만 준다(§1.1). v3는 `"3시간 전"`이 하드코딩 |
| 10 | 이벤트 목록 페이지네이션 정합 | `전체 116건 중 1–5`인데 행이 6개 렌더링됨 |
| 11 | 배터리 등록·수정 모달에 `제조사`·`모델` 입력 추가 | Q23 결정. 둘 다 선택 입력 |
| 12 | 이름 아래 `측정 담당자` / `시스템 관리자` 라인 제거 | Q26 결정. 사이드바 하단 + 계정 정보 탭 2곳 |
| 13 | 이벤트·알림 문구에서 `· 셀 3` 제거 | Q22 결정. 셀 단위 측정 안 함 |
| 14 | 지표 카드 배지를 서버 `status`로 교체 | Q24 결정. `dTempWarn = temp >= 55` 같은 클라이언트 판정 제거 |
