# 셀가드 백엔드 API 계약서 (REST + WebSocket)

> **이 문서는 프론트엔드가 백엔드에 요구하는 인터페이스 계약이다.**
> 백엔드 내부 구현(DB 스키마, Kafka 컨슈머 설계, 인덱스 전략)은 이 문서의 범위가 아니다.
> 다만 **§3 도메인 불변식**은 구현 방식과 무관하게 반드시 지켜져야 한다.

| 항목 | 값 |
|---|---|
| 작성일 | 2026-07-22 |
| 근거 기준 | `설계 산출물/셀가드 프로토타입_v3.html`, `docs/feature_definition.md`(REQ-WEB-001~073, 069 결번), `docs/admin_feature_definition.md`(REQ-WEB-101~136), `PLAN.md` |
| 검증 방법 | v3 번들에서 앱 소스 복원(코드 실측) + **로컬 HTTP로 띄워 전 화면 육안 확인**(2026-07-22, 사용자 10화면 + 관리자 6화면) |
| 대상 화면 | 19개 영역 (공개 3 · 일반 사용자 10 · 관리자 6) |

> **관련 문서**: `docs/product_contract.md`(디자인 무관 제품 계약서)가 같은 v3를 근거로 **과업 플로우 T0~T15**를 기술한다. 이 문서는 그 플로우를 지탱하는 **API 인터페이스**를 정의한다. 둘이 충돌하면 화면·플로우는 `product_contract.md`, 요청/응답 스키마는 이 문서가 우선한다.

