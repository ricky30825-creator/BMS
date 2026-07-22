# 셀가드 백엔드 API 계약서 (REST + WebSocket)

> **이 문서는 프론트엔드가 백엔드에 요구하는 인터페이스 계약이다.**
> 백엔드 내부 구현(DB 스키마, Kafka 컨슈머 설계, 인덱스 전략)은 이 문서의 범위가 아니다.
> 다만 **§3 도메인 불변식**은 구현 방식과 무관하게 반드시 지켜져야 한다.

| 항목 | 값 |
|---|---|
| 작성일 | 2026-07-22 |
| 근거 기준 | `설계 산출물/셀가드 프로토타입_v3.html` (실측), `docs/feature_definition.md`(REQ-WEB-001~072), `docs/admin_feature_definition.md`(REQ-WEB-101~136), `PLAN.md` |
| 대상 화면 | 19개 영역 (공개 3 · 일반 사용자 10 · 관리자 6) |

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
{ "score": 0.8213, "grade": "DANGER", "scoreDisplay": 82 }
```

> `scoreDisplay`를 서버가 함께 내려줄지는 `[정의 필요 — Q3]`. 반올림 규칙을 한 곳에 고정하려면 서버가 주는 편이 안전하다.

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

- `health` 4개 필드는 v3 화면에 존재한다 `[v3: T.sohLabel/rulLabel/cumCycle/intRes]` `[REQ-WEB-044]`.
  **이 값들을 누가 계산하는지는 `[정의 필요 — Q6]`.** AI 파이프라인 산출물인지 백엔드 집계인지 미정.
- `scoreTrend30d`는 일 단위 집계 30건 `[v3: T.scoreTrend30]`.

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

#### `GET /api/dashboard` — 초기 스냅샷 `[REQ-WEB-019/021/024/025/026]`

WebSocket 연결 **전에** 화면을 채우기 위한 1회 조회. 이후 갱신은 §5 WebSocket이 담당한다. `[제안]`

```json
{
  "session": { "id": "s_01H...", "batteryId": "b_01H...", "batteryLabel": "PACK-001", "mode": 1, "startedAt": "..." },
  "metrics": {
    "voltageV": 11.9, "currentA": 2.4, "powerW": 28.5,
    "tempContact": 58.0, "tempIrSurface": 59.2, "socPct": 78,
    "measuredAt": "2026-07-22T14:32:10.000Z"
  },
  "anomaly": {
    "score": 0.82, "grade": "DANGER",
    "aeScore": 0.79, "informerScore": 0.86,
    "evaluatedAt": "..."
  },
  "relay": { "state": "OPEN", "reason": "FAILSAFE_TEMP", "changedAt": "..." },
  "riskDistribution": { "NORMAL": 3, "CAUTION": 1, "WARNING": 0, "DANGER": 1 },
  "recentEvents": [ /* EventSummary × 5 */ ],
  "quickTrend": {
    "metric": "temp",
    "points": [{ "at": "...", "value": 57.2 }]
  }
}
```

- `aeScore`/`informerScore`는 이중 모델 개별 점수 `[PLAN: S-FGKMXE]`. v3 화면에는 없지만 이상 탐지 화면 XAI 확장에 쓰인다. 없으면 `null`.
- `riskDistribution`은 **사용자의 전체 배터리** 기준 `[REQ-WEB-025]`.
- `quickTrend.metric`은 `volt|curr|temp|soc` 중 프론트가 선택 `[v3: dMetric]` `[REQ-WEB-024]`. 쿼리 `?metric=temp`로 지정.

#### 임계치 설정 `[v3: T.thTitle/thWatch/thWarn/thDanger/tempCap]`

v3 설정 화면에 **임계치 탭**이 존재한다. `주의 진입 / 경고 진입 / 위험 진입 / 온도 상한(°C)`.

| 메서드 | 경로 |
|---|---|
| `GET` | `/api/settings/thresholds` |
| `PATCH` | `/api/settings/thresholds` |

```json
{
  "caution": 0.3, "warning": 0.6, "danger": 0.8,
  "tempCapC": 60,
  "updatedAt": "..."
}
```

- 서버는 `caution < warning < danger` 를 강제한다. 위반 시 `400 VALIDATION_FAILED`.
- **이 값이 §1.6 `grade` 계산의 입력이다.** 사용자가 바꾸면 이후 모든 응답의 `grade`가 달라진다.
- `tempCapC` 초과 시 즉시 경고 `[v3: T.tempCapNote]` — Fail-Safe 트리거와 연동 `[정의 필요 — Q8]`.

### 4.5 이상 탐지 (F8)

#### `GET /api/anomaly/summary` `[REQ-WEB-042]`

```json
{
  "activeCount": 9,
  "todayCount": 23,
  "peakScore": 0.82,
  "peakAt": "2026-06-29T05:24:00.000Z",
  "model": { "status": "RUNNING", "lastInferenceAt": "...", "version": "ae-1.3+informer-0.9" }
}
```

- `model.status`: `RUNNING` \| `DEGRADED` \| `STOPPED` `[v3: T.modelStatus/running]`

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

- `contribution`은 0–1, **합이 1이 되도록 정규화해서 내려준다.** v3는 막대 길이로 그린다.
- 내림차순 정렬 보장.
- `label`을 서버가 줄지 프론트가 매핑할지는 `[정의 필요 — Q2]`(다국어와 연동).

#### `GET /api/anomaly/events` — 활성 이상 이벤트 `[REQ-WEB-045]`

`/api/events`의 `?status=active` 뷰. §4.6과 동일 스키마.

### 4.6 이벤트 이력 (F10)

#### `GET /api/events` `[REQ-WEB-049~053]`

쿼리: `q`(이벤트명·배터리 라벨 검색), `severity`(`DANGER|WARNING|CAUTION|CUT|NORMAL`, 복수 가능), `batteryId`, `from`, `to`, `sort`(기본 `occurredAt,desc`), `page`, `size`

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
- 상세 모달은 목록 항목만으로 렌더링 가능하다 — v3 상세는 `배터리/이상점수/발생 시각/탐지 주체/원인/조치` 6행이며 전부 위 필드에 포함된다 `[v3]`. **별도 상세 엔드포인트 불필요.**

#### `GET /api/events/export` `[REQ-WEB-054/055]`

쿼리: 위 필터 전부 + `format=csv|pdf`

- 응답: `200` + `Content-Disposition: attachment`
- 대용량 대비 비동기 처리 필요 여부 `[정의 필요 — Q9]`

### 4.7 추세 차트 (F9)

#### `GET /api/trends` `[REQ-WEB-046/047/048]`

쿼리:

| 이름 | 값 | 근거 |
|---|---|---|
| `period` | `24h` \| `7d` \| `30d` | `[v3: periodCfg]` `[REQ-WEB-046]` |
| `metrics` | `volt,curr,temp,soc` 콤마 구분 | `[v3: TM]` `[REQ-WEB-047]` |
| `batteryIds` | 콤마 구분, 최대 N개 | `[v3: comparePacks]` `[REQ-WEB-048]` |
| `sessionIds` | 콤마 구분 (배터리 대신 세션 비교) | `[v3: cmpTitle '다중 배터리 / 세션 비교']` |

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

### 4.8 알림 센터 (F11)

| 메서드 | 경로 | 근거 |
|---|---|---|
| `GET` | `/api/alerts` | `[REQ-WEB-056]` |
| `POST` | `/api/alerts/{id}/ack` | `[REQ-WEB-057]` |
| `POST` | `/api/alerts/ack-all` | `[REQ-WEB-058]` |

```json
{
  "items": [{
    "id": "al_01H...",
    "severity": "DANGER",
    "title": "온도 임계값 초과 · 셀 3",
    "description": "셀 3 표면 온도 60.4°C, dT/dt 급상승이 감지되었습니다. 즉시 확인이 필요합니다.",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "subjectType": "BATTERY",
    "occurredAt": "...",
    "acknowledgedAt": null,
    "channels": ["KAKAO", "INAPP", "SMS"],
    "metricsSummary": "60.4°C · 이상점수 82",
    "rawSnapshot": {
      "timestamp": "2026-07-10T14:22:03Z",
      "batteryId": "b_01H...",
      "cellIndex": 3,
      "tempC": 60.4,
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
- `rawSnapshot` → **Raw 데이터 보기 모달** `[v3: rawModal, T.rawView]`. v3 v3에서 신규 추가된 기능이다. 필드 구성은 알림 종류마다 다르며, 값이 없으면 키를 생략한다.
- `POST /ack` 응답은 갱신된 알림 객체. `ack-all`은 `{ "acknowledgedCount": 3 }`.

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
- `autoRecover` — v3 릴레이 화면에 항목 존재 `[v3: T.autoRecover]`. 자동 복구 조건은 `[정의 필요 — Q12]`.

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

| 메서드 | 경로 | 탭 | 근거 |
|---|---|---|---|
| `GET`/`PATCH` | `/api/settings/thresholds` | 임계치 | §4.4 |
| `GET`/`PATCH` | `/api/settings/alerts` | 알림 수신 | `[REQ-WEB-065/066]` |
| `GET`/`PATCH` | `/api/settings/voice-alert` | 음성 안내 | `[REQ-WEB-072]` `[PLAN]` |
| `GET`/`PATCH` | `/api/settings/preferences` | 테마·언어 | `[REQ-WEB-070/015]` |
| `PATCH` | `/api/me` | 계정 정보 | `[REQ-WEB-067]` |
| `POST` | `/api/me/password` | 비밀번호 변경 | `[REQ-WEB-068]` |
| `GET` | `/api/calibrations` | 캘리브레이션 이력 | `[REQ-WEB-071]` |

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

### 4.12 관리자 (F15~F20)

모두 `ADMIN` 권한. 경로 접두어 `/api/admin`.

#### `GET /api/admin/overview` — 통합 관제 (F15) `[REQ-WEB-104~107]`

```json
{
  "summary": {
    "totalUsers": 128, "newUsers7d": 18,
    "totalBatteries": 342, "newBatteries7d": 42,
    "activeSessions": 6,
    "riskBatteries": 4, "anomalies24h": 23,
    "offlineDevices": 1
  },
  "statusDistribution": { "NORMAL": 310, "WATCH": 28, "BLOCKED": 4 },
  "eventTrend7d": [
    { "bucket": "2026-07-16", "caution": 8, "warning": 3, "danger": 1 }
  ],
  "recentRiskBatteries": [ /* AdminBatteryRow × 5 */ ],
  "recentAdminActions": [ /* AuditEntry × 5 */ ],
  "recentNotices": [ /* NoticeSummary × 3 */ ]
}
```

- `statusDistribution` 키는 운영 상태(`NORMAL/WATCH/BLOCKED`)이며, 사용자 대시보드의 `riskDistribution`(이상 등급)과 **다른 축이다.** 혼동 주의 `[v3: ad.stNormal/stWatch/stLimit]`.

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

**상세** — 위 + `info[]`(직렬 구성·설치 위치·연결 진단기·관리자 메모) + `opsLogs[]` `[v3]`

**운영 상태 변경** — `{ "opsStatus": "BLOCKED", "reason": "열폭주 징후" }`
`BLOCKED`로 변경 시 `reason` **필수** `[REQ-WEB-125]`, 감사 기록 `[REQ-WEB-126]`.

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

#### 감사 로그 (F19) `[REQ-WEB-133~136]`

`GET /api/admin/audit-logs` — **조회 전용** (§3.5)

쿼리: `from`, `to`(기본 최근 7일 `[v3: T.aaPeriod7]`), `action`, `targetType`, `actorId`, `page`, `size`

```json
{
  "items": [{
    "id": "au_01H...",
    "at": "2026-06-29T05:32:00.000Z",
    "actor": { "id": "u_01H...", "name": "이연구", "role": "ADMIN" },
    "action": "BATTERY_OPS_STATUS_CHANGE",
    "targetType": "BATTERY",
    "targetId": "b_01H...",
    "targetLabel": "PACK-001",
    "before": { "opsStatus": "WATCH" },
    "after": { "opsStatus": "BLOCKED" },
    "reason": "열폭주 징후",
    "ip": "203.0.113.24",
    "userAgent": "Mozilla/5.0 ..."
  }]
}
```

- `before`/`after`는 자유 형태 객체 — v3 상세 모달이 변경 전후 값을 표시한다 `[REQ-WEB-135]`.
- 로그인·접근 거부처럼 변경이 없는 항목은 둘 다 `null`.
- 프론트는 **수정·삭제 UI를 렌더링하지 않는다.** 서버도 해당 메서드를 노출하지 않는다.

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
| `metrics.tick` | 1초 `[정의 필요 — Q20]` | `{ voltageV, currentA, powerW, tempContact, tempIrSurface, socPct, measuredAt }` |
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

- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 에지는 100ms 주기로 발행하지만 `[PLAN]`, 브라우저가 초당 10프레임 상태 갱신을 감당하지 못한다. 서버가 **1초 단위로 다운샘플링**해 푸시할 것을 제안한다. 실제 주기는 Q20.
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
| F6 | 배터리 자산관리 | `battery` | `GET/POST /api/batteries`, `POST /api/sessions` |
| F7 | 배터리 상세·이력 | `batteryDetail` | `GET /api/batteries/{id}`, `GET /api/batteries/{id}/sessions` |
| F8 | 이상 탐지 | `anomaly` | `GET /api/anomaly/summary`, `/evidence`, `/events` |
| F9 | 추세 | `trend` | `GET /api/trends` |
| F10 | 이벤트 이력 | `events` | `GET /api/events`, `/events/export` |
| F11 | 알림 센터 | `alertHistory` | `GET /api/alerts`, `POST /ack`, `/ack-all` |
| F12 | 릴레이 제어 | `relay` | `GET /api/relay`, `/history`, `POST /cut`, `/restore` |
| F13 | 공지사항 | `notices` | `GET /api/notices` |
| F14 | 설정 | `settings` | `/api/settings/*`, `PATCH /api/me`, `GET /api/calibrations` |
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
| Q3 | `scoreDisplay` 서버 제공 여부 | 반올림 규칙 단일화 vs 페이로드 절약 |
| Q4 | `label` 유일성 범위 | 사용자 내 유일? 전역 유일? 중복 허용? |
| Q5 | 감사 로그 보존 기간 | 법적 요구 여부 확인 필요 |
| Q6 | SOH/RUL/사이클/내부저항 산출 주체 | AI 파이프라인 vs 백엔드 집계. 갱신 주기도 함께 |
| Q7 | `deviceId` 지정 방식 | 사용자당 진단기 1대 가정 가능한가? (F5 제외로 선택 UI 없음) |
| Q8 | `tempCapC`와 Fail-Safe 관계 | 사용자 설정값이 물리 차단 임계에 직접 반영되는가? 안전상 서버 하한선이 필요할 수 있음 |
| Q9 | CSV/PDF 내보내기 | 동기 다운로드 vs 비동기 작업+알림. 최대 건수 상한 |
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
| Q20 | `metrics.tick` 푸시 주기 | 1초 제안. 100ms 원본 그대로는 브라우저가 못 버팀 |
| Q21 | 목 서버 제공 방식 | §8 참조 |

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