> **기능정의서와의 관계**: `docs/feature_definition.md`는 2026-07-22 커밋 `9bb6d8e`로 v3 기준에 맞춰졌고, 이상점수 0.0–1.0 스케일·4등급 임계·게이지 범례 버그를 이미 명시하고 있다. 이 문서의 §1.6은 그 문서와 **일치**한다.
> 다만 기능 항목의 **화면 위치** 일부는 아직 v3와 어긋난다(§11). 충돌 시 v3 화면이 우선한다.

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
- **별도 CSRF 토큰은 쓰지 않는다** `[확정]`. Better Auth 1.6.23이 `trustedOrigins`로 Origin 헤더를 검증하고(`backend/src/auth.ts:19`), CORS는 `credentials: true`로 허용 오리진을 제한한다(`server.ts:11`). 커스텀 라우트도 **동일한 Origin 검증 미들웨어를 태운다.**

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
    "code": "INTERLOCK_LOCKED",
    "message": "Interlock engaged; restore rejected.",
    "details": { "condition": "TEMP_OVER_CAP", "batteryId": "b1f2...", "since": "2026-07-22T14:32:10.000Z" }
  }
}
```

- `code`: 프론트가 분기하고 **문구를 찾는 키**. 절대 변경 금지.
- `message`: 개발자용 영문 설명. **사용자에게 보여주지 않는다** — 로깅·디버깅용이다. 사용자 문구는 프론트가 `code`로 사전에서 찾는다(§1.10).
- `details`: 선택. 문구 템플릿에 끼워 넣을 값과 프론트가 후속 UI를 그리는 데 쓸 값.

**공통 에러 코드**

| HTTP | code | 발생 지점 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 모든 쓰기 엔드포인트. `details.fields[]`에 필드별 사유. 허용 목록 밖 필드가 온 경우 포함(§4.12 `PATCH /admin/users`) |
| 401 | `UNAUTHENTICATED` | 인증이 필요한 모든 경로. 프론트는 로그인 화면으로 |
| 401 | `REAUTH_REQUIRED` | `POST /api/relay/cut`·`/restore` — 비밀번호 재인증 실패 (§3.4) |
| 403 | `FORBIDDEN` | `/api/admin/*`에 `USER` 접근. **감사 기록 대상**(§3.6 `ADMIN_ACCESS_DENIED`) |
| 403 | `ACCOUNT_SUSPENDED` | Better Auth 로그인 시. 세션 유지 중 정지되면 다음 요청에서 이 코드 |
| 404 | `NOT_FOUND` | 리소스 없음 **또는 타인 소유**(§1.3 — 존재 은폐) |
| 409 | `NO_ACTIVE_SESSION` | §3.1 표의 4개 경로군 |
| 409 | `INTERLOCK_LOCKED` | `POST /api/relay/restore` — Fail-Safe 인터락 유지 중 (§3.3) |
| 409 | `BATTERY_BLOCKED` | `POST /api/sessions` — 대상 배터리 운영 상태가 `BLOCKED` (§4.12) |
| 409 | `DEVICE_OFFLINE` | `POST /api/sessions`, `POST /api/relay/*` — 대상 진단기 오프라인 |
| 409 | `NOTICE_NOT_DELETABLE` | `DELETE /api/admin/notices/{id}` — `DRAFT`가 아닌 공지 삭제 시도 |
| 422 | `REASON_REQUIRED` | `/relay/cut`·`/restore`, `/users/{id}/suspend`·`/restore`, `/batteries/{id}/ops-status`(BLOCKED 전환 시) |
| 429 | `RATE_LIMITED` | 인증 계열(`/api/auth/*`, `/api/me/password`)과 내보내기(`/api/trends/export`). `Retry-After` 헤더 동반 |
| 500 | `INTERNAL_ERROR` | 그 외 |

> **`BATTERY_ALREADY_CONNECTED`는 정의하지 않는다.** §3.2에 따라 새 연결 요청은 기존 세션을 **자동으로 종료하고** 성공하므로, 이 충돌 상태 자체가 발생하지 않는다. (타 사용자가 같은 배터리를 측정 중인 상황은 소유권 검증에서 `404`로 걸린다.)

### 1.5 목록 조회 공통 규약 `[제안]`

목록을 반환하는 모든 엔드포인트는 아래 쿼리와 응답 봉투를 공유한다.

**쿼리 파라미터**

| 이름 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `page` | int | `1` | 1-base |
| `size` | int | `20` | 최대 100 |
| `sort` | string | 엔드포인트별 | **정렬 키 이름은 엔드포인트별로 정의한다.** `필드,방향`(`score,desc`)이든 의미 키(`recent`)든 해당 절의 표기를 따른다 |
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

**봉투 예외** — 아래는 길이가 고정이거나 상위 객체에 종속된 목록이라 `page` 없이 `items`만 내려준다:
`GET /api/relay/history`, 상세 응답 안에 포함되는 하위 배열(`activityLogs`, `opsLogs`, `batteries`, `scoreTrend30d`, `contributions`)

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

- 배터리 관리 화면의 **PACK-003은 이상점수 33인데 배지가 `정상`** 이다. 4등급이면 `주의`여야 한다. (엄밀히는 이 배지 문자열이 mock 하드코딩이고 판정 로직 산출물이 아니지만, **목업 데이터조차 4등급과 어긋나 있다**는 점에서 같은 혼선의 산물이다.)
- 반대로 관리자 배터리 운영 로그에는 **`이상점수 위험 구간 진입 — 82 (위험 임계 80)`** 이라고 적혀 있다. **v3 자신도 일부 화면에서는 80을 정답으로 쓰고 있다.**
- 대시보드 게이지 범례 `정상 0–39 / 주의 40–69 / 위험 70+` 는 화면에 실재하며, 4등급으로 교체해야 한다.

> 위 표의 `관리자 배터리 목록 (scCol)` 행은 **등급 라벨이 아니라 점수 글자 색상**을 정하는 로직이다. 그래도 70/40 경계를 쓰는 건 같다.

### 1.7 상태·등급 enum 일람

프론트/백엔드가 공유하는 문자열 상수. **한국어 라벨은 프론트가 매핑한다. 서버는 enum 코드만 내려준다** (§1.10). `[확정]`

| 도메인 | enum |
|---|---|
| 이상 등급 | `NORMAL` `CAUTION` `WARNING` `DANGER` |
| 배터리 운영 상태 (관리자) | `NORMAL` `WATCH` `BLOCKED` `[v3]` `[REQ-WEB-121]` |
| 계정 상태 | `ACTIVE` `SUSPENDED` `[v3]` `[REQ-WEB-112]` |
| 계정 권한 | `USER` `ADMIN` `[REQ-WEB-113]` |
| 디바이스 상태 | `ONLINE` `DELAYED` `OFFLINE` `[v3]` |
| 릴레이 상태 | `CLOSED`(정상 연결) `OPEN`(차단됨) `[v3]` |
| 측정 모드 | `1`(외부 셀) `2`(보조배터리) (정수) `[PLAN]` — 2026-07-27 3모드 → 2모드 축소, 구 모드 3이 신 모드 2 |
| 배터리 종류 | `LI_ION` `LI_PO` `[v3: newChem='li_ion']` |
| 세션 상태 | `ACTIVE` `COMPLETED` `ABORTED` `[제안]` |
| 이벤트 심각도 | `NORMAL` `CAUTION` `WARNING` `DANGER` `CUT`(차단) `[v3: evtChips]` |
| 알림 채널 | `KAKAO` `EMAIL` `SMS` `WEBPUSH` `INAPP` `[v3]` `[REQ-WEB-065]` |
| 공지 카테고리 | `IMPORTANT`(중요) `MAINTENANCE`(점검) `FEATURE`(기능) `INFO`(안내) `[v3]` |
| 공지 게시 상태 | `PUBLISHED` `DRAFT` `ARCHIVED` `[v3]` `[REQ-WEB-131/132]` |
| 공지 노출 대상 | `ALL`(전체 사용자) `USER`(일반 사용자) `ADMIN`(관리자) `[v3]` |
| **알림** 심각도 | `DANGER`(위험) `WARNING`(경고) `NORMAL`(정상) `CHECK`(점검) `[v3: danger/warn/ok/idle]` |
| 지표 상태 | `OK` `WARN` `CRIT` `[제안]` |

> 이벤트 필터 칩은 v3에서 `전체·위험·경고·주의·차단·정상` 6종이다 `[v3]`. `차단`은 등급이 아니라 이벤트 종류(릴레이 차단)이므로 심각도 enum에 `CUT`을 추가했다.

### 1.8 단위 규약 `[PLAN]`

| 필드 | 단위 |
|---|---|
| `voltageV` | V |
| `currentA` | A |
| `powerW` | W |
| `socPct` | % (0–100 정수) |
| `tempContact`, `tempIrSurface` | °C |
| `gasRaw`, `pressureRaw`, `acousticRaw` | ADC raw (무차원 정수) |
| `dTdt` | °C/min `[v3: '+2.8 °C/min']` |

---

### 1.9 공용 타입

여러 절에서 이름으로 참조하는 축약 객체들이다. **여기 정의된 필드가 전부이며, 참조하는 쪽이 임의로 늘리지 않는다.** `[제안]`

**`NoticeSummary`** — 대시보드 공지 3건, 관리자 대시보드 공지 3건

```json
{ "id": "n_01H...", "category": "IMPORTANT", "title": "펌웨어 v5.2 긴급 업데이트 안내",
  "summary": "릴레이 인터락 안정성이 개선됩니다. 7/5 02:00에 자동 반영되며…", "publishedAt": "2026-07-01T00:00:00.000Z" }
```

- `summary`는 `body`의 앞 120자 발췌 `[제안]`. 대시보드가 본문 한 줄을 요약으로 보여준다 `[v3]`. §4.9 목록의 `body` 전문과 다른 필드다.

**`AdminBatteryRow`** — 관리자 대시보드 `최근 위험 배터리`

```json
{ "id": "b_01H...", "label": "PACK-001", "score": 0.82, "grade": "DANGER", "opsStatus": "BLOCKED" }
```

- v3 카드는 `PACK-001 / 82` 두 값만 보여준다 `[v3]`. `opsStatus`는 배지용으로 덧붙였다.
- **§4.12 `GET /api/admin/batteries` 목록 항목과 다른(더 작은) 타입이다.** 같은 이름을 쓰지 않도록 주의.

**`AuditEntry`** — 관리자 대시보드 `최근 관리자 조작`

```json
{ "id": "au_01H...", "at": "...", "actorName": "이연구", "action": "BATTERY_OPS_STATUS_CHANGE" }
```

- v3 카드는 `배터리 BLOCKED 변경 / 관리자 · 12분 전` 두 줄뿐이다 `[v3]`. **§4.12 감사 로그의 전체 필드를 싣지 않는다.** 문구는 `action`으로 프론트가 찾는다(§1.10).

---

### 1.10 문구 국제화 규약 — **서버는 문구를 만들지 않는다**

v3에 한/영 토글이 있으므로 `[REQ-WEB-015]`, **서버는 코드와 값만 내려주고 사람이 읽는 문장은 전부 프론트가 조립한다.**

```json
// ✗ 서버가 문장을 만들면 영어 전환이 깨진다
{ "cause": "셀 3 표면 온도 60.4°C, dT/dt 급상승" }

// ✓ 코드 + 파라미터
{ "causeCode": "TEMP_RISE_RATE_SPIKE", "causeParams": { "tempC": 60.4, "dTdt": 2.8 } }
```

**적용 대상** — 초안에서 서버가 한국어를 만들던 필드 전부:

| 필드 | 위치 | 대체 |
|---|---|---|
| `message` | 에러 응답 | `code` + `details` |
| `cause` / `action` | 이벤트 (§4.6) | `causeCode`+`causeParams` / `actionCode`+`actionParams` |
| `metricsSummary` | 알림 (§4.8) | `metrics` 객체 — 프론트가 `60.4°C · 이상점수 0.82` 조립 |
| `title` / `description` | 알림 (§4.8) | `titleCode` + `params` |
| `name` | 이벤트 (§4.6) | `type`(이미 있음)으로 충분 — `name` 삭제 |
| `label` | XAI (§4.5) | `feature`(이미 있음)로 충분 — `label` 삭제 |
| `changeSummary` | 감사 로그 (§4.12) | `before` / `after` 원시값 — 프론트가 `NORMAL → BLOCKED` 조립 |
| `actionLabel` | 감사 로그 (§4.12) | `action` enum으로 충분 — 삭제 |
| `summary` / `meta` | 활동 로그·운영 로그 | `code` + `params` |
| `sensorLabel` | 캘리브레이션 | 해당 기능 범위 제외(Q14) |

**예외 — 서버가 문자열을 그대로 내려도 되는 것:** 사용자·관리자가 **입력한** 자유 텍스트. `notice.title`/`body`, `battery.memo`, `admin_memo`, 제어 `reason`이 여기 해당한다. 번역 대상이 아니다.

> 프론트는 `code → 문구 템플릿` 사전을 ko/en 두 벌 관리한다. **서버가 새 `code`를 추가하면 프론트 사전에도 추가해야 하므로, 코드 목록은 이 문서에 유지한다** `[정의 필요 — Q34]` (전체 code 목록 확정).


## 2. 리소스 식별자 규약 `[제안]`

v3는 배터리를 `PACK-001` 문자열로 식별하지만, `PLAN.md`는 `battery_id`를 UUID로 규정한다. 둘 다 필요하다.

| 필드 | 타입 | 용도 |
|---|---|---|
| `id` | UUID | **API 경로·참조에 쓰는 유일 키.** 사용자에게 노출하지 않음 |
| `label` | string | 사용자가 보는 표시명. v3의 `PACK-001`에 해당. **중복 허용** — 유일성 제약을 걸지 않는다 `[PLAN.md:123,131]` |

동일 규칙을 `session`(v3 `SES-2041`), `device`(v3 `SN-00124`)에도 적용한다.

> **프론트는 URL과 상태에 `id`만 쓴다.** `label`은 렌더링 전용이다. 백엔드가 `label`을 경로 키로 받도록 만들면, 사용자가 배터리 이름을 바꾸는 순간 링크가 깨진다.

---

## 3. 도메인 불변식 — 서버가 반드시 강제할 것

프론트가 UI로 막더라도 **서버에서 다시 막아야 한다.** 아래는 전부 v3 화면 동작에서 실측한 규칙이다.

### 3.1 배터리 미연결 시 기능 잠금 게이트 `[v3]` `[REQ-WEB-073]`

v3 소스(내비게이션 항목 생성 함수 `item()`):

```js
const gated = !this.state.isAdmin && !connectedId;
const locked = gated && r !== 'battery';
```

**연결된 배터리가 없는 일반 사용자는 `배터리 자산관리`를 제외한 8개 메뉴가 전부 잠긴다.** (대시보드·이상 탐지·추세·이벤트·알림 센터·공지사항·릴레이 제어·설정)

안내 문구도 실재한다 — *"먼저 측정할 배터리를 선택하세요. — 배터리를 연결해야 대시보드·측정 세션·이상 탐지에 접근할 수 있습니다."* `[v3: T.pickFirst]`

**서버 요구사항:** active 세션이 없는 일반 사용자가 아래 경로를 호출하면 `409 NO_ACTIVE_SESSION`. 관리자(`ADMIN`)는 예외.

| 409 대상 | 이유 |
|---|---|
| `GET /api/dashboard` | 세션이 없으면 보여줄 실시간 값 자체가 없다 |
| `GET /api/anomaly/*` | 추론 대상이 없다 |
| `GET /api/relay`, `POST /api/relay/cut`, `/restore`, `GET /api/relay/history` | 제어 대상 회로가 없다 |
| WS `subscribe` (`metrics`·`anomaly`·`relay` 토픽) | 흘려보낼 스트림이 없다 |

**409를 걸지 않는 경로** — UI에서는 메뉴가 잠기지만 API는 정상 응답한다:
`/api/settings/*`, `/api/notices`, `/api/me`, `/api/batteries*`, `/api/alerts*`, `/api/events`, `/api/trends`

> **UI 잠금 범위(8메뉴)와 서버 409 범위가 다르다.** 설정·공지·알림·이벤트·추세는 세션이 없어도 조회에 문제가 없고, 오히려 막으면 알림 이력조차 못 보게 된다. 잠금은 "지금 볼 게 없으니 먼저 배터리를 고르라"는 UX 유도이고, 409는 "데이터가 존재할 수 없다"는 무결성 방어다. 둘을 같은 목록으로 맞추지 말 것.

### 3.2 배터리 연결 단일성 (active 세션 1개) `[v3]` `[PLAN: S-MSESSN]`

*"한 번에 하나의 배터리만 연결됩니다. 기존 연결은 해제됩니다."* `[v3: T.cnOneAtTime]`

- **`device_id`당 `ACTIVE` 상태 `measurement_session`은 최대 1개** `[PLAN.md:156, S-LWVJRY]`. 진단기 하나가 동시에 두 배터리를 측정할 수 없다는 물리적 제약이다.
- 새 배터리 연결 요청 시 서버가 **해당 진단기의 기존 세션을 원자적으로 종료하고** 새 세션을 연다. 프론트가 "종료 → 시작" 2콜로 나누지 않는다(중간 실패 시 무세션 상태로 빠짐).
- 모드 인터락: 새 세션의 `targetMode`가 이전과 다르면 **이전 모드 릴레이를 먼저 차단**한 뒤 전환한다. `[PLAN: S-LWVJRY]`

> **사용자당 진단기는 1대로 확정됐다.** 따라서 `device_id`당 1세션 = **사용자당 1세션**이 되어 두 규칙이 실질적으로 같다. `GET /api/me`의 `activeSession`은 단수로 유지하고, 진단기 선택 UI도 만들지 않는다.
> 나중에 여러 대를 지원하려면 `activeSession` → `activeSessions[]` 배열화와 진단기 선택 UI가 필요하다. 그때까지 **`deviceId`를 응답에 포함시켜 두면** 확장 시 프론트 변경 범위가 줄어든다.

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
- **보존 기간: 무기한** `[확정]`. 삭제·아카이브 배치를 만들지 않는다. 데이터가 커지면 그때 재검토한다.

### 3.6 감사 대상 동작 목록 `[v3]` `[REQ-WEB-118/126]`

아래 동작은 **반드시** 감사 로그를 남긴다.

| action | 대상 | 사유 필수 |
|---|---|---|
| `RELAY_CUT` / `RELAY_RESTORE` | battery | ✅ |
| `RELAY_AUTO_CUT` (Fail-Safe) | battery | 시스템 자동 (사유=트리거 조건) |
| `SESSION_AUTO_END` | session | 시스템 자동 (`TIMEOUT`/`SUPERSEDED`/`BLOCKED`) |
| `USER_SUSPEND` / `USER_RESTORE` | user | ✅ `[REQ-WEB-117]` |
| `USER_UPDATE` | user | — |
| `USER_PASSWORD_RESET_SENT` | user | — 재설정 **링크 발송** `[REQ-WEB-116]` |
| `BATTERY_OPS_STATUS_CHANGE` | battery | `BLOCKED`로 변경 시 ✅ `[REQ-WEB-125]` |
| `BATTERY_MEMO_UPDATE` | battery | — `[REQ-WEB-124]` |
| `NOTICE_PUBLISH` / `NOTICE_UPDATE` / `NOTICE_ARCHIVE` / `NOTICE_DELETE` | notice | — |
| `ADMIN_ACCESS_DENIED` | route | 시스템 자동 |
| `ADMIN_LOGIN` | — | 시스템 자동 |

---

### 3.7 계정 제재와 안전 감시의 분리 `[확정]`

**계정 정지·배터리 BLOCKED는 측정 파이프라인을 멈추지 않는다.** 에지→Kafka→적재→AI 추론→Fail-Safe는 계정 상태와 무관하게 계속 돈다.

| 제재 | 웹 접근 | 측정 세션 | 데이터 적재 | Fail-Safe |
|---|---|---|---|---|
| 계정 정지 | 차단 | **유지** | 계속 | 동작 |
| 배터리 BLOCKED | 정상 | **종료** + 신규 차단 | 미배정 적재 | 동작 |
| 릴레이 차단 | 정상 | 유지 | 계속 | 이미 발동 |

> 계정을 정지했다고 배터리 감시를 끄면, 정지된 사용자의 배터리가 열폭주해도 아무도 모른다. **제재는 사람에 대한 것이고 감시는 물건에 대한 것이다.**
> 배터리 BLOCKED만 세션을 끊는데, 이는 "이 배터리는 지금 쓰면 안 된다"는 판단이므로 측정 자체를 막는 게 맞다.

**세션이 끊긴 뒤 들어오는 데이터** — 에지는 계속 발행하므로 BLOCKED·타임아웃 종료 직후 반드시 이 상태가 된다. `PLAN.md:157`대로 **버리지 않고 `battery_id=null`로 적재**하고 `UNASSIGNED_DATA` 이벤트를 남긴다 `[PLAN]`.

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
    "deviceId": "d_01H...",
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

쿼리: `mode`(1\|2, 미지정=전체 `[REQ-WEB-033]`), `sort`(`recent`\|`score`\|`soc`, 기본 `recent` `[REQ-WEB-051]`), `page`, `size`

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
  "model": "18650",
  "capacityMah": 3000,
  "memo": "측정 대상 특이사항…"
}
```

- `label` **필수**, 중복 허용 `[PLAN]`
- `chemistry` **필수** `[PLAN]`
- `targetMode` **필수** — 재연결 시 모드 재선택을 없애기 위해 배터리에 고정된다 `[PLAN]`
- `seriesCount` / `maker` / `model` / `capacityMah` / `memo` **선택** `[PLAN.md:131-136]`
- 201 응답 본문은 생성된 배터리 객체 전체 (프론트가 목록에 즉시 삽입)

> **`memo`는 사용자 메모다.** v3 **배터리 수정** 모달에 `메모`(placeholder `측정 대상 특이사항…`) 입력이 있고 `PLAN.md:136`에도 선택 필드로 정의돼 있다 `[v3]` `[PLAN]`.
> **관리자 메모(`REQ-WEB-124`, §4.12)와 완전히 다른 필드다.** 관리자 메모는 `battery_asset.admin_memo`이며 사용자에게 보이지 않는다 `[PLAN.md:280]`. 두 필드를 같은 컬럼에 합치지 말 것.

#### `PATCH /api/batteries/{id}` `[REQ-WEB-038]`

`POST`와 동일한 필드를 부분 수정한다. **단 `targetMode`는 변경 불가** `[확정]` — 재연결 시 모드 재선택을 없애려고 자산에 고정한 값이다 `[PLAN]`. 오등록을 정정하려면 자산을 새로 등록한다(이전 측정 이력은 옛 자산에 남는다).
`targetMode`가 요청에 오면 `400 VALIDATION_FAILED`. **프론트는 수정 모달에서 측정 모드 선택을 비활성화해야 한다**(§12-22).

- `maker` / `model` **선택** — 카드·상세의 `18650 Li-ion · 3S` 표시에 쓴다.

> **v3 등록 폼에는 `maker`/`model` 입력이 없다** `[v3 실측]`. 입력은 `배터리 이름 / 종류(리튬이온·리튬폴리머) / 측정 모드(1·2) / 직렬 셀 수(S)` 4개뿐이고, 안내 문구는 `등록 시 battery_id(UUID)가 발급되고 측정 모드가 자산에 고정됩니다`이다.
> **결정: 등록 폼에 입력을 추가한다.** 백엔드 스키마는 위 요청 본문 그대로 가고, **프론트가 등록·수정 모달에 `제조사`·`모델` 입력 2개를 추가한다**(§12-11). 둘 다 선택 입력이므로 미입력 시 카드 표시는 `리튬이온 · 3S`로 축약한다.

#### `GET /api/batteries/{id}` — 배터리 상세/이력 (F7) `[REQ-WEB-040/044]`

```json
{
  "id": "b_01H...",
  "label": "PACK-001",
  "chemistry": "LI_ION",
  "seriesCount": 3,
  "targetMode": 1,
  "maker": "Samsung SDI",
  "model": "18650",
  "capacityMah": 3000,
  "memo": null,
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
  **모드 1은 여전히 보류다** `[Q6 보류]` — BQ27441이 사이클과 내부저항을 아는 경로가 있으나, AI 파이프라인 산출물인지 백엔드 집계인지 정하지 않았다. 값이 없으면 `health: null`을 내려주고 프론트는 그 사실을 드러낸다.
  **모드 2는 2026-07-28에 확정됐다** `[Q6 모드 2 확정]` — 아래 §모드 2 `health` 참조. 산출 주체는 **백엔드**다(§4.13의 진단 결과를 집계한다).

##### 모드 2 `health` — `targetMode: 2`일 때 `[확정 2026-07-28]` `[REQ-WEB-137]`

물리 근거·산식의 정본은 `docs/hardware/mode2_powerbank_diagnosis_spec.md`다.

```json
"health": {
  "source": "CAPACITY",
  "confidence": "HIGH",
  "measuredAt": "2026-07-28T11:40:00.000Z",
  "socHintLevel": null,
  "latestQuickDiagnosisId": "dg_01H...",
  "latestCapacityDiagnosisId": "dg_01H...",
  "quick": {
    "regulationKneeA": 1.6, "kneeIsUpperBound": false,
    "thermalSlopeCPerMin": 2.4, "specAttainmentPct": 80,
    "grade": "SUSPECT_DEGRADED"
  },
  "capacity": {
    "deliveredWh": 31.2, "ratedWh": 37.0, "baselineWh": 34.8,
    "sohRelPct": 89.7, "sohAbsPct": 95.8, "assumedEfficiency": 0.88,
    "dischargeCurrentA": 1.0, "isBaseline": false, "partial": false
  },
  "sohPct": 89.7,
  "cycleCount": null,
  "rulCycles": null,
  "internalResistanceMohm": null
}
```

**모드 2에서 세 필드는 `null` 확정이다. 값이 채워지는 경로를 만들지 않는다.**

| 필드 | 왜 `null`인가 |
|---|---|
| `internalResistanceMohm` | 셀과 USB 출력 사이에 **부스트 컨버터**가 있어 출력단 `ΔV/ΔI`는 컨버터 출력 임피던스다. 셀 내부저항이 아니다 (스펙 §1) |
| `cycleCount` | 내부 BMS에 접근할 수 없다. 우리가 아는 건 **우리 장비로 측정한 세션 수**뿐이며 배터리의 생애 사이클이 아니다 — 3년 쓴 보조배터리를 처음 물려도 카운트는 1이다 |
| `rulCycles` | 사이클을 모르니 사이클 단위 잔존수명도 못 낸다 |

- `sohPct`는 `capacity.sohRelPct`를 그대로 넣는다. 정밀 테스트가 **2회 이상**이어야 값이 생기고 그 전에는 `null`이다.
- ⚠️ **`sohAbsPct`를 `sohPct`에 넣지 않는다.** 정격 Wh는 셀 기준(3.7V×mAh)이고 측정은 출력단(5V) 기준이라, 부스트 효율 η를 보정하지 않으면 **새 배터리도 SOH 85%로 나온다.** η는 제품마다 달라 가정할 수 없으므로 `sohAbsPct`는 `assumedEfficiency`를 동봉한 **참고값**이며, 신뢰값은 같은 자산의 첫 테스트를 기준선으로 삼은 `sohRelPct`다 (스펙 §4-2).
- 진단을 한 번도 하지 않았으면 `health: null`. 빠른 진단만 있으면 `capacity: null`, `confidence: "LOW"`, `sohPct: null`.
- ⚠️ **v3의 `SOH 92% · RUL ~480 사이클 · 누적 사이클 312 · 내부 저항 18.4 mΩ`는 목업 숫자다.** 모드 2에서 이 네 값이 다 채워진 화면은 만들 수 없다. `REQ-WEB-044`를 모드 2에서 구현할 때는 **비어 있는 이유가 드러나야 한다.**
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
{ "batteryId": "b_01H..." }
```

- **`deviceId`를 받지 않는다.** 사용자당 진단기가 1대이므로 **서버가 계정에 묶인 진단기를 자동 선택한다.** v3에도 진단기 선택 UI가 없다 `[v3 실측]`.
- **§3.2에 따라 기존 active 세션을 서버가 원자적으로 종료한다.** 별도 종료 호출을 요구하지 않는다.
- 응답 `201`:

```json
{
  "id": "s_01H...", "label": "SES-2045",
  "batteryId": "b_01H...", "batteryLabel": "PACK-001",
  "deviceId": "d_01H...",
  "mode": 1, "status": "ACTIVE", "startedAt": "..."
}
```

- 대상 배터리의 진단기가 오프라인이면 `409 DEVICE_OFFLINE`.
- 대상 배터리의 운영 상태가 `BLOCKED`이면 `409 BATTERY_BLOCKED` (§4.12).

#### 측정 세션 종료 — **사용자 조작 엔드포인트 없음**

`DELETE /api/sessions/{id}`를 **만들지 않는다.** v3에 "측정 종료"·"연결 해제" 버튼이 0건이며 `[v3 실측]`, 프론트도 추가하지 않는다. 세션은 아래 세 경우에 **서버가** 닫는다.

| 트리거 | 동작 | 종료 사유(`endReason`) |
|---|---|---|
| **데이터 미수신 타임아웃** | `battery-raw-metrics` 무수신이 N분 지속되면 자동 종료 | `TIMEOUT` |
| 다른 배터리 연결 | `POST /api/sessions`가 기존 세션을 원자적으로 종료 (§3.2) | `SUPERSEDED` |
| 배터리 `BLOCKED` 전환 | 관리자가 운영 상태를 BLOCKED로 바꾸면 진행 중 세션 종료 (§4.12) | `BLOCKED` |

- 타임아웃 임계 N은 `[정의 필요 — Q35]`. **5분을 제안한다** — 에지 발행 주기가 100ms이므로 5분 무수신이면 전원이 나갔거나 배터리를 분리한 상태다.
- 종료 시 `session.ended` WebSocket 메시지를 푸시하고(§5.4), 프론트는 게이트 화면(§3.1)으로 되돌린다.
- **계정 정지는 세션을 끝내지 않는다** (Q15 결정, §3.7 참조).

> **에지 음성 안내 연동:** 세션 시작/종료는 `battery-events` 토픽으로 발행되어 라즈베리파이가 로컬 음성파일을 재생한다 `[PLAN: S-VOCALR]`. 이 발행은 백엔드 책임이며 프론트는 관여하지 않는다.

### 4.4 실시간 관제 (F4)

#### `GET /api/dashboard` — 초기 스냅샷 `[REQ-WEB-019/021/024]`

WebSocket 연결 **전에** 화면을 채우기 위한 1회 조회. 이후 갱신은 §5 WebSocket이 담당한다. `[제안]`

**v3 대시보드의 실제 구성** (브라우저 실측): 배터리 헤더 + 상태 배너 + 이상점수 게이지 → 빠른 추세 4카드(V/I/T/SOC, 각 카드에 개별 상태 배지) → V·I·T·SOC 추세 차트 1개(지표 선택 버튼) → 공지사항 3건. **이게 전부다.**

> **REQ-WEB-025(위험도 분포)·REQ-WEB-026(최근 이벤트)은 대시보드에 없다.** 둘 다 이상 탐지 화면(F8)에 있다 → §4.5로 옮겼다.

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
  "relay": { "state": "OPEN", "reasonCode": "FAILSAFE_TEMP_OVER_CAP", "changedAt": "..." },
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
**현재 확정된 임계값 — 온도뿐이다.**

| 지표 | WARN | CRIT | 근거 |
|---|---|---|---|
| `tempContact`, `tempIrSurface` | ≥ 55°C | ≥ 60°C | v3 `dTempWarn = dTemp >= 55` `[v3]` / CRIT은 Fail-Safe 온도 상한과 정렬 `[제안]` |
| `voltageV`, `currentA`, `socPct`, `powerW` | — | — | **미정 → `status: null`** |

- **`status`는 `null`을 허용한다.** 임계값이 정해지지 않은 지표는 서버가 `null`을 내려보내고, 프론트는 그 카드에 배지를 렌더링하지 않는다. 온도 카드만 배지가 붙는다.
- 전압은 `chemistry`·`seriesCount`로 셀당 상·하한을 환산해야 해서 배터리마다 값이 달라진다 — 나중에 정한다 `[정의 필요 — Q27]`.

> **Fail-Safe 임계와 구분할 것.** 이 `status`는 **표시용 경고**다. 릴레이를 차단하는 물리 임계(§3.3)와 같은 값을 쓸 필요는 없으며, 오히려 `CRIT`이 Fail-Safe보다 먼저 뜨도록 낮게 잡는 편이 경고 목적에 맞다.
- `aeScore`/`informerScore`는 이중 모델 개별 점수 `[PLAN: S-FGKMXE]`. v3 화면에는 없다. 없으면 `null`.
- `notices`는 대시보드 하단 공지 3건 `[v3]` `[REQ-WEB-028]`. §1.9 `NoticeSummary` 타입.
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

쿼리: `batteryId`(생략 시 **활성 세션의 배터리**). v3 패널 제목이 `PACK-001 · 이상점수 82`로 특정 배터리를 가리킨다 `[v3]`.

v3가 표시하는 4개 특징: `dT/dt(온도 상승률)`, `I_smooth(전류 변화량)`, `V_drop(전압 강하)`, `SOC_delta(SOC 변화율)` `[v3: T.f1~f4]`

```json
{
  "batteryId": "b_01H...",
  "score": 0.82,
  "evaluatedAt": "...",
  "contributions": [
    { "feature": "dT_dt", "contribution": 0.42 },
    { "feature": "I_smooth", "contribution": 0.28 },
    { "feature": "V_drop", "contribution": 0.16 },
    { "feature": "SOC_delta", "contribution": 0.09 }
  ]
}
```

- **합이 1이 되도록 정규화하지 않는다.** v3 실측값은 `+0.42 / +0.28 / +0.16 / +0.09`로 합이 **0.95**다. 각 특징이 이상점수에 기여한 양이며 서로 독립이다. 프론트는 최댓값 기준으로 막대 폭을 잡는다.
- **`contribution`은 0 이상 실수다.** 음의 기여(이상점수를 낮추는 방향)는 내려보내지 않는다. 따라서 프론트는 단방향 막대만 그리면 된다.
- 내림차순 정렬 보장.
- **`label`은 내려주지 않는다** (§1.10). 프론트가 `feature` 값으로 문구를 찾는다.

#### `GET /api/anomaly/events` — 활성 이상 이벤트 `[REQ-WEB-045]`

`/api/events`의 `?status=ACTIVE` 뷰. §4.6과 동일 스키마.

- **`ACTIVE`의 정의**: 해당 배터리의 **현재 등급이 `CAUTION` 이상이면서 아직 해소되지 않은** 이벤트. 같은 배터리에서 이후 `NORMAL` 이벤트가 발생하면 해소된 것으로 본다 `[제안]`.
- §4.6 쿼리에 `status`(`ACTIVE`\|`ALL`, 기본 `ALL`)를 추가한다.

### 4.6 이벤트 이력 (F10)

#### `GET /api/events` `[REQ-WEB-049~053]`

쿼리: `q`(**배터리 라벨만** 검색), `severity`(`DANGER|WARNING|CAUTION|CUT|NORMAL`, 복수 가능), `batteryId`, `from`, `to`, `page`, `size`

> **`q`는 배터리 라벨만 검색한다.** 이벤트명은 §1.10에 따라 서버에 문자열로 존재하지 않고 프론트 사전에만 있다. 이벤트 종류로 거르려면 `severity` 또는 `type`(복수 가능)을 쓴다 — 프론트가 사전을 역검색해 매칭되는 `type` 목록을 만들어 보낸다.

**정렬 파라미터는 없다.** v3 이벤트 화면에 정렬 UI가 없다(검색창 + 상태 칩 6종 + 페이지네이션뿐). 항상 `occurredAt desc` 고정이다. `REQ-WEB-051`이 말하는 `최근 측정순 / 이상점수 높은순 / SOC 낮은순` 드롭다운은 **배터리 관리 화면(F6)의 것**이며, 기능정의서가 이벤트 화면으로 잘못 분류했다 `[v3 실측]`.

```json
{
  "items": [{
    "id": "e_01H...",
    "occurredAt": "2026-07-22T14:32:10.000Z",
    "type": "RELAY_AUTO_CUT",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "score": null,
    "grade": null,
    "severity": "CUT",
    "source": "SYSTEM",
    "causeCode": "FAILSAFE_TEMP_OVER_CAP",
    "causeParams": { "tempC": 61.4, "capC": 60 },
    "actionCode": "AUTO_CUT_AND_NOTIFY",
    "actionParams": {}
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
| `sessionIds` | 콤마 구분 (배터리 대신 세션 비교) | `[제안]` |

> `sessionIds`는 **v3에 UI가 없다.** 패널 제목만 `다중 배터리 / 세션 비교`이고 실제 비교 드롭다운은 배터리 5개만 고른다(`compareItems: ['PACK-001' … 'PACK-005']`) `[v3 실측]`. 세션 비교가 필요 없으면 이 파라미터를 뺀다.

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
- **다운샘플링 확정** `[확정]` — v3 포인트 수와 일치시킨다 `[v3: periodCfg.n]`:

| period | 버킷 | 포인트 수 |
|---|---|---|
| `24h` | 1시간 | 25 |
| `7d` | 1일 | 7 |
| `30d` | 1일 | 30 |

- **집계 방식은 지표마다 다르다** `[확정]`:

| 지표 | 집계 | 이유 |
|---|---|---|
| `temp`, 이상점수 | `max` | 피크를 평균으로 뭉개면 열폭주 전조가 사라진다 |
| `volt`, `curr`, `soc` | `avg` | 추세 파악이 목적이고 순간 스파이크는 노이즈다 |

#### `GET /api/trends/export` `[REQ-WEB-054/055]`

CSV·PDF 버튼은 **추세 화면 상단, 기간 탭 옆**에 있다 `[v3 실측]`.

쿼리: `GET /api/trends`의 파라미터 전부 + `format=csv|pdf`

- 응답: `200` + `Content-Disposition: attachment`
- **동기 다운로드로 처리한다** `[확정]`. 내보내는 것은 원시 시계열이 아니라 **이미 집계된 버킷**이므로(위 표: 최대 30포인트 × 4지표 × 비교 배터리 수), 응답이 커질 일이 없다. 비동기 작업 큐·완료 알림은 만들지 않는다.
- 기간 상한 = `period`가 곧 상한이라 별도 제한이 필요 없다. 비교 배터리는 최대 5개로 제한한다 `[v3: compareItems 5개]`.

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

- **`unacknowledgedCount`는 `severity: DANGER` 중 미확인 건수다.** v3 카드의 `확인이 필요한 알림 1건`이 위험 1건만 세기 때문이다(`alertCounts.unread = acked.a1 ? 0 : 1`) `[v3]`. 아래 Ack 노출 규칙과 같은 기준이다.
- `today` 3칸은 **당일 발생 건수**를 심각도별로 센다(확인 여부 무관). `정상`과 `점검`(디바이스 이벤트)을 한 칸에 합친다.

> 4등급 분포와 다른 축이므로 §4.5의 `riskDistribution`을 재사용하지 말 것.

#### `GET /api/alerts` — 알림 이력

쿼리: `severity`(복수 가능), `subjectType`, `batteryId`, `acknowledged`(`true|false`), `from`, `to`, `page`, `size`. 기본 정렬 `occurredAt desc`.

```json
{
  "items": [{
    "id": "al_01H...",
    "severity": "DANGER",
    "titleCode": "TEMP_THRESHOLD_EXCEEDED",
    "params": { "tempC": 60.4, "dTdt": 2.8, "score": 0.82 },
    "//": "titleCode 하나가 프론트 사전에서 {title, description} 쌍을 가리킨다",
    "batteryId": "b_01H...",
    "batteryLabel": "PACK-001",
    "subjectType": "BATTERY",
    "occurredAt": "...",
    "acknowledgedAt": null,
    "channels": ["KAKAO", "INAPP", "SMS"],
    "metrics": { "tempC": 60.4, "score": 0.82 },
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
- **`확인(Ack)`·`Raw 데이터 보기` 버튼은 `severity === 'DANGER'` 이면서 미확인인 알림에만 노출된다** `[v3: showAck = a.tone === 'danger' && !acked]`. 경고·정상·점검 알림은 **미확인이어도 버튼이 없다.**
  - 따라서 `POST /alerts/ack-all`의 대상도 **미확인 위험 알림**이다. 응답 `{ "acknowledgedCount": 3 }`.
  - 서버는 이미 확인된 알림에 대한 `ack` 재요청을 멱등 처리한다(에러 아님). `DANGER`가 아닌 알림에 대한 `ack`도 거부하지 않고 그대로 기록한다 — 정책이 나중에 완화될 수 있으므로 서버가 UI 규칙을 강제하지 않는다.
- `POST /ack` 응답은 갱신된 알림 객체.

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
    "summary": "릴레이 인터락 안정성이 개선됩니다. 7/5 02:00에 자동 반영되며…",
    "publishedAt": "2026-07-01T00:00:00.000Z"
  }],
  "page": { "number": 1, "size": 20, "total": 4, "totalPages": 1 }
}
```

- 사용자 엔드포인트는 `PUBLISHED`만 반환한다. `DRAFT`/`ARCHIVED`는 관리자 전용.
- **목록은 `summary`(본문 앞 120자), 상세는 `GET /api/notices/{id}`가 `body` 전문** `[확정]`. v3는 목록 클릭 시 추가 요청 없이 모달을 열지만 `[v3]`, 본문 길이에 상한이 없으므로 목록에 전문을 싣지 않는다. 프론트는 항목 클릭 시 상세를 한 번 더 호출한다.
- **`viewCount`는 상세 조회 시 +1** `[확정]`. 같은 사용자의 24시간 내 재조회는 세지 않는다. 목록 조회로는 오르지 않는다.

**`GET /api/notices/{id}`** — 상세

```json
{
  "id": "n_01H...", "category": "IMPORTANT",
  "title": "펌웨어 v5.2 긴급 업데이트 안내",
  "body": "릴레이 인터락 안정성이 개선됩니다. 7/5 02:00에 자동 반영되며, 반영 중 약 3분간 원격 제어가 제한됩니다.",
  "publishedAt": "2026-07-01T00:00:00.000Z"
}
```

- `body`는 **사용자가 입력한 자유 텍스트**라 서버가 그대로 내려준다(§1.10 예외).
- `viewCount`는 **사용자 응답에 포함하지 않는다** — v3 사용자 화면에 조회수 표시가 없다 `[v3]`. 관리자 목록에만 있다.

### 4.10 릴레이 제어 (F12)

#### `GET /api/relay` `[REQ-WEB-061]`

```json
{
  "batteryId": "b_01H...",
  "state": "OPEN",
  "changedAt": "...",
  "changedBy": { "type": "SYSTEM", "systemCode": "FAILSAFE" },
  "reasonCode": "FAILSAFE_TEMP_OVER_CAP",
  "reasonParams": { "tempC": 61.4, "capC": 60 },
  "interlock": { "engaged": true, "condition": "TEMP_OVER_CAP", "canRestore": false }
}
```

- `interlock.canRestore: false`면 프론트는 복구 버튼을 비활성화한다. 서버도 `409 INTERLOCK_LOCKED`로 막는다 (§3.3).

> **자동 복구는 없다.** 한 번 차단된 회로는 **사용자가 재인증·사유 입력으로 수동 복구**해야만 열린다(§3.4). 열폭주는 재발 위험이 크므로 사람이 확인하고 여는 것이 안전하다.
> 따라서 `autoRecoverEnabled` 필드도, `RELAY_AUTO_RESTORE` 액션도 만들지 않는다. **v3의 `릴레이 자동 복구 완료` 이벤트·알림·제어 이력은 프론트가 삭제해야 한다**(§12-19).

> `interlock`은 v3 화면에 표시되지 않지만 `[v3 실측]` 계약에는 유지한다 — §3.3의 Fail-Safe 우선 규칙을 서버가 강제하려면 인터락 상태가 필요하고, 프론트는 복구 버튼 활성/비활성 판단에 `canRestore`를 쓴다.

#### `POST /api/relay/cut` / `POST /api/relay/restore` `[REQ-WEB-062/063]`

```json
{ "reason": "셀 3번 온도 임계값 초과로 긴급 차단", "password": "••••••••" }
```

§3.4 승인 절차 적용. 성공 시 갱신된 릴레이 상태 객체 반환 + WebSocket 브로드캐스트.

> **기존 `POST /api/relay/kill-switch/confirm`(`backend/src/server.ts:44`)을 `POST /api/relay/cut`으로 교체한다** `[확정]`. 현재 구현은 `202 accepted`만 반환하는 스텁이라 실제 제어가 없으므로 교체 비용이 없다.
> 함께 맞출 것: 기존 감사 로그 action 이름이 `KILL_SWITCH_CONFIRM`·`ADMIN_ACCESS`로 §3.6 표(`RELAY_CUT`·`ADMIN_ACCESS_DENIED`)와 다르다.

#### `GET /api/relay/history` `[v3: T.recentCtrl '최근 제어 이력']`

```json
{
  "items": [
    {
      "id": "rl_01H...", "action": "RELAY_RESTORE", "at": "...",
      "actor": { "type": "USER", "id": "u_01H...", "name": "홍길동" },
      "reason": "점검 완료, 정상 확인 후 복구"
    },
    {
      "id": "rl_01G...", "action": "RELAY_AUTO_CUT", "at": "...",
      "actor": { "type": "SYSTEM", "systemCode": "FAILSAFE" },
      "reasonCode": "FAILSAFE_TEMP_OVER_CAP",
      "reasonParams": { "tempC": 61.4, "capC": 60 }
    }
  ]
}
```

- **`reason`은 사용자가 입력한 자유 텍스트일 때만 쓴다.** 시스템이 일으킨 동작은 `reasonCode` + `reasonParams`다(§1.10). 한 항목에 둘 중 하나만 채워진다.
- 액터가 시스템이면 `{ type: "SYSTEM", systemCode }`, 사람이면 `{ type: "USER", id, name }`. `name`은 사람에게만 있다.
- **`RELAY_AUTO_RESTORE`는 없다** — 자동 복구를 하지 않기로 했다(Q12).

### 4.11 설정 (F14)

**v3 설정 탭은 3개다** `[v3 실측]`: `알림 수신` / `계정 정보` / `테마 · 캘리브레이션`.

| 메서드 | 경로 | 탭 | 근거 |
|---|---|---|---|
| `GET`/`PATCH` | `/api/settings/alerts` | 알림 수신 | `[REQ-WEB-065/066]` |
| `PATCH` | `/api/me` | 계정 정보 | `[REQ-WEB-067]` |
| `POST` | `/api/me/password` | 비밀번호 변경 | `[REQ-WEB-068]` |
| `GET`/`PATCH` | `/api/settings/preferences` | 테마 · 캘리브레이션 | `[REQ-WEB-070/015]` |
| `GET`/`PATCH` | `/api/settings/voice-alert` | **화면 없음** | `[REQ-WEB-072]` `[PLAN]` |

**요청 본문**

```jsonc
// PATCH /api/me — 계정 정보 탭. 허용 필드 3개
{ "name": "홍길동", "email": "hong@cellguard.io", "phone": "010-1234-5678" }

// POST /api/me/password — 비밀번호 재설정 모달 [v3: 현재/새/새 확인 3개 입력]
{ "currentPassword": "••••••••", "newPassword": "••••••••" }

// PATCH /api/settings/preferences
{ "theme": "light", "lang": "ko" }   // theme: light|dark|system, lang: ko|en
```

> `newPasswordConfirm`은 **서버로 보내지 않는다.** 일치 검증은 프론트 책임이다.
> `PATCH /api/me`로 `role`·`status`를 바꿀 수 없다(§4.12와 동일 원칙).

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

> **센서 캘리브레이션 이력(REQ-WEB-071)은 범위에서 제외한다.** v3에 조회 화면(`테마 · 캘리브레이션` 탭 하단)이 있지만 등록 수단이 없고, 보정 작업 자체가 라즈베리파이에서 이뤄지는 하드웨어 절차다. **`GET /api/calibrations`를 만들지 않으며, 프론트는 해당 섹션을 제거한다**(§12-21).

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
  "modeDistribution": { "1": 1060, "2": 224 },
  "eventTrend7d": [
    { "bucket": "2026-07-16", "caution": 8, "warning": 3, "danger": 1 }
  ],
  "recentRiskBatteries": [ /* AdminBatteryRow × 3 */ ],
  "recentAdminActions": [ /* AuditEntry × 3 */ ],
  "recentNotices": [ /* NoticeSummary × 3 */ ]
}
```

- **KPI 카드는 4개다** — `전체 유저 / 전체 배터리 / 활성 세션 / 위험·경고 배터리` `[v3 실측]`. `REQ-WEB-104`가 언급한 **오프라인 디바이스 카드는 화면에 없다.** 디바이스 화면(F5)이 제외된 것과 일관되므로 `offlineDevices`를 뺐다.
- `modeDistribution` — 배터리 상태 분포 카드 하단에 `모드 1 / 2 → 1060 / 224`로 표시된다 `[v3 실측]`. v3는 모드 3까지 3칸이었으나 2모드 축소(2026-07-27)로 2칸이 됐다.
- `statusDistribution` 키는 운영 상태(`NORMAL/WATCH/BLOCKED`)이며, 이상 탐지 화면의 `riskDistribution`(이상 등급)과 **다른 축이다.** 혼동 주의.
  - 화면 라벨은 `정상 / 주시 / 제한`이다 `[v3 실측]`. `제한` = `BLOCKED`. 목록 필터 칩은 영문 `NORMAL / WATCH / BLOCKED`를 쓰므로 **같은 값에 두 벌의 한국어 라벨이 존재한다.** 프론트가 하나로 통일해야 한다.

#### `GET /api/admin/event-trend` — 이벤트 추이 (F20) `[REQ-WEB-107/108]`

쿼리: `period=24h|7d|30d`

```json
{
  "period": "7d",
  "buckets": [{ "at": "2026-07-16", "caution": 8, "warning": 3, "danger": 1 }],
  "summary": { "total": 66, "dangerTotal": 12, "peakAt": "2026-07-21", "peakTotal": 24 }
}
```

`summary` 3개 지표는 v3 화면에 존재 `[v3: evT.total/peak/danger]`.

> **요일·시각 라벨은 서버가 만들지 않는다** (§1.10). v3는 `wk: [L('월','Mon'), …]`로 프론트가 ko/en 분기한다 `[v3]`. 서버는 `at`(ISO)만 주고 프론트가 `period`에 맞춰 `월`/`Mon`/`00:00`으로 포맷한다. `peakBucket` 대신 `peakAt`.

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
  }],
  "page": { "number": 1, "size": 20, "total": 4, "totalPages": 1 }
}
```

**`PATCH /api/admin/users/{id}`** — 허용 필드는 아래 **3개뿐이다.**

```json
{ "name": "홍길동", "loginId": "hong", "phone": "010-1234-5678" }
```

> **`role`·`status`·`batteryCount`는 이 엔드포인트로 바꿀 수 없다.** 그 외 필드가 오면 `400 VALIDATION_FAILED`.
> - `status` 변경은 `/suspend`·`/restore` 전용 — **사유 필수 + 감사 기록**(§3.4·§3.6)이 걸려 있다. `PATCH`로 뚫리면 그 통제가 통째로 우회된다.
> - **`role` 변경은 웹에서 아예 불가하다.** 관리자 계정은 운영자가 DB·스크립트로 직접 만든다. 권한 상승 경로를 웹에 두지 않아 공격면이 줄어든다. **프론트는 유저 수정 모달에서 `권한` 셀렉트를 제거해야 한다**(§12-16).
> - `batteryCount`는 **파생값**이다. v3 유저 수정 모달이 `등록 배터리 수`를 편집 가능한 입력으로 그리지만 `[v3 실측]`, 이는 프로토타입 오류다 — 프론트가 읽기 전용으로 바꿔야 한다(§12-15).

**`POST /api/admin/users/{id}/password-reset`** `[REQ-WEB-116]`

요청 본문 **없음.** 응답 `202` + `{ "sentTo": "ho***@cellguard.io" }`(마스킹).

> **관리자가 비밀번호를 직접 지정하지 않는다.** 서버가 해당 계정에 **재설정 링크를 메일로 발송**하고, 사용자가 직접 새 비밀번호를 정한다. 관리자가 타인의 평문 비밀번호를 알게 되는 경로를 없앤다.
> Better Auth에 `sendResetPassword` 훅이 이미 배선돼 있다(`backend/src/auth.ts:23`) — 현재는 `console.info` 스텁이므로 메일 발송기를 연결해야 한다.
> **프론트는 유저 수정 모달의 `새 비밀번호` 입력을 `재설정 메일 보내기` 버튼으로 바꿔야 한다**(§12-20). 감사 기록 대상이다(§3.6).

**상세** — 목록 필드 + `batteries[]`(id, label, opsStatus) + `activityLogs[]` `[v3]` `[REQ-WEB-114]`

```json
{
  "batteries": [{ "id": "b_01H...", "label": "PACK-001", "opsStatus": "BLOCKED" }],
  "activityLogs": [{
    "at": "...", "action": "LOGIN",
    "params": { "ip": "203.0.113.24", "userAgent": "Chrome" }
  }]
}
```

**정지/해제** — `{ "reason": "..." }` 필수 (`422 REASON_REQUIRED`), 감사 기록 `[REQ-WEB-117/118]`

> **정지해도 진행 중인 측정은 계속된다.** 정지는 **웹 로그인 차단**일 뿐이며, 에지(라즈베리파이)는 계정 상태와 무관하게 계속 발행하고 서버도 계속 적재한다. Fail-Safe 안전계층도 그대로 동작한다.
> 정지된 사용자의 다음 요청은 `403 ACCOUNT_SUSPENDED`, 활성 세션 쿠키도 무효화한다.
> v3 mock에 `측정 중단 · 소유자 계정 정지` 로그가 있으나 `[v3]`, **이 동작은 채택하지 않는다.** 측정 중 강제 종료는 열폭주 감시에 공백을 만든다 — 계정 제재와 안전 감시를 분리한다.

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
  }],
  "page": { "number": 1, "size": 20, "total": 4, "totalPages": 1 }
}
```

**상세** — 목록 항목 + `info` + `opsLogs[]`

```json
{
  "info": {
    "seriesConfig": "3S · 11.1V",
    "device": { "id": "d_01H...", "label": "진단기 A", "status": "ONLINE" },
    "adminMemo": "열폭주 징후로 차단 유지"
  },
  "opsLogs": [{
    "at": "...", "severity": "DANGER",
    "code": "RELAY_AUTO_CUT", "params": { "tempC": 61.4, "capC": 60 }
  }]
}
```

- `seriesConfig`는 `seriesCount` + `chemistry` 공칭전압으로 **서버가 조립**한다(파생값, 저장 안 함).
- **`location`(설치 위치)은 삭제한다** `[확정]`. `PLAN.md`의 `battery_asset`에도, 등록/수정 폼에도 없어 **저장할 방법 자체가 없다.** v3 코드에 값이 있지만 렌더링되지 않는다 `[v3]`. 필요해지면 그때 등록 폼과 함께 추가한다.
- **`device`(연결 진단기)는 유지한다** — Q7에서 사용자당 진단기 1대로 확정됐으므로, 계정에 묶인 진단기를 서버가 역참조해 채운다. 활성 세션이 없으면 `null`.

> **v3 상세 모달은 조회 전용이다** `[v3 실측]`. 실제로 열어보면 `이상점수 / 온도 / 전압 / SOC` 4칸과 `운영 로그` 목록, 그리고 `닫기` 버튼뿐이다. **운영 상태를 바꾸는 UI도, 관리자 메모를 입력하는 UI도 없다.** 코드에 정의된 `info[]`(직렬 구성·설치 위치·연결 진단기·관리자 메모)조차 렌더링되지 않는다.
> 그럼에도 `REQ-WEB-123/124/125`는 **계약에 포함하기로 결정했다** — 감사 로그에 이미 `배터리 상태 변경 · NORMAL → BLOCKED` 기록이 존재하므로 기획상 있어야 하는 기능이다. **프론트가 상세 모달에 입력 UI를 추가해야 한다.**

**운영 상태 변경** — `{ "opsStatus": "BLOCKED", "reason": "열폭주 징후" }`
`BLOCKED`로 변경 시 `reason` **필수** `[REQ-WEB-125]`, 감사 기록 `[REQ-WEB-126]`.

**관리자 메모** — `{ "memo": "열폭주 징후로 차단 유지" }`, 감사 기록 `[REQ-WEB-124/126]`.

**`BLOCKED` 전환의 효과** — 운영 통제이며 **물리 제어가 아니다**:

1. 해당 배터리로 **새 측정 세션을 열 수 없다** — `POST /api/sessions`가 `409 BATTERY_BLOCKED`
2. **진행 중인 세션이 있으면 종료한다** (`endReason: "BLOCKED"`, §4.3)
3. **릴레이는 건드리지 않는다** — 회로 차단이 필요하면 관리자가 별도로 Kill-Switch를 실행한다(§4.10, 재인증·사유 필수)

> 운영 상태와 물리 제어를 분리한 이유: BLOCKED는 관리자가 목록에서 한 번의 클릭으로 거는 라벨이고, 릴레이 차단은 §3.4의 승인 절차를 거치는 위험 조작이다. 둘을 묶으면 실수로 가동 중인 장비를 끊게 된다.

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
  - **v3는 채널별 선택이 아니라 `게시와 동시에 웹푸시·카카오 알림 발송` 체크박스 하나다** `[v3]`. 배열로 받는 것은 `[제안]`이며, 체크박스 하나로 유지하려면 `notifyOnPublish: boolean`으로 바꾼다.
- `audience` — v3 `노출 대상` select의 옵션은 `전체 사용자 / 일반 사용자 / 관리자` **3종이다** `[v3]`. enum: `ALL` \| `USER` \| `ADMIN`.
- 관리자 목록에는 `viewCount`가 표시된다 `[v3: views '1,204']`. **상세 조회 시 +1, 동일 사용자 24시간 내 중복 제외, 목록 조회로는 오르지 않음** `[확정]`.
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
    "targetType": "BATTERY",
    "targetId": "b_01H...",
    "targetLabel": "PACK-001",
    "before": { "opsStatus": "NORMAL" },
    "after": { "opsStatus": "BLOCKED" },
    "reason": "열폭주 징후",
    "ip": "203.0.113.24"
  }],
  "page": { "number": 1, "size": 20, "total": 5, "totalPages": 1 }
}
```

- **`변경 내용` 컬럼은 프론트가 `before`/`after`로 조립한다** (§1.10). 서버는 원시값만 준다. 항목 유형마다 조립 결과가 다르다:

| action | before / after | 프론트 표시 |
|---|---|---|
| `BATTERY_OPS_STATUS_CHANGE` | `{opsStatus}` 쌍 | `NORMAL → BLOCKED` |
| `USER_SUSPEND` | `{status}` 쌍 | `ACTIVE → SUSPENDED` |
| `BATTERY_MEMO_UPDATE` | `{memo}` 쌍 | 메모 변경 표기 (본문은 자유 텍스트라 그대로 노출) |
| `ADMIN_ACCESS_DENIED` | 둘 다 `null` | `권한 없음 (RBAC)` — `action`으로 문구 결정 |
| `ADMIN_LOGIN` | 둘 다 `null` | `ip` 값 표시 |

- 변경이 없는 항목(`ADMIN_LOGIN`, `ADMIN_ACCESS_DENIED`)은 `before`/`after`가 **둘 다 `null`** 이다.
- 시스템이 주체인 항목(`ADMIN_ACCESS_DENIED`)은 `actor`가 `null`이고 `targetLabel`에 시도한 계정 이메일이 들어간다 `[v3 실측]`.
- 프론트는 **수정·삭제 UI를 렌더링하지 않는다.** 서버도 해당 메서드를 노출하지 않는다. 화면 우상단에 `수정·삭제 불가` 칩이 상시 표시된다 `[v3]` `[REQ-WEB-136]`.
- **보존 기간: 무기한.** 삭제·아카이브 배치를 만들지 않는다. 데이터가 커지면 그때 재검토한다.

> **`REQ-WEB-135`(감사 로그 상세 확인)는 계약에서 제외한다.** v3에서 행을 클릭해도 아무 반응이 없다(상세 모달 미구현) `[v3 실측]`. 다만 `before`/`after`를 이미 구조화해 내려주므로, 나중에 상세 모달을 만들 때 **서버 변경 없이** 붙일 수 있다.

### 4.13 보조배터리 진단 (F21) `[확정 2026-07-28]`

> 절 번호는 추가 순서다. 이 절은 **일반 사용자 기능**이며 §4.12(관리자)와 무관하다. 기존 절 번호를 흔들지 않기 위해 뒤에 붙였다.
>
> 물리 근거·산식·안전 조건의 정본은 `docs/hardware/mode2_powerbank_diagnosis_spec.md`다. 이 절은 그 스펙의 API 표면만 정의한다. **산식을 이 문서에서 다시 정의하지 않는다.**

**모드 2 전용이다.** `targetMode`가 1인 배터리에 호출하면 `409 MODE_NOT_SUPPORTED`.

#### `POST /api/diagnosis/quick` — 빠른 진단 시작 `[REQ-WEB-138]`

```json
{ "socHintLevel": 3, "acknowledged": true }
```

- `socHintLevel` — 보조배터리 겉면 잔량 표시 단수(`1`~`4`). 모름은 `null`. 결과 비교 가능성 판정에만 쓴다
- `acknowledged` — 부하를 걸어 의도적으로 발열시킨다는 안내를 확인했다는 표시. **`true`가 아니면 `400 ACK_REQUIRED`**
- 응답 `202`: `Diagnosis` 객체(아래), `status: "RUNNING"`

| 거절 | 조건 |
|---|---|
| `409 NO_ACTIVE_SESSION` | 활성 세션 없음 (§3.1) |
| `409 MODE_NOT_SUPPORTED` | 대상 배터리의 `targetMode`가 2가 아님 |
| `409 DIAGNOSIS_IN_PROGRESS` | 이미 진행 중인 진단이 있음 |
| `409 DEVICE_OFFLINE` | 진단기 오프라인 |
| `409 RELAY_CUT` | 릴레이가 차단 상태라 부하 경로가 없음 |

#### `POST /api/diagnosis/capacity` — 정밀 용량 테스트 시작 `[REQ-WEB-139]`

```json
{ "dischargeCurrentA": 1.0, "fullyChargedConfirmed": true, "acknowledged": true }
```

- `dischargeCurrentA` — 생략하면 서버 기본값 `1.0`
- `fullyChargedConfirmed` — **`true`가 아니면 `400 FULL_CHARGE_REQUIRED`.** 시작 SOC가 100%가 아니면 결과는 SOH가 아니다(스펙 §4-1)
- `acknowledged` — 소요 시간 안내 확인
- 응답 `202`: `Diagnosis` 객체, `status: "RUNNING"`, `estimatedEndAt`
- 위 표의 거절 전부 + `409 CAPACITY_NOT_REGISTERED` — 자산에 `capacityWh`/`capacityMah`가 없어 비교할 분모가 없음

#### `GET /api/diagnosis/active` — 진행 상태 `[REQ-WEB-140]`

```json
{
  "id": "dg_01H...",
  "batteryId": "b_01H...", "batteryLabel": "PB-002",
  "sessionId": "s_01H...",
  "kind": "QUICK",
  "status": "RUNNING",
  "phase": "P3",
  "loadTargetA": 1.5,
  "loadActualA": 1.47,
  "startedAt": "2026-07-28T05:20:00.000Z",
  "estimatedEndAt": "2026-07-28T05:22:40.000Z",
  "socHintLevel": 3,
  "partialMetrics": {
    "vLightLoadV": 5.06,
    "regulationKneeA": null,
    "kneeIsUpperBound": null,
    "thermalSlopeCPerMin": 2.1,
    "specAttainmentPct": null
  }
}
```

- 진행 중인 진단이 없으면 `200`에 `null`을 준다. `404`가 아니다 — "없음"은 정상 상태다
- `phase`는 `P0`~`P6` \| `CAPACITY`. `battery-raw-metrics`의 `diag_phase`와 **같은 값**이다(스펙 §6-1)
- `partialMetrics`는 아직 확정되지 않은 지표를 `null`로 둔다. 중간값을 추정해 채우지 않는다

#### `DELETE /api/diagnosis/active` — 중단 `[REQ-WEB-141]`

- **재인증·사유를 요구하지 않는다.** 중단은 언제나 더 안전한 방향이다. (릴레이 차단·복구는 별개이며 §3.4의 게이트를 그대로 받는다.)
- 응답 `200`: `Diagnosis` 객체, `status: "ABORTED"`, `abortReason: "USER"`
- 진행 중인 진단이 없으면 `409 NO_DIAGNOSIS_IN_PROGRESS`

#### `GET /api/batteries/{id}/diagnoses` — 진단 이력 `[REQ-WEB-142]`

§1.5 목록 공통 규약을 따른다. 최신순 고정.

```json
{
  "items": [{
    "id": "dg_01H...", "kind": "CAPACITY", "status": "COMPLETED",
    "confidence": "HIGH", "measuredAt": "2026-07-28T11:40:00.000Z",
    "socHintLevel": null,
    "summary": { "sohRelPct": 89.7, "deliveredWh": 31.2 }
  }],
  "page": { "total": 4, "limit": 20, "offset": 0 }
}
```

- `summary`는 `kind`에 따라 다르다 — `QUICK`이면 `{ regulationKneeA, thermalSlopeCPerMin, grade }`, `CAPACITY`면 `{ sohRelPct, deliveredWh }`

#### `GET /api/diagnoses/{id}` — 결과 상세 `[REQ-WEB-143]`

`Diagnosis` 객체 전체를 준다. 아래가 완료된 진단의 전체 형태다.

```json
{
  "id": "dg_01H...",
  "batteryId": "b_01H...", "batteryLabel": "PB-002",
  "sessionId": "s_01H...",
  "kind": "CAPACITY",
  "status": "COMPLETED",
  "confidence": "HIGH",
  "startedAt": "2026-07-28T05:20:00.000Z",
  "measuredAt": "2026-07-28T11:40:00.000Z",
  "socHintLevel": null,
  "abortReason": null,
  "quick": null,
  "capacity": {
    "deliveredWh": 31.2,
    "ratedWh": 37.0,
    "baselineWh": 34.8,
    "sohRelPct": 89.7,
    "sohAbsPct": 95.8,
    "assumedEfficiency": 0.88,
    "dischargeCurrentA": 1.0,
    "isBaseline": false,
    "partial": false
  }
}
```

`kind: "QUICK"`이면 `capacity`가 `null`이고 `quick`이 채워진다.

```json
"quick": {
  "vLightLoadV": 5.06,
  "regulationKneeA": 1.6,
  "kneeIsUpperBound": false,
  "thermalSlopeCPerMin": 2.4,
  "specAttainmentPct": 80,
  "ratedOutputCurrentA": 2.0,
  "grade": "SUSPECT_DEGRADED"
}
```

**enum**

| 필드 | 값 |
|---|---|
| `kind` | `QUICK` \| `CAPACITY` |
| `status` | `RUNNING` \| `COMPLETED` \| `ABORTED` |
| `confidence` | `LOW`(=`QUICK` 항상) \| `HIGH`(=`CAPACITY` 완료) |
| `abortReason` | `USER` \| `TEMP_ABSOLUTE` \| `TEMP_SLOPE` \| `GAS` \| `VOLTAGE_COLLAPSE` \| `SESSION_ENDED` \| `RELAY_CUT` \| `DEVICE_OFFLINE` |
| `grade` | `HEALTHY` \| `CAUTION` \| `SUSPECT_DEGRADED` \| `BASELINE_PENDING` |

⚠️ **`grade`는 §1.7의 이상등급(`NORMAL`/`CAUTION`/`WARNING`/`DANGER`)과 다른 축이다.** 열화는 수명, 이상점수는 열폭주 위험이다. **두 값을 합산하거나 같은 enum으로 취급하지 않는다.** `CAUTION`이 양쪽에 다 있으므로 특히 주의한다.

#### 서버가 반드시 강제할 것

- **§3.3 Fail-Safe 우선순위가 진단보다 위다.** 안전 조건이 걸리면 진단 절차와 무관하게 개입하며, 그때 **부하를 0A로 내린 다음** 릴레이를 차단한다. 순서를 뒤바꾸는 경로를 만들지 않는다
- **중단·부분 결과를 SOH로 쓰지 않는다.** `partial: true`면 `sohRelPct`·`sohAbsPct`는 `null`이고 `baselineWh` 후보로도 쓰지 않는다
- **첫 정밀 테스트는 `sohRelPct: null` + `isBaseline: true`.** 기준선 자신을 100%로 내면 "열화 없음"으로 오독된다
- 세션이 끝나면(`TIMEOUT`/`SUPERSEDED`/`BLOCKED`, §4.3) 진행 중 진단을 `ABORTED`로 닫는다
- **진단 구간의 이상 알림은 억제하되 Fail-Safe는 억제하지 않는다**(스펙 §6-3)
- 문구는 만들지 않는다(§1.10). `abortReason`·`grade` 같은 code만 내려주고 문장은 프론트 사전이 조립한다

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
- **관리자 전용 WebSocket 토픽은 만들지 않는다** `[확정]`. v3 관리자 화면에 실시간 갱신 요소가 없고(전부 조회 화면), 전체 배터리를 실시간 구독하면 사용자 수만큼 팬아웃이 커진다. F15 통합 관제는 **60초 폴링**으로 충분하다.

### 5.4 서버 → 클라이언트

| type | 주기/트리거 | payload |
|---|---|---|
| `metrics.tick` | **1초** | §4.4 `metrics`와 **동일 구조** — 각 지표가 `{ value, status }`, 끝에 `measuredAt` |
| `anomaly.score` | 추론 결과 도착 시 | `{ score, grade, aeScore, informerScore, evaluatedAt }` |
| `anomaly.gradeChanged` | 등급 전이 시에만 | `{ from, to, score, batteryId, batteryLabel }` |
| `relay.changed` | 상태 변경 시 | `{ state, reason, changedBy, interlock, changedAt }` |
| `relay.autoCut` | Fail-Safe 발동 시 | `{ batteryId, batteryLabel, tempC, trigger, cutAt }` |
| `alert.created` | 새 알림 | `Alert` 객체 (§4.8) |
| `event.created` | 새 이벤트 | `Event` 객체 (§4.6) |
| `session.ended` | 세션 종료 | `{ sessionId, endReason }` — `TIMEOUT`\|`SUPERSEDED`\|`BLOCKED` (§4.3) |
| `device.status` | 진단기 상태 변경 | `{ deviceId, status, lastSeenAt }` |
| `diagnosis.progress` | 진단 단계 전환 시 | `{ id, kind, phase, loadTargetA, loadActualA, estimatedEndAt, partialMetrics }` (§4.13) |
| `diagnosis.done` | 진단 완료 | `Diagnosis` 객체 (§4.13) |
| `diagnosis.aborted` | 진단 중단 | `{ id, kind, abortReason }` — 사유 code만, 문구는 프론트 사전 |
| `pong` | `ping` 응답 | `{}` |

**중요한 설계 지점**

- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 에지는 100ms 주기로 발행하지만 `[PLAN]`, 브라우저가 초당 10프레임 상태 갱신을 감당하지 못한다. 서버가 **1초 단위로 다운샘플링**해 푸시한다.
  - **v3가 이를 뒷받침한다** — 랜딩 히어로와 로그인 모달이 각각 *"전압·전류·온도·SOC를 **1초 단위**로 수집하고"*, *"**1초 단위** 실시간 모니터링"* 이라고 사용자에게 약속한다 `[v3 실측]`. 제품 카피가 이미 1초다.
  - `CLAUDE.md`·`PLAN.md`의 100ms와 모순이 아니다: **에지→Kafka→DB 적재는 100ms, 브라우저 푸시는 1초**로 계층이 다르다. `[확정]`
- **`relay.autoCut`은 별도 타입으로 분리한다.** 프론트가 이 메시지 하나로 자동 차단 모달을 띄운다 `[REQ-WEB-064]`. `relay.changed`에 섞으면 "사용자가 직접 차단한 경우"와 구분이 안 된다.
- **`anomaly.gradeChanged`도 별도다.** 매 tick마다 등급을 비교하는 대신 서버가 전이만 알려주면, 프론트는 토스트·알림음·모달 트리거를 안전하게 걸 수 있다.
- **`diagnosis.progress`는 단계 전환에서만 보낸다.** 진단 중 실시간 측정값은 `metrics.tick`이 이미 1초마다 흘리므로 중복 푸시하지 않는다. 다만 `loadActualA`(부하 제어 실측 전류)는 `metrics.tick`에 없는 값이라 여기 싣는다 — `loadTargetA`와의 차이가 부하 제어 오차이며, 크면 결과를 신뢰할 수 없다(스펙 §7-5).

### 5.5 재연결 규약 `[제안]`

- 클라이언트는 지수 백오프로 재연결한다 (1s → 2s → 4s → … 최대 30s).
- **재연결 직후 프론트는 `GET /api/dashboard`를 다시 호출해 스냅샷을 맞춘다.** WebSocket은 누락된 메시지를 재전송하지 않는다.
- 서버는 순단 중 발생한 이벤트를 큐에 쌓아두지 않아도 된다. 상태 동기화는 스냅샷 재조회로 해결한다.

> v3 공지 본문에 *"WebSocket 순단이 발생할 수 있으나 자동 재연결되며, 측정 데이터는 버퍼링 후 복원됩니다"* 라는 문장이 있다 `[v3]`. **데이터 버퍼링은 에지→Kafka 구간의 이야기이며, WebSocket 재전송 보장을 뜻하지 않는다.** 혼동 주의.

---

## 6. 화면 ↔ 엔드포인트 매핑

| # | 영역 | 라우트 | 필요한 엔드포인트 |
|---|---|---|---|
| — | 앱 셸 (전 화면 공통) | — | `GET /api/me` (부팅 시 1회), WS `subscribe` |
| F1 | 랜딩 | `landing` | 없음 (정적) |
| F2 | 회원가입 | `signup` | `/api/auth/*` |
| F3 | 계정 찾기 | `find` | `/api/auth/*` |
| F4 | 실시간 관제 | `dashboard` | `GET /api/dashboard`, WS `metrics.tick`·`anomaly.score`·`relay.*`·`session.ended` |
| F6 | 배터리 자산관리 | `battery` | `GET/POST/PATCH /api/batteries`, `POST /api/sessions` |
| F7 | 배터리 상세·이력 | `batteryDetail` | `GET /api/batteries/{id}`, `/sessions`, `GET /api/trends?batteryIds={id}` |
| F8 | 이상 탐지 | `anomaly` | `GET /api/anomaly/summary`(위험도 분포 포함), `/evidence`, `/events` |
| F9 | 추세 | `trend` | `GET /api/trends`, `/trends/export` |
| F10 | 이벤트 이력 | `events` | `GET /api/events` |
| F11 | 알림 센터 | `alertHistory` | `GET /api/alerts`, `/alerts/summary`, `POST /ack`, `/ack-all` |
| F12 | 릴레이 제어 | `relay` | `GET /api/relay`, `/history`, `POST /cut`, `/restore` |
| F13 | 공지사항 | `notices` | `GET /api/notices`, `GET /api/notices/{id}` |
| F14 | 설정 | `settings` | `/api/settings/alerts`, `/preferences`, `/voice-alert`, `PATCH /api/me`, `POST /api/me/password` |
| F15 | 관리자 통합 관제 | `admin` | `GET /api/admin/overview` |
| F16 | 유저 계정 관리 | `adminUsers` | `/api/admin/users/*` |
| F17 | 배터리 운영 관리 | `adminBattery` | `/api/admin/batteries/*` |
| F18 | 공지사항 관리 | `adminNotice` | `/api/admin/notices/*` |
| F19 | 감사 로그 | `adminAudit` | `GET /api/admin/audit-logs` |
| F20 | 이벤트 추이 | `adminEventTrend` | `GET /api/admin/event-trend` |
| F21 | 보조배터리 진단 | `powerbankDiag` | `POST /api/diagnosis/quick`·`/capacity`, `GET`/`DELETE /api/diagnosis/active`, `GET /api/batteries/{id}/diagnoses`, `GET /api/diagnoses/{id}`, WS `diagnosis.*` (§4.13) |

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

**백엔드가 스텁 응답을 먼저 배포한다** `[확정]`.

- 이 문서의 예시 JSON을 그대로 반환하는 핸들러를 실제 경로에 올린다. 로직은 나중에 채운다.
- 이유: 프론트가 MSW로 목을 따로 만들면 **경로·필드명 오타가 통합 시점까지 안 잡힌다.** 스텁을 먼저 올리면 그날 잡힌다.
- 우선순위는 §7을 따른다. 1순위 3개(`/api/me`, `/api/batteries`, `POST /api/sessions`)만 있어도 프론트가 게이트→목록→연결 흐름을 붙일 수 있다.

---

## 9. 미결정 항목

**37건 중 32건 확정, 1건 보류, 4건 열림. 열린 4건 모두 착수를 막지 않는다.**

| # | 항목 | 상태 |
|---|---|---|
| **Q27** | 전압·전류·SOC 지표 배지 임계값 | **열림** — 온도(55/60°C)만 확정. 나머지는 `status: null`이라 대시보드 구현은 진행 가능. 전압은 `chemistry`·`seriesCount`로 셀당 환산 필요 |
| **Q35** | 세션 타임아웃 임계 N분 | **열림** — 5분 제안. 에지 발행이 100ms이므로 5분 무수신이면 전원 이탈로 본다. 현장 테스트로 확정 |
| **Q34** | 문구 `code` 전체 목록 | **열림** — §1.10 규약은 확정. 개별 코드는 엔드포인트 구현하며 채운다 |
| **Q36** | F21 진단 문턱값 | **열림** — 발열 기울기 `S1`, 표면온도 중단 문턱, 부스트 효율 η 기본값, 최소 유지 부하 크기. `mode2_powerbank_diagnosis_spec.md` §8 H2~H4·H6~H10. **부하 수단(보유 BW150)과 릴레이 매핑(모드 1과 동일)은 2026-07-28에 닫혔다.** **API 계약(§4.13)은 이와 무관하게 확정**이다. BW150의 5V 부하 가능 여부도 제조사 사양표(`DC1V~200V`)로 통과해 **회로도를 막는 항목은 없다** |
| **Q6** | SOH/RUL 산출 주체 | **모드 2 확정 / 모드 1 보류** — 모드 2는 백엔드가 §4.13 진단 결과를 집계하고 `cycleCount`·`rulCycles`·`internalResistanceMohm`은 `null` 확정(§4.2). 모드 1은 BQ27441 경로가 있으나 산출 주체 미정이라 보류 유지 |

### 확정된 결정 (31건)

| # | 항목 | 결정 |
|---|---|---|
| Q1 | CSRF | Better Auth `trustedOrigins` Origin 검증. **별도 토큰 없음**. 커스텀 라우트에 동일 미들웨어 적용 |
| Q2 | 다국어 | **서버는 code+params만.** 문구는 프론트 사전(ko/en). 사용자 입력 자유 텍스트만 예외 (§1.10) |
| Q3 | 점수 스케일 | `score` 0.0–1.0 단일. 0–100 변환은 프론트 |
| Q4 | `label` 유일성 | 중복 허용 (`PLAN.md:123,131`) |
| Q5 | 감사 로그 보존 | **무기한.** 삭제·아카이브 배치 없음 |
| Q7 | 진단기 대수 | **계정당 1대.** `deviceId` 파라미터 없음, 서버 자동 선택 |
| Q8 | 온도 상한 설정 | 임계치 설정 기능 제거로 소멸 |
| Q9 | CSV/PDF | **동기 다운로드.** 집계 버킷만 내보내므로 비동기 불필요 |
| Q10 | 추세 집계 | 24h=1시간/7d=1일/30d=1일. 온도·점수 `max`, 전압·전류·SOC `avg` |
| Q11 | 공지 `body` | 목록은 `summary`(120자), 상세는 `GET /{id}` |
| Q12 | 릴레이 자동 복구 | **없음. 수동 복구만** (재인증·사유 필수) |
| Q13 | 릴레이 경로 | `POST /api/relay/cut`으로 통일. 기존 `/kill-switch/confirm` 스텁 교체 |
| Q14 | 캘리브레이션 | **범위 제외.** API·화면 모두 삭제 |
| Q15 | 계정 정지 시 세션 | **유지.** 로그인만 차단 (§3.7) |
| Q16 | `BLOCKED` 효과 | 측정 시작 차단 + 진행 세션 종료. **릴레이는 안 건드림** |
| Q17 | 공지 `audience` | `ALL`/`USER`/`ADMIN` |
| Q18 | 공지 조회수 | 상세 조회 시 +1, 동일 사용자 24h 중복 제외 |
| Q19 | 관리자 WS | **없음.** F15는 60초 폴링 |
| Q20 | 수집 주기 | 적재 100ms / 브라우저 푸시 1초 |
| Q21 | 목 서버 | **백엔드가 스텁 먼저 배포** |
| Q22 | `cellIndex` | 셀 단위 측정 안 함 → 전면 제거 |
| Q23 | `maker`/`model` | 계약 유지, 프론트가 폼에 입력 추가 |
| Q24 | 지표 배지 | 서버가 고정 임계값으로 판정, `metrics.*.status` |
| Q25 | XAI 기여도 | 0 이상 실수, 합 제약 없음 |
| Q26 | `측정 담당자` | 표기 제거. `jobTitle` 없음 |
| Q28 | `role` 변경 | **웹에서 불가.** DB·스크립트로만 |
| Q29 | 관리자 비번 재설정 | **재설정 링크 발송.** 관리자가 평문을 알 수 없음 |
| Q30 | `targetMode` 수정 | 불가. 새 자산으로 등록 |
| Q31 | `info.location` | 삭제(저장 경로 없음). `info.device`는 유지 |
| Q32 | 캘리브레이션 범위 | Q14로 소멸 |
| Q33 | 세션 종료 | **사용자 종료 버튼 없음.** 타임아웃 / 다른 배터리 연결 / BLOCKED |

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

기능정의서 2종은 2026-07-22 커밋 `9bb6d8e`로 v3 기준에 맞춰졌고, 이상점수 스케일·4등급·게이지 범례 버그는 **이미 반영돼 있다**(계약서 §1.6과 일치). 다만 개별 기능의 **화면 위치**는 아직 어긋난 것이 있다. 브라우저로 확인한 차이는 아래와 같으며, **이 계약서는 전부 v3를 따랐다.**

### 위치가 다른 것

| 요구사항 | 문서가 말하는 위치 | 실제 v3 위치 |
|---|---|---|
| REQ-WEB-025 위험도 분포 | (화면 미지정) | **이상 탐지 화면** — 계약서가 명시 |
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
| REQ-WEB-071 캘리브레이션 이력 | 조회 화면만, 등록 수단 없음 | **제외**(Q14) — 화면도 제거 |
| 임계치 설정 | 라벨만 있고 미렌더링 | **제외** (기능 자체가 제거됨) |
| 셀 온도 히트맵 | 렌더링됨 | **제외** (쓰지 않기로 결정) |

### 입력 항목이 다른 것

| 요구사항 | 문서 | 실제 v3 폼 |
|---|---|---|
| REQ-WEB-037 배터리 등록 | 이름·종류·모드·직렬 셀 수·**제조사/모델** | 이름·종류·모드·직렬 셀 수 **4개뿐** |

### 입력 항목이 누락된 것 (계약서 쪽 오류였음)

| 항목 | 내용 |
|---|---|
| REQ-WEB-038 배터리 수정 | v3 수정 모달에 **`메모`** 입력이 있고 `PLAN.md:136`에도 정의돼 있는데 계약 초안이 빠뜨렸다 → §4.2에 추가 |

### 문서에 없는데 v3에 있는 것

- **알림 센터 "오늘의 알림 요약"** 카드 (위험/경고/정상·점검 3칸)
- **관리자 대시보드 모드별 배터리 분포** (모드 1/2)
- **대시보드 지표별 상태 배지** (전압·전류·온도·SOC 각각 정상/경고)
- **Raw 데이터 보기 모달** (v3 신규, `rawModal`)

---

## 12. 프론트엔드 작업 목록 — 계약과 v3를 맞추려면

백엔드와 무관하게 **프론트가 고쳐야 하는 것들**이다. 실측 중 발견했다.

| # | 항목 | 이유 |
|---|---|---|
| 1 | 등급 판정 로직 3곳을 4등급으로 통일 | 대시보드 `dScoreLabel`, 게이지 범례, 관리자 목록 `scCol`이 전부 3등급(70/40) |
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
| 15 | 유저 수정 모달의 `등록 배터리 수`를 읽기 전용으로 | 파생값인데 v3가 편집 가능한 입력으로 그림. 서버는 이 필드를 받지 않는다 |
| 16 | 유저 수정 모달에서 `권한` 셀렉트 **제거**, `상태` 편집 분리 | Q28. 권한은 웹에서 변경 불가(DB로만). 상태는 정지/해제 버튼(사유 필수)으로만 |
| 17 | 배터리 수정 모달의 `메모`를 계약 `memo`에 연결 | 관리자 메모와 다른 필드임에 주의 |
| 18 | ~~측정 종료 버튼 추가~~ **불필요** | Q33. 종료는 서버가 타임아웃으로 처리. 대신 `session.ended` WS 수신 시 게이트 화면으로 복귀하는 처리 필요 |
| 19 | `릴레이 자동 복구` 이벤트·알림·제어 이력 삭제 | Q12. 자동 복구를 하지 않기로 함 |
| 20 | 유저 수정 모달의 `새 비밀번호` 입력 → `재설정 메일 보내기` 버튼 | Q29. 관리자가 평문을 지정하지 않음 |
| 21 | 설정에서 `센서 캘리브레이션 이력` 섹션 제거 + 탭 이름을 `테마 · 캘리브레이션` → `테마`로 | Q14. 범위 제외 |
| 22 | 배터리 수정 모달에서 `측정 모드` 선택 비활성화 | Q30. 자산 고정값이라 변경 불가 |
| 23 | 지표 배지를 온도 카드에만 표시 | Q27. 전압·전류·SOC는 `status: null` |
| 24 | 한/영 사전 구축 (code → 문구, ko/en 2벌) | Q2. 서버가 문구를 만들지 않음 (§1.10) |
| 25 | 공지 목록 클릭 시 `GET /api/notices/{id}` 호출 추가 | Q11. 목록은 `summary`만 |
