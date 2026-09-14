# 셀가드 백엔드 API 계약서 (REST + WebSocket)

> **이 문서는 프론트엔드가 백엔드에 요구하는 인터페이스 계약이다.**
> 백엔드 내부 구현(DB 스키마, Kafka 컨슈머 설계, 인덱스 전략)은 이 문서의 범위가 아니다.
> 다만 **§3 도메인 불변식**은 구현 방식과 무관하게 반드시 지켜져야 한다.

| 항목 | 값 |
|---|---|
| 작성일 / 최종 검증일 | 2026-08-06 |
| 근거 기준 | `설계 산출물/셀가드 프로토타입_v3.html`, `docs/feature_definition.md`(REQ-WEB-001~073, 069 결번), `docs/admin_feature_definition.md`(REQ-WEB-101~136), `PLAN.md` |
| 검증 방법 | v3 번들 소스 복원·정적 대조 + 로컬 HTTP 실행 + **Codex 인앱 브라우저 직접 입력·선택·모달·화면 전환 검증**(2026-08-06) |
| 검증 대상 SHA-256 | `454a4104cee628b47425b11f4cf9cc7b5f75d6947a43b30a8f4a2a98786ce3e2` (`설계 산출물/셀가드 프로토타입_v3.html`) |
| 대상 화면 | 20개 영역 (공개 3 · 일반 사용자 11 · 관리자 6) |

> **관련 문서**: `docs/product_contract.md`(디자인 무관 제품 계약서)가 같은 v3를 근거로 **과업 플로우 T0~T16**을 기술한다. 이 문서는 그 플로우를 지탱하는 **API 인터페이스**를 정의한다. 둘이 충돌하면 화면·플로우는 `product_contract.md`, 요청/응답 스키마는 이 문서가 우선한다.

> **기능정의서와의 관계**: 2026-08-06 검증에서 모드·필드·동기화·Raw CSV·릴레이 승인 규칙을 연관 정본과 함께 갱신했다. 남은 의도적 제외·미구현은 §11~12에만 기록한다.

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
| 422 | `REASON_REQUIRED` | `/relay/cut`·`/restore`, `/users/{id}/suspend`·`/restore`, `/batteries/{id}/ops-status`(모든 실제 상태 전환) |
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

> **v3 동기화 상태(2026-08-05):** Raw 데이터 화면도 `anomaly_score: 0.82`를 표시하도록 수정했다.

**등급 정의** `[PLAN]`

| grade | 한국어 | score 범위 |
|---|---|---|
| `NORMAL` | 정상 | 0.0 ≤ s < 0.3 |
| `CAUTION` | 주의 | 0.3 ≤ s < 0.6 |
| `WARNING` | 경고 | 0.6 ≤ s < 0.8 |
| `DANGER` | 위험 | 0.8 ≤ s ≤ 1.0 |

**v3 프로토타입 과거 버그 기록 — 2026-08-05 수정 완료**

v3에 흩어져 있던 표시 로직은 아래처럼 하나의 4등급 규칙으로 맞췄다.

| 위치 | 로직 | 등급 수 |
|---|---|---|
| 랜딩 게이지 (`scoreLabel` 계산) | `≥80 위험 / ≥60 경고 / ≥30 주의` | 4등급 — **정상** |
| 대시보드 (`dScoreLabel` 계산) | `≥80 위험 / ≥60 경고 / ≥30 주의` | 4등급 — 수정 완료 |
| 게이지 범례 | `정상 0–29 / 주의 30–59 / 경고 60–79 / 위험 80+` | 4등급 — 수정 완료 |
| 관리자 배터리 목록 (`scCol` 계산) | `≥80 / ≥60 / ≥30` | 4등급 — 수정 완료 |

계약은 **4등급(0.3/0.6/0.8)** 하나뿐이다. 실제 제품에서는 서버가 내려준 `grade`만 판정 정본으로 사용한다.

**브라우저 재검증 (2026-08-06)**

- 대시보드·게이지 범례·관리자 배터리 목록이 모두 `정상 0–29 / 주의 30–59 / 경고 60–79 / 위험 80+`를 사용한다.
- 위험 점수만으로 자동 차단 통보가 열리지 않고, 서버 `relay.autoCut` 이벤트가 있어야만 열리는 것을 확인했다.

> 위 표는 회귀 방지 기록이다. 구현은 서버 `grade`를 정본으로 사용하고 프론트 임계 비교는 목업 표시 외에는 사용하지 않는다.

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
| 측정 단계 | `WAITING_FOR_MEASUREMENT` `MEASURING` `[제안]` — 세션 상태와 별개로, 세션 시작 이후 센서 프레임 수신 여부를 나타낸다 |
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
| `representativeTempC` | °C — 유효한 `tempContact.value`, `tempIrSurface.value` 중 큰 값 |
| `gasRaw`, `pressureRaw`, `acousticRaw` | ADC raw (무차원 정수) |
| `dTdt` | °C/min `[v3: '+2.8 °C/min']` |

**측정 필드 정본 규칙** `[확정 2026-08-05]`

- `currentA`와 `powerW`는 **양수=충전, 음수=방전, 0=대기**인 signed 값이다. 저장·AI·API는 부호를 보존하고, 화면만 절댓값과 `CHARGING`/`DISCHARGING`/`IDLE` 방향 라벨을 함께 표시한다.
- 대표 온도는 서버가 유효한 non-null 접촉/IR 값 중 큰 값으로 계산한다. 둘 다 null이면 `representativeTempC.value=null`; 선택 소스는 `representativeTempSource=CONTACT|IR_SURFACE|null`이다. 에지 Raw에는 합성 `temp_c`를 추가하지 않는다.
- 모드 1은 두 온도 소스를 사용할 수 있고, 모드 2는 `tempContact=null`, IR 표면 온도만 사용한다.
- 모드 2 SOC는 `socBasis=RELATIVE_SESSION_START`, 세션 시작을 100%로 잡은 상대 SOC다. 모드 1은 `socBasis=ABSOLUTE_GAUGE`. 기준을 만들 수 없으면 `socPct=null`이며 다른 세션·모드의 값을 재사용하지 않는다.
- 각 지표는 `ageMs`와 `freshness=FRESH|STALE`를 가진다. stale 값은 마지막 수치를 표시할 수 있으나 AI 입력과 실시간 임계 판정에서 제외한다. `ageMs`는 발행 시각과 실제 측정 시각의 차이며 필드·하드웨어 프로필별 `maxAgeMs`를 적용한다.

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

> 프론트는 `code → 문구 템플릿` 사전을 ko/en 두 벌 관리한다. 현재 HTTP 구현이 사용하는 공통 code는 `UNAUTHENTICATED`, `FORBIDDEN`, `ACCOUNT_SUSPENDED`, `VALIDATION_FAILED`, `NOT_FOUND`, `BATTERY_BLOCKED`, `NO_ACTIVE_SESSION`, `NO_STATUS_CHANGE`, `REASON_REQUIRED`, `INPUT_TOO_LONG`, `VERSION_CONFLICT`, `SELF_SUSPEND_FORBIDDEN`, `REAUTH_REQUIRED`, `INTERLOCK_LOCKED`, `MODE_NOT_SUPPORTED`, `SAFETY_PROFILE_NOT_READY`, `DIAGNOSIS_IN_PROGRESS`, `NO_DIAGNOSIS_IN_PROGRESS`, `ACK_REQUIRED`, `FULL_CHARGE_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `BATTERY_NAME_REQUIRED`, `CAPACITY_REQUIRED`, `RATED_CURRENT_REQUIRED`, `RUNTIME_NOT_READY`다. 새 code는 이 목록과 프론트 사전에 함께 추가한다 `[Q34 확정]`.


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

- **설비 전체에 `ACTIVE` 상태 `measurement_session`은 최대 1개다(2026-08-28 확정).** 진단기가 여러 대여도 동시에 활성인 세션은 하나뿐이다. 근거는 하드웨어다 — BQ27441(0x55)은 I2C 주소가 하드웨어 고정이라 한 번에 배터리 1개만 측정할 수 있다(CLAUDE.md).
  - **DB가 이것을 강제한다**: `uq_active_session_global`(`backend/migrations/002_domain_gaps.sql`) — `measurement_session (status) where status = 'ACTIVE'`. 001의 per-device 제약(`uq_active_session_device`)은 이 결정으로 교체됐다.
  - ⚠️ **계약 테스트 20건은 per-device와 전역을 구분하지 못한다**(`backend/src/store/contract.test.ts:31-40`이 같은 사용자·같은 진단기로만 `startSession`을 두 번 부른다). 저장소 구현체가 어느 쪽으로 짜였는지는 테스트가 아니라 DB 제약이 잡는다.
- 새 배터리 연결 요청 시 서버가 **기존 활성 세션을 원자적으로 종료하고** 새 세션을 연다. 프론트가 "종료 → 시작" 2콜로 나누지 않는다(중간 실패 시 무세션 상태로 빠짐).
- 모드 인터락: 새 세션의 `targetMode`가 이전과 다르면 **이전 모드 릴레이를 먼저 차단**한 뒤 전환한다. `[PLAN: S-LWVJRY]`

> **사용자당 진단기는 1대로 확정됐다.** 따라서 전역 1세션 = **사용자당 1세션**이 되어 두 규칙이 실질적으로 같다. `GET /api/me`의 `activeSession`은 단수로 유지하고, 진단기 선택 UI도 만들지 않는다.
> 나중에 여러 대를 지원하려면 `activeSession` → `activeSessions[]` 배열화와 진단기 선택 UI가 필요하다. 그때까지 **`deviceId`를 응답에 포함시켜 두면** 확장 시 프론트 변경 범위가 줄어든다.

### 3.3 Fail-Safe 우선순위 `[v3]` `[PLAN: S-VMNNAM]`

*"Fail-Safe 인터락은 사용자 조작보다 우선합니다."* `[v3: T.failsafeNote]`

- **자동 차단은 서버가 확정한 Fail-Safe 이벤트만** 발생시킨다. AI 점수·등급, 카드 색상, 프론트 온도 비교는 자동 차단·자동 차단 모달을 열 수 없다.
- 현재 지원 trigger code는 `FAILSAFE_TEMP_CONTACT_OVER_CAP`, `FAILSAFE_TEMP_IR_OVER_CAP`, `FAILSAFE_TEMP_RISE_RATE`, `FAILSAFE_GAS_OVER_THRESHOLD`, `FAILSAFE_PRESSURE_RISE`, `FAILSAFE_ACOUSTIC_OVER_THRESHOLD`다. 해당 센서가 없는 하드웨어 프로필의 코드는 발생시키지 않는다.
- 가스·압력·음향 임계 초과 또는 온도 상한/상승률 초과 시, **AI 판정과 무관하게** 즉시 릴레이 차단한다. `[PLAN]`
- 인터락이 걸린 상태에서 사용자의 릴레이 복구 요청은 `409 INTERLOCK_LOCKED`.
- 자동 차단이 발생하면 `relay.autoCut`을 즉시 푸시한다. 프론트는 **이 타입을 수신했을 때만** trigger code와 대표 온도를 포함한 자동 차단 모달을 띄운다.

### 3.4 위험 제어 승인 절차 `[v3]` `[REQ-WEB-062/063]`

*"이 조작은 사유 입력과 재인증을 요구하며, 승인자·시간·IP가 감사 추적에 기록됩니다."* `[v3: T.rmNote]`

여기서 승인은 관리자 사람의 수동 승인이 아니라 **서버 자동 승인**이다. 소유자 `USER` 또는 `ADMIN`이 사유와 본인 비밀번호를 한 번의 요청으로 제출하면 서버가 즉시 승인/거부한다.

- `reason` 누락 → `422 REASON_REQUIRED`
- `password` 불일치 → `401 REAUTH_REQUIRED`
- 서버는 인증·소유권·권한·활성 세션·디바이스 온라인·현재 릴레이 상태·복구 인터락을 모두 검증한 뒤에만 하드웨어 명령을 실행한다.
- 승인 전에는 릴레이 상태, interlock, 감사 로그를 변경하지 않는다. 승인 후 명령 실행과 감사 기록을 원자적으로 처리하고 실패 시 성공 응답이나 성공 이벤트를 내보내지 않는다.
- 모든 요청은 `Idempotency-Key` 헤더가 필수다. 같은 키·같은 본문은 같은 결과를 반환하고, 같은 키·다른 본문은 `409 IDEMPOTENCY_CONFLICT`다.
- 성공 응답은 `decision: "APPROVED"`, `requestId`, 갱신 릴레이 객체를 포함한다. 정책 거부 응답은 에러 code와 `decision: "REJECTED"`를 포함한다.
- 성공 시 감사 로그에 `{ actorId, action, targetId, reason, requestId, ip, userAgent, at }`를 기록한다.

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
| `BATTERY_OPS_STATUS_CHANGE` | battery | 모든 실제 상태 전환 시 ✅ `[REQ-WEB-125]` |
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

Raw Consumer는 `UNASSIGNED_DATA`를 별도 테이블이 아닌 기존 `audit_log`에
`resource=device_id`, `result=SUCCESS`, `reason=NO_ACTIVE_SESSION|MODE_MISMATCH`로
남긴다. 같은 장치·같은 미배정 사유가 이어지는 동안에는 첫 row만 기록하고,
배정 상태를 거친 뒤 또는 사유가 바뀐 뒤의 첫 row에서만 다시 기록한다. 따라서
100ms 프레임마다 감사 로그를 무한히 만들지 않으면서 재시작 후에도 전이를
확인할 수 있다. 이벤트 broadcast는 `event.created`로 전달하며, 이 이벤트의
`batteryId`는 null이다. 현재 active session이 같은 device를 가리킬 때만
그 소유자 stream으로 live broadcast하고, 그 외에는 durable audit row가
source of truth다. `occurredAt`은 audit row의 PostgreSQL `created_at`이고,
edge `measuredAt`은 별도 원인 파라미터로만 보존한다.

등록 device liveness는 telemetry natural-key INSERT가 신규 row를 반환한
경우에만 수행한다. 이 UPDATE는 telemetry/latest/audit INSERT와 같은
transaction에서 PostgreSQL `clock_timestamp()`를 사용해 `last_seen_at`을
monotonic하게 전진시키며, duplicate replay는 `OFFLINE` 장치를 되살리거나
시각을 갱신하지 않는다. 미등록 device는 row를 만들지 않고 telemetry를
미배정으로 보존한다.

## 4. REST API

### 4.1 세션 · 내 정보

#### `GET /api/me` — 앱 부팅 시 1회

앱 셸이 렌더링되기 전에 필요한 모든 것을 한 번에 준다. `[제안]`

```json
{
  "user": {
    "id": "u_01H...",
    "name": "홍길동",
    "loginId": "hong",
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
    "startedAt": "2026-07-22T05:12:00.000Z",
    "measurementPhase": "MEASURING"
  },
  "unreadAlertCount": 2,
  "activeAnomalyCount": 9,
  "preferences": { "theme": "light", "lang": "ko" }
}
```

- `activeSession`이 `null`이면 프론트는 **§3.1 게이트 모드**로 진입한다.
- `activeSession.measurementPhase`는 서버가 `battery.latest.measuredAt`와 `startedAt`을 비교해 계산한다. `measuredAt`이 세션 시작 시각보다 **엄격히 이후**인 센서 프레임이 아직 없으면 `WAITING_FOR_MEASUREMENT`(장비 연결 대기), 그런 프레임이 있으면 `MEASURING`(연결됨 · 측정 중)이다. 활성 세션 생성 자체나 이전 세션의 측정값은 측정 증거가 아니다. 따라서 사용자 UI와 측정 목적지 게이트는 `MEASURING`일 때만 연결 완료로 취급한다.
- `unreadAlertCount` → 사이드바 `알림 센터` 배지 `[v3: badge '2']`
- `activeAnomalyCount` → 사이드바 `이상 탐지` 배지 `[v3: badge '9']`

**사용자 프로필 정본과 표시 필드**

- `GET /api/me.user`의 `id`, `name`, `loginId`, `email`, `phone`, `role`, `status`가 로그인 사용자 프로필의 정본이다. 앱 셸, 설정 화면, 알림·감사 표시의 사용자 이름은 이 객체의 `name`을 사용한다.
- 관리자 목록의 `items[].name`과 관리자 상세의 사용자 `name`은 같은 `user.name`을 내려주는 조회용 투영이다. `loginId`는 로그인 식별자이고 표시 이름의 대체값이 아니다.
- 별도의 `displayName`, `profileLabel`, `adminName` 같은 중복 필드를 만들지 않는다. 화면의 한국어 레이블(예: `이름`, `사용자명`)은 API 필드 `name` 하나에 매핑한다.

#### 인증·가입·계정 찾기 입력 계약 `[v3 확정 2026-08-05]`

| 화면 입력/선택 | 요청 |
|---|---|
| 로그인 이메일·비밀번호 | Better Auth `POST /api/auth/sign-in/email` |
| 가입 이름·전화·이메일·비밀번호·필수약관 동의 | Better Auth 가입 요청 + `termsVersion`, `privacyVersion`, `acceptedAt` 서버 기록 |
| 이메일 중복확인 | `POST /api/account/email-availability` `{ "email": "..." }` → `{ "available": true }` |
| 비밀번호 재설정 이메일 | Better Auth forgot-password. 존재 여부를 노출하지 않는 동일 성공 문구 사용 |
| 이메일 찾기 이름·전화 | `POST /api/account/email-lookup` → 일치해도 마스킹 이메일만 반환 |

두 계정 확인 엔드포인트는 Origin 검증·rate limit·감사 보안 이벤트를 적용한다. 이메일 찾기는 불일치와 존재 계정을 구별 가능한 상태코드/응답시간으로 노출하지 않는다.

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
      "representativeTempC": 58.0,
      "representativeTempSource": "CONTACT",
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
  "chemistry": "LI_PO",
  "seriesCount": null,
  "targetMode": 2,
  "maker": "Samsung SDI",
  "model": "18650",
  "capacityWh": 37.0,
  "ratedOutputCurrentA": 2.0,
  "memo": "측정 대상 특이사항…"
}
```

- `label` **필수**, 중복 허용 `[PLAN]`
- `chemistry` **필수** `[PLAN]`
- `targetMode` **필수** — 재연결 시 모드 재선택을 없애기 위해 배터리에 고정된다 `[PLAN]`
- `seriesCount` / `maker` / `model` / `memo`는 선택이다. 용량은 `capacityWh`를 우선하고, `capacityMah`를 받을 때는 공칭전압도 함께 저장해 Wh로 환산한다.
- **`targetMode=2`이면 `capacityWh` 또는 환산 가능한 `capacityMah`가 필수**다. 둘 다 없으면 `422 CAPACITY_REQUIRED`. v3의 `정격 용량(Wh)` 입력은 `capacityWh`에 매핑한다.
- **`targetMode=2`이면 `ratedOutputCurrentA`도 필수**다. 0 이하·누락이면 `422 RATED_CURRENT_REQUIRED`; v3 등록 폼의 광고 정격 출력 전류 입력에 매핑한다 `[Q37 확정]`.
- 201 응답 본문은 생성된 배터리 객체 전체 (프론트가 목록에 즉시 삽입)

> **`memo`는 사용자 메모다.** v3 **배터리 수정** 모달에 `메모`(placeholder `측정 대상 특이사항…`) 입력이 있고 `PLAN.md:136`에도 선택 필드로 정의돼 있다 `[v3]` `[PLAN]`.
> **관리자 메모(`REQ-WEB-124`, §4.12)와 완전히 다른 필드다.** 관리자 메모는 `battery_asset.admin_memo`이며 사용자에게 보이지 않는다 `[PLAN.md:280]`. 두 필드를 같은 컬럼에 합치지 말 것.

#### `PATCH /api/batteries/{id}` `[REQ-WEB-038]`

`POST`와 동일한 필드를 부분 수정한다. **단 `targetMode`는 변경 불가** `[확정]` — 재연결 시 모드 재선택을 없애려고 자산에 고정한 값이다 `[PLAN]`. 오등록을 정정하려면 자산을 새로 등록한다(이전 측정 이력은 옛 자산에 남는다).
`targetMode`가 요청에 오면 `400 VALIDATION_FAILED`. **프론트는 수정 모달에서 측정 모드 선택을 비활성화해야 한다**(§12-22).

- `maker` / `model` **선택** — 카드·상세의 `18650 Li-ion · 3S` 표시에 쓴다.

> **v3 동기화 상태(2026-08-05):** 등록·수정 화면에 `제조사`·`모델` 실제 입력을 추가했다. 둘 다 선택 입력이므로 미입력 시 카드 표시는 `리튬이온 · 3S`로 축약한다. 모드 2 등록에는 상대 SOC 기준을 위한 정격 용량 입력도 제공한다.

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
    "voltageV": 11.9, "currentA": -2.4,
    "representativeTempC": 58.0, "representativeTempSource": "CONTACT",
    "socPct": 78, "socBasis": "ABSOLUTE_GAUGE",
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
  **모드 1도 백엔드가 산출한다** `[Q6 확정]` — BQ27441 원시/집계값을 백엔드가 계산해 `sohPct`, `rulCycles`, `cycleCount`, `internalResistanceMohm`을 내려준다. 입력이 없거나 stale이면 `health: null`이다.
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
  "mode": 1, "status": "ACTIVE", "startedAt": "...",
  "measurementPhase": "WAITING_FOR_MEASUREMENT"
}
```

`measurementPhase`는 활성 세션 생성만으로 `MEASURING`이 되지 않는다. 서버는 장비 ACK를 추정하지 않고, 해당 세션의 `startedAt` 이후에 저장된 센서 측정 시각이 있을 때만 `MEASURING`으로 바꾼다. `GET /api/batteries`와 `GET /api/batteries/{id}`의 `isConnected`도 같은 규칙을 따르며, 대기 세션에서는 `false`다. `POST /api/sessions`가 `201`과 `WAITING_FOR_MEASUREMENT`를 반환하면 프론트는 대기·실패·재시도 상태를 보여 주고 측정 목적지를 열지 않는다.

- 대상 배터리의 진단기가 오프라인이면 `409 DEVICE_OFFLINE`.
- 대상 배터리의 운영 상태가 `BLOCKED`이면 `409 BATTERY_BLOCKED` (§4.12).

#### 측정 세션 종료 — **사용자 조작 엔드포인트 없음**

`DELETE /api/sessions/{id}`를 **만들지 않는다.** v3에 "측정 종료"·"연결 해제" 버튼이 0건이며 `[v3 실측]`, 프론트도 추가하지 않는다. 세션은 아래 세 경우에 **서버가** 닫는다.

| 트리거 | 동작 | 종료 사유(`endReason`) |
|---|---|---|
| **데이터 미수신 타임아웃** | `battery-raw-metrics` 무수신이 N분 지속되면 자동 종료 | `TIMEOUT` |
| 다른 배터리 연결 | `POST /api/sessions`가 기존 세션을 원자적으로 종료 (§3.2) | `SUPERSEDED` |
| 배터리 `BLOCKED` 전환 | 관리자가 운영 상태를 BLOCKED로 바꾸면 진행 중 세션 종료 (§4.12) | `BLOCKED` |

- 타임아웃 임계 N은 **5분으로 확정**한다. 에지 발행 주기가 100ms이므로 5분 무수신이면 전원이 나갔거나 배터리를 분리한 상태다 `[Q35]`.
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
  "session": { "id": "s_01H...", "batteryId": "b_01H...", "batteryLabel": "PACK-001", "mode": 1, "startedAt": "...", "measurementPhase": "MEASURING" },
  "metrics": {
    "voltageV":     { "value": 11.9, "status": "OK" },
    "currentA":     { "value": 2.4,  "status": "OK" },
    "powerW":       { "value": 28.5, "status": "OK" },
    "tempContact":  { "value": 58.0, "status": "WARN" },
    "tempIrSurface":{ "value": 59.2, "status": "WARN" },
    "representativeTempC": { "value": 59.2, "source": "IR_SURFACE", "status": "WARN" },
    "socPct":       { "value": 78,   "status": "OK" },
    "socBasis": "ABSOLUTE_GAUGE",
    "measuredAt": "2026-07-22T14:32:10.000Z"
  },
  "anomaly": {
    "score": 0.82, "grade": "DANGER",
    "aeScore": 0.79, "informerScore": 0.86,
    "evaluatedAt": "..."
  },
  "relay": { "state": "OPEN", "reasonCode": "FAILSAFE_TEMP_IR_OVER_CAP", "changedAt": "..." },
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
| `tempContact`, `tempIrSurface`, `representativeTempC` | ≥ 55°C | ≥ 60°C | 서버 표시 상태 정책. 프론트는 비교하지 않으며 이 상태로 자동 차단하지 않는다 |
| `voltageV`, `currentA`, `socPct`, `powerW` | — | — | **임계값 미설정 → `status: null`** `[Q27]` |

- **`status`는 `null`을 허용한다.** 임계값이 정해지지 않은 지표는 서버가 `null`을 내려보내고, 프론트는 그 카드에 배지를 렌더링하지 않는다. 온도 카드만 배지가 붙는다.
- 전압·전류·SOC 배지는 임계값을 정하지 않으므로 서버가 `null`을 반환한다. 임계값을 추가할 때는 이 계약과 모드별 정상범위를 함께 갱신한다 `[Q27 확정: null 유지]`.

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

**Kafka Consumer 귀속 규칙 (A4)**: version-1 `battery-anomaly-alerts` payload의
권위값은 `device_id`뿐이다. 백엔드는 처리 시점의 등록된 device와
`status = 'ACTIVE'`인 `measurement_session`을 확인해 `session_id`·`battery_id`를
`anomaly_score`에 함께 적재한다. 활성 세션이 없거나 세션/자산 모드가 일치하지
않으면 두 값 모두 `null`이며, `evaluated_at`으로 사후 귀속하지 않는다.
`(device_id, evaluated_at)`은 replay 자연키다. 새 결과가 실제로
`battery_latest.evaluated_at`을 전진시킨 경우에만 서버가 해당 행에서
`anomaly.score`를 발신하고, 등급 전이와 `alert.created`를 한 번 생성한다.
오래된 결과는 이력에는 보존하지만 최신 score/evaluated_at을 역행시키지 않는다.

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
    "causeCode": "FAILSAFE_TEMP_IR_OVER_CAP",
    "causeParams": { "representativeTempC": 61.4, "representativeTempSource": "IR_SURFACE", "capC": 60 },
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

#### Raw CSV / 추세 PDF 내보내기 `[REQ-WEB-054/055]` `[확정 2026-08-05]`

CSV·PDF 버튼은 **추세 화면 상단, 기간 탭 옆**에 있다 `[v3 실측]`.

CSV는 집계 추세가 아니라 **100ms 센서 Raw 행**만 내보낸다. PDF는 기존 집계 추세 보고서다.

- `GET /api/metrics/export.csv?batteryId=&sessionId=&from=&to=`: 범위가 1시간 이하이면 `200 text/csv` 스트리밍 + `Content-Disposition: attachment`. 현재 데모 런타임은 활성 세션 소유권과 `batteryId`를 검증하고 `batteryId-raw.csv`를 반환한다.
- CSV 열은 최소 `measured_at,device_id,battery_id,session_id,mode,voltage_v,current_a,power_w,temp_contact,temp_ir_surface,soc_pct,soc_basis,gas_raw,pressure_raw,acoustic_raw,age_ms`다. 합성 대표 온도는 원본 두 온도와 혼동하지 않도록 원본 열에 포함하지 않는다.
- 1시간 초과는 `POST /api/exports` `{ "kind":"RAW_METRICS_CSV", "sessionId":"...", "from":"...", "to":"..." }`로 작업을 만들고 `202 { id,status:"QUEUED" }`를 반환한다.
- `GET /api/exports/{id}`는 `QUEUED|RUNNING|READY|FAILED|EXPIRED`와, `READY`일 때 단기 서명 `downloadUrl`, `expiresAt`, `sha256`, `rowCount`를 반환한다. `export.ready` WS 이벤트로 완료를 알린다.
- 같은 사용자·같은 범위·같은 종류는 `Idempotency-Key`로 중복 작업을 방지한다. 사용자는 본인 소유 세션만 내보낼 수 있다.
- `GET /api/trends/export.pdf`만 집계 버킷 PDF를 동기 다운로드한다. `format=csv|pdf` 혼합 엔드포인트는 폐기한다.

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
  "reasonCode": "FAILSAFE_TEMP_IR_OVER_CAP",
  "reasonParams": { "representativeTempC": 61.4, "representativeTempSource": "IR_SURFACE", "capC": 60 },
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

`Idempotency-Key` 헤더와 §3.4 서버 자동 승인 절차를 적용한다. 승인 전에는 아무 상태도 바꾸지 않는다. 성공 시 `200 { "decision":"APPROVED", "requestId":"...", "relay": { ... } }`를 반환한 다음 같은 `requestId`를 가진 WebSocket 이벤트를 브로드캐스트한다. 관리자 수동 승인 대기 상태는 없다.

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
      "reasonCode": "FAILSAFE_TEMP_IR_OVER_CAP",
      "reasonParams": { "representativeTempC": 61.4, "representativeTempSource": "IR_SURFACE", "capC": 60 }
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

**프로필 표시 동기화 규칙** `[REQ-WEB-067]`

- `PATCH /api/me`가 성공하면 `200`으로 검증·정규화된 최신 `user` 객체(`id`, `name`, `email`, `phone`, `role`, `status`)를 반환한다. 프론트는 요청 본문을 그대로 믿지 않고 이 응답을 사용자 프로필 상태의 새 기준값으로 사용한다.
- 계정 정보 입력 중인 값은 프론트의 임시 편집 상태로만 유지한다. 사용자가 `변경 저장`을 누른 시점에만 `PATCH /api/me`를 호출하며, 저장 전 입력 이벤트로 서버·사이드바 표시를 갱신하지 않는다.
- 프론트는 응답을 반영하는 즉시 계정 정보 탭의 입력값과 앱 셸 좌측 하단의 로그인 계정 표시(이름 및 이름 첫 글자 아바타)를 함께 갱신한다. 새로고침이나 재로그인 없이 같은 세션의 모든 사용자 표시가 같은 `user.name`을 사용해야 한다.
- 프로필 표시용 이름은 `user.name` 하나만 사용한다. `loginId`, 이메일의 앞부분, 배터리 소유자 표시 문자열을 이름의 대체값으로 사용하지 않는다.
- 저장 실패(`400 VALIDATION_FAILED`, `401/403` 등) 시 프론트는 기존 프로필 표시를 유지하고 성공으로 처리하지 않는다. 서버가 반환한 `details.fields[]`를 필드별 오류로 표시할 수 있어야 한다.

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
- 채널 토글은 카카오(`KAKAO`), 이메일(`EMAIL`), SMS(`SMS`), 웹푸시(`WEBPUSH`) 각각 독립적으로 켜고 끈다. 토글 클릭은 해당 채널의 새 상태를 저장 요청하는 동작이며, 다른 채널 상태를 바꾸지 않는다.
- 프론트는 토글 클릭 시 `PATCH /api/settings/alerts`를 호출한다. 요청은 서버가 보유한 전체 채널 상태를 기준으로 다음처럼 보낸다: `{ "channels": { "KAKAO": true, "EMAIL": true, "SMS": false, "WEBPUSH": true } }`.
- `200` 응답의 `channels`를 화면의 최종 상태로 반영한다. 저장 실패 시 토글을 이전 상태로 되돌리고 `details.fields[]`의 오류를 표시하며, 실패한 상태를 서버에 저장된 것으로 표시하지 않는다.
- 토글 상태는 `/api/me` 응답의 `preferences`와 섞지 않는다. 테마·언어는 `/api/settings/preferences`, 알림 채널은 `/api/settings/alerts`가 각각의 정본이다.

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

**관리자 수정 후 일반 사용자 반영 규칙** `[REQ-WEB-115/067]`

- `PATCH /api/admin/users/{id}`는 관리자 화면 전용 복사본이 아니라 canonical `user` 레코드를 트랜잭션으로 수정한다. 성공 응답은 `200`과 검증·정규화된 최신 `user` 객체를 반환한다.
- 대상 사용자가 이후 로그인하거나 앱을 부팅하면 `GET /api/me`가 같은 canonical 레코드에서 최신 `name`·`phone`·`loginId`를 읽어야 한다. 따라서 새 로그인에서 관리자 수정값이 자동으로 계정 정보와 좌측 하단 로그인 계정 표시까지 반영된다. 프론트는 로그인 시점의 세션 클레임에 남은 이전 이름을 정본으로 사용하지 않는다.
- 이미 로그인한 세션을 강제로 로그아웃시키지는 않는다. 열린 앱의 즉시 갱신이 필요하면 프론트가 앱 포커스/재진입 시 `GET /api/me`를 재조회해 최신 `user` 객체를 적용한다. 관리자 수정 이벤트를 실시간으로 푸시하는 별도 채널은 이 계약의 필수가 아니다.
- 관리자 수정이 실패하면 `user` 프로필과 사용자 표시값을 변경하지 않으며, `400 VALIDATION_FAILED`의 `details.fields[]`를 기준으로 관리자 화면에 오류를 표시한다.

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

> **v3 동기화 상태(2026-08-06):** 상세에 직렬 구성·연결 진단기, native 운영 상태 선택·사유 입력, 별도 관리자 메모 입력과 각각의 저장 동작을 추가했다. 폐기된 설치 위치는 렌더링하지 않는다.

**운영 상태 변경** — `{ "opsStatus": "BLOCKED", "reason": "열폭주 징후" }`
현재 값과 다른 `NORMAL|WATCH|BLOCKED`로 전환할 때는 언제나 trim 후 비어 있지 않은 `reason`이 **필수**다 `[REQ-WEB-125]`. 같은 상태 요청은 변경·감사 없이 `409 NO_STATUS_CHANGE`, 사유 누락은 `422 REASON_REQUIRED`. 서버 성공 전에 화면·목록·로그를 낙관적으로 바꾸지 않는다. 모든 성공 전환은 독립 감사 기록을 남긴다 `[REQ-WEB-126]`.

Q38 기본값은 다음과 같다: `reason` 최대 500자, `memo` 최대 2,000자, 입력은 Unicode NFKC 정규화 후 trim한다. 빈 메모는 메모 삭제로 저장할 수 있고, 상태 사유는 빈 값을 허용하지 않는다. 쓰기 요청에 `version`을 보내면 현재 버전과 원자적으로 비교하며 다르면 `409 VERSION_CONFLICT`; 생략하면 서버가 현재 버전을 사용한다. 민감정보 마스킹은 하지 않으므로 사유·메모에 비밀번호·토큰을 넣지 않는다.

상태 레코드 변경과 감사 기록은 한 트랜잭션으로 성공하거나 함께 실패한다. `BLOCKED` 전환은 상태 변경·활성 세션 종료·감사 이벤트(또는 동일 트랜잭션의 outbox)를 원자적으로 기록하고, 일부만 성공한 응답을 내지 않는다. `BLOCKED`에서 다른 상태로 풀어도 이전 세션이나 릴레이를 자동 복구하지 않는다. 성공 응답은 정본의 `{ "opsStatus", "updatedAt", "updatedBy" }`를 반환한다.

**관리자 메모** — `{ "memo": "열폭주 징후로 차단 유지" }`, 상태와 별도 요청·별도 저장·별도 감사 기록 `[REQ-WEB-124/126]`. 메모 변경에는 상태 변경 사유를 요구하지 않는다. 메모 변경과 감사 기록도 한 트랜잭션으로 처리하며 성공 응답은 `{ "memo", "updatedAt", "updatedBy" }`를 반환한다.

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

**2026-09-01 갱신 — 실행 잠금을 모드 2 전체로 열었다.** `targetMode`가 2이면
하드웨어 프로필과 문턱 설정에 관계없이 진단을 시작할 수 있다. 이전의
*"`MODE2_FULL`만 실행 가능, `COMBINED_EXISTING_PARTS_V1`은 409"* 규칙과
*"문턱값 하나라도 0이면 `configured=false`이며 409"* 규칙은 **폐기됐다.**

대신 결과에 출처를 싣는다. `dataSource`가 `SIMULATED`면 계측값이 백엔드
시뮬레이터에서 나온 것이고, 실물 에지가 붙으면 `MEASURED`가 된다. 안전 문턱은
`0`이 미설정 sentinel이라는 규약을 유지하되, **미설정이 실행을 막지는 않는다** —
해당 안전 계층만 비활성화된다.

`reasonCode`는 `MODE_NOT_SUPPORTED|RELAY_CUT|DEVICE_OFFLINE|null`이다.
`SAFETY_PROFILE_NOT_READY`는 더 이상 발생하지 않는다.

F21 화면이 실행 전에 잠금 사유를 알 수 있도록 `GET /api/batteries/{id}`는 아래 capability를 함께 내려준다. 내부 `hardware_profile` 원문은 노출하지 않아도 된다.

```json
{ "diagnosisCapability": { "executionAllowed": false, "reasonCode": "MODE_NOT_SUPPORTED" } }
```

`reasonCode`는 `MODE_NOT_SUPPORTED|DEVICE_OFFLINE|RELAY_CUT|null`이다. `SAFETY_PROFILE_NOT_READY`는 더 이상 발생하지 않는다(위 갱신 참조). capability는 설명용 선조회이며 POST의 서버 안전 검증을 대체하거나 우회하지 않는다. v3의 숨은 `hardwareProfile` 프로토타입 속성은 두 화면 상태를 검토하기 위한 목업 전환일 뿐 실제 서버 capability를 바꾸지 않는다.

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
- `acknowledged` — 소요 시간 안내 확인. **`true`가 아니면 `400 ACK_REQUIRED`**
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
  "estimatedEndAt": "2026-07-28T05:23:00.000Z",
  "socHintLevel": 3,
  "partialMetrics": {
    "vLightLoadV": 5.06,
    "regulationKneeA": null,
    "kneeIsUpperBound": null,
    "thermalSlopeCPerMin": 2.1,
    "specAttainmentPct": null,
    "thermalProbeLoadA": null,
    "thermalPerWattCPerMinPerW": null,
    "recoverySlopeCPerMin": null
  }
}
```

- 진행 중인 진단이 없으면 `200`에 `null`을 준다. `404`가 아니다 — "없음"은 정상 상태다
- 이 API의 `phase`는 현재 `QUICK`/`CAPACITY` 표면에 한해 `P0`~`P7` \| `CAPACITY`다. `battery-raw-metrics.diag_phase`는 여기에 더해 모드 2 스크리닝 wire 값 `S0`·`S1A`~`S1F`·`S2`·`S3`를 허용한다(스펙 §6-1); 스크리닝 API 표면은 H18에서 별도로 남아 있다. `P6`(붕괴 구간 미세 스윕, 미구현)과 `P7`(붕괴점의 0.9배로 40초 거는 발열 탐침 구간, §3-2 ④)은 다른 단계다
- `partialMetrics`는 아직 확정되지 않은 지표를 `null`로 둔다. 중간값을 추정해 채우지 않는다
- `thermalProbeLoadA`·`thermalPerWattCPerMinPerW`는 **P7이 시작되기 전에는 `null`**이고, `recoverySlopeCPerMin`은 **P5 전에는 `null`**이다. 셋 다 진행 중에도 실리지만 완료 전 값은 그 단계의 부분 집계다 — 완료 결과(`GET /api/diagnoses/{id}`)의 값이 정본이다

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
  "latchOff": false,
  "thermalSlopeCPerMin": 2.4,
  "thermalProbeLoadA": 1.44,
  "thermalPerWattCPerMinPerW": 0.31,
  "recoverySlopeCPerMin": -0.15,
  "specAttainmentPct": 80,
  "ratedOutputCurrentA": 2.0,
  "grade": "SUSPECT_DEGRADED",
  "gradeProvisional": true
}
```

- `latchOff` — 출력 소실(5V→0V)로 이탈이 관측됐는지. 점진적 처짐과 구분한다(스펙 §3-2 ②)
- `thermalSlopeCPerMin` — **여전히 P3(1.5A 고정) 40초 구간 기준이다.** 아래 P7·P5 원값과 구간이 다르니 섞지 않는다(스펙 §3-2 ①·§3-1)
- `thermalProbeLoadA` — P7에 실제로 건 전류(`regulationKneeA`의 0.9배, 스펙 §3-1 P7)
- `thermalPerWattCPerMinPerW` — P7 구간 발열 기울기를 그 구간 전력으로 정규화한 원값. **판정 산식이 아니다** — 문턱·등급이 아직 없다(스펙 §3-2 ④, §8 H21)
- `recoverySlopeCPerMin` — P5(회복, 30초) 구간 온도 기울기 원값. 부호가 정보이며 **판정으로 승격되지 않았다**(스펙 §3-1·§8 H21)
- `gradeProvisional` — 발열 기울기 상한 `S1`이 미설정(`0`)인 상태로 낸 등급이라는 표시. H3 실측 후 `false`가 된다. **`grade` 산식은 P7·P5 원값 추가로 바뀌지 않았다** — 여전히 이탈점·`thermalSlopeCPerMin`(P3 기준)·도달률 세 조건뿐이다(스펙 §3-4)
- `dataSource` (최상위) — `SIMULATED` \| `MEASURED`

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
{
  "v": 1, "type": "metrics.tick", "topic": "metrics",
  "eventId": "evt_01J...", "streamId": "st_u_01J...",
  "sequence": "1043", "cursor": "1043",
  "at": "2026-08-05T14:32:10.000Z", "sessionId": "s_01J...",
  "requestId": null, "payload": { }
}
```

- `eventId`는 이벤트 멱등 식별자, `sequence`는 사용자 stream 안에서 단조 증가하는 64비트 정수의 문자열, `cursor`는 재개용 불투명 문자열이다.
- 클라이언트는 `eventId` 중복을 버리고 마지막 적용 sequence 이하의 역순 이벤트도 적용하지 않는다. `requestId`는 릴레이 등 쓰기 요청과 결과 이벤트를 결합한다.

### 5.3 클라이언트 → 서버

| type | payload | 용도 |
|---|---|---|
| `subscribe` | `{ "requestId":"...", "topics":[...], "afterCursor":"1042" }` | 스냅샷 다음 cursor부터 구독·재생 |
| `resume` | `{ "requestId":"...", "topics":[...], "afterCursor":"1042", "lastEventId":"evt_..." }` | 재연결 재개 |
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
| `relay.autoCut` | Fail-Safe 발동 시 | `{ batteryId, batteryLabel, representativeTempC, representativeTempSource, triggerCode, cutAt }` |
| `alert.created` | 새 알림 | `Alert` 객체 (§4.8) |
| `event.created` | 새 이벤트 | `Event` 객체 (§4.6) |
| `session.ended` | 세션 종료 | `{ sessionId, endReason }` — `TIMEOUT`\|`SUPERSEDED`\|`BLOCKED` (§4.3) |
| `device.status` | 진단기 상태 변경 | `{ deviceId, status, lastSeenAt }` |
| `diagnosis.progress` | 진단 단계 전환 시 | `{ id, kind, phase, loadTargetA, loadActualA, estimatedEndAt, partialMetrics }` (§4.13) |
| `diagnosis.done` | 진단 완료 | `Diagnosis` 객체 (§4.13) |
| `diagnosis.aborted` | 진단 중단 | `{ id, kind, abortReason }` — 사유 code만, 문구는 프론트 사전 |
| `pong` | `ping` 응답 | `{}` |
| `subscribed` / `resumed` | 구독 ACK | `{ requestId, streamId, replayFrom, currentCursor }` |
| `resync.required` | cursor 만료/stream 교체 | `{ requestId, reason, latestCursor }` |
| `export.ready` | 비동기 Raw CSV 완료 | `{ exportId, status, expiresAt }` |

**중요한 설계 지점**

- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 에지는 100ms 주기로 발행하지만 `[PLAN]`, 브라우저가 초당 10프레임 상태 갱신을 감당하지 못한다. 서버가 **1초 단위로 다운샘플링**해 푸시한다.
  - **v3가 이를 뒷받침한다** — 랜딩 히어로와 로그인 모달이 각각 *"전압·전류·온도·SOC를 **1초 단위**로 수집하고"*, *"**1초 단위** 실시간 모니터링"* 이라고 사용자에게 약속한다 `[v3 실측]`. 제품 카피가 이미 1초다.
  - `CLAUDE.md`·`PLAN.md`의 100ms와 모순이 아니다: **에지→Kafka→DB 적재는 100ms, 브라우저 푸시는 1초**로 계층이 다르다. `[확정]`
- **`relay.autoCut`은 별도 타입으로 분리한다.** 프론트가 이 메시지 하나로 자동 차단 모달을 띄운다 `[REQ-WEB-064]`. `relay.changed`에 섞으면 "사용자가 직접 차단한 경우"와 구분이 안 된다.
- **`anomaly.gradeChanged`도 별도다.** 매 tick마다 등급을 비교하는 대신 서버가 전이만 알려주면, 프론트는 토스트·알림음·모달 트리거를 안전하게 걸 수 있다.
- **`diagnosis.progress`는 단계 전환에서만 보낸다.** 진단 중 실시간 측정값은 `metrics.tick`이 이미 1초마다 흘리므로 중복 푸시하지 않는다. 다만 `loadActualA`(부하 제어 실측 전류)는 `metrics.tick`에 없는 값이라 여기 싣는다 — `loadTargetA`와의 차이가 부하 제어 오차이며, 크면 결과를 신뢰할 수 없다(스펙 §7-5).

### 5.5 재연결 규약 `[제안]`

- 클라이언트는 지수 백오프로 재연결한다 (1s → 2s → 4s → … 최대 30s).
- 최초 진입은 `GET /api/dashboard`의 `sync { streamId,snapshotCursor,asOf }`를 원자적 스냅샷으로 받은 뒤 `subscribe.afterCursor=snapshotCursor`를 보낸다.
- 서버는 cursor 이후 이벤트를 순서대로 재생한 후 `subscribed`/`resumed` ACK를 보낸다. replay 보존은 최소 5분 또는 최근 10,000개 중 더 큰 범위다.
- 재연결은 마지막 적용 cursor로 `resume`한다. cursor 만료·권한/세션 stream 교체 시 `resync.required`를 받고 `/api/me`, `/api/dashboard`, `/api/alerts/summary`, `/api/relay`, 활성 진단을 다시 조회한 다음 새 snapshot cursor로 재구독한다.
- `ping` 30초, `pong` 제한 10초다. close code는 `4401` 인증 만료, `4403` 정지/권한 변경, `4408` heartbeat timeout, `4410` resync required다.
- REST 쓰기는 `Idempotency-Key`, WS 이벤트는 `eventId`로 exactly-once 효과를 만든다. 전송 자체는 at-least-once이며 중복 가능하다.

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

**38건 모두 결정됨.** 아래 결정은 현재 API 골격과 v3 화면에 반영했다. **2026-09-01 갱신** — F21 실행 잠금은 모드 2 전체로 열렸다. 하드웨어 실측으로 안전 문턱값을 얻기 전까지도 진단은 실행되지만, 결과는 `dataSource: "SIMULATED"`이고 미실측 문턱에 해당하는 안전 계층은 비활성화된다 — fail-closed가 아니라 **출처 표시 + 부분 fail-open**이다.

| # | 항목 | 상태 |
|---|---|---|
| **Q27** | 전압·전류·SOC 지표 배지 임계값 | **확정** — 온도 외 지표는 `status: null`로 유지한다. |
| **Q35** | 세션 타임아웃 임계 N분 | **확정** — 5분 무수신이면 `TIMEOUT`으로 닫는다. |
| **Q34** | 문구 `code` 전체 목록 | **확정** — §1.10에 현재 code 목록을 고정하고 신규 code는 문서·프론트를 함께 갱신한다. |
| **Q36** | F21 진단 문턱값 | **확정된 보류 방식(2026-09-01 갱신)** — 모든 문턱값을 0으로 저장해 미설정 sentinel로 두되, **더 이상 실행을 거절하지 않는다.** 미설정 문턱에 해당하는 안전 계층만 비활성화되고, 결과에는 `dataSource: "SIMULATED"`가 동봉된다. |
| **Q37** | F21 광고 정격 출력 전류의 등록·수정 경로 | **확정** — 모드 2 자산 등록 시 `ratedOutputCurrentA` 필수 입력으로 받고 진단 스펙 도달률의 분모로 사용한다. |
| **Q38** | 관리자 사유·메모 입력 및 동시 수정 정책 | **확정** — reason 500자·memo 2,000자, NFKC+trim, 빈 메모 삭제 허용, 비밀값 마스킹 금지, `version` 불일치 `409 VERSION_CONFLICT`; 상태·메모·감사는 별도 원자 저장이다. |
| **Q6** | SOH/RUL 산출 주체 | **확정** — 모드 1은 백엔드가 BQ27441 집계로 계산하고, 모드 2 미지원 건강도는 `null`이다. |

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
| Q9 | CSV/PDF | **CSV=100ms Raw.** 1시간 이하는 동기 스트리밍, 초과는 비동기 export job. PDF만 집계 추세 동기 다운로드 |
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

### v3 비-native 선택 컨트롤 매핑 `[브라우저 실측 2026-08-06]`

아래는 `<select>`·checkbox가 아니라 클릭형 칩·토글·메뉴로 구현된 선택 컨트롤이다. **입력 데이터가 없는 장식이 아니며**, 실제 구현은 아래 요청 필드에 반드시 연결한다. 키보드 접근성은 `button`/ARIA 역할과 선택 상태를 제공해야 한다.

| 화면의 클릭형 선택 | 백엔드 계약 |
|---|---|
| 배터리 등록 종류 `LI_ION`/`LI_PO`, 모드 `1`/`2` | `POST /api/batteries`의 `chemistry`, `targetMode` |
| 배터리 목록 모드 필터·최근/점수/SOC 정렬 | `GET /api/batteries?mode=&sort=` |
| 배터리 선택·연결 확인 | `POST /api/sessions`의 `batteryId` |
| 대시보드 지표 선택, 추세 기간·지표·비교 배터리 | 조회 로컬 상태 + `GET /api/trends?period=&metrics=&batteryIds=` |
| 이벤트 심각도 필터·페이지 이동 | `GET /api/events?severity=&page=&size=` |
| 알림 확인, 전체 확인 | `POST /api/alerts/{id}/ack`, `/api/alerts/ack-all` |
| 알림 채널 토글 | `PATCH /api/me/notification-preferences`의 `KAKAO|EMAIL|SMS|WEBPUSH` boolean |
| 테마 `light`/`dark`/`system` | `PATCH /api/me/preferences`의 `theme` |
| 관리자 유저 상태·역할 필터 | `GET /api/admin/users?status=&role=&q=`; 역할 자체는 변경 불가 |
| 관리자 배터리 운영상태 필터 | `GET /api/admin/batteries?opsStatus=&q=` |
| 공지 카테고리 필터·게시/임시저장/보관 | `GET /api/admin/notices?category=&status=`, 쓰기는 §4.12 |

실제 텍스트 입력처럼 보였던 로그인·가입·계정 찾기·배터리 등록/수정·이벤트 검색·릴레이 사유/비밀번호·공지 제목/본문은 native `input`/`textarea`로, 감사 기간·행위·대상과 공지 카테고리·노출 대상은 native `select`로, 약관·공지 동시 알림은 native checkbox로 교체했다. 클릭형 상태 칩·메뉴·토글은 키보드 `Enter`/`Space`와 `role=button`을 함께 제공한다. 배터리 연결은 `POST /api/sessions`, 모드 2 등록 입력은 `POST /api/batteries`의 `capacityWh`·`ratedOutputCurrentA`, 릴레이는 `POST /api/relay/{cut|restore}`의 `reason`·재인증·`Idempotency-Key`, CSV는 `GET /api/metrics/export.csv`에 매핑한다.

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
| REQ-WEB-123/124/125 운영상태·메모 | 2026-08-06 상세에 native 입력·분리 저장·상태 변경 확인 추가 | **동기화 완료** |
| REQ-WEB-135 감사 로그 상세 | 행 클릭 무반응 | **제외** |
| REQ-WEB-072 음성 안내 설정 | 어느 화면에도 없음 | **포함** — 프론트가 설정에 섹션 추가 |
| REQ-WEB-071 캘리브레이션 이력 | 조회 화면만, 등록 수단 없음 | **제외**(Q14) — 화면도 제거 |
| 임계치 설정 | 라벨만 있고 미렌더링 | **제외** (기능 자체가 제거됨) |
| 셀 온도 히트맵 | 렌더링됨 | **제외** (쓰지 않기로 결정) |

### 입력 항목 동기화 상태

| 요구사항 | 문서 | 현재 v3 폼 |
|---|---|---|
| REQ-WEB-037 배터리 등록 | 이름·종류·모드·직렬 셀 수·제조사·모델·모드 2 정격 용량 | 동일하게 동기화 완료 |

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

## 12. 2026-08-06 동기화 감사 결과

### 이번에 닫힌 불일치

- 모드 3 제거, 모드 1 외부 셀·모드 2 보조배터리로 통일
- 4등급 30/60/80 판정, Raw `anomaly_score` 0.0–1.0 통일
- 접촉/IR 대표 온도 최댓값, signed 전류, 모드 2 상대 SOC 표시
- 클라이언트 온도/AI 판정에 의한 자동 차단 제거; 서버 `relay.autoCut` 전용
- 릴레이 사유·본인 재인증·interlock·감사 기록의 서버 자동 승인 게이트
- CSV를 100ms Raw로 확정하고 1시간 초과 비동기 export로 분리
- WS cursor/sequence/eventId/idempotency/replay/reconnect 규약 추가
- 가입·계정 찾기·배터리 폼·이벤트 검색·릴레이·감사 필터·공지 알림처럼 입력처럼 보이던 요소를 실제 입력/선택 요소로 교체하고 API 매핑 명시
- 관리자 유저의 ID·등록 배터리 수·권한·상태는 읽기 전용으로 바꾸고 비밀번호 직접 지정은 재설정 링크 발송으로 교체
- F21 기본 화면은 안전 미준비 profile에서 실행 잠금·미지원값 `—`를 표시하고, 숨은 속성에서만 `MODE2_FULL` 검토 상태를 제공
- 관리자 배터리 상세에 모든 상태 전환 사유·확인과 상태/메모 분리 저장을 추가
- 관리자 감사 로그 화면은 `GET /api/admin/audit-logs`를 읽어 실제 상태·메모·릴레이·계정 전환 기록을 표시한다.
- 현재 worktree의 demo provider가 위 REST/WS 경로와 네이티브 입력 매핑을 제공한다. 다만 DB 트랜잭션·Kafka/Timescale consumer·실물 Fail-Safe는 아직 production provider로 승격되지 않았다.
- 모드 1은 압력 단독, 모드 2는 가스 단독이며 음향은 `null`이다. F21 문턱 0 sentinel, 5분 세션 타임아웃, 모드 2 광고 정격 출력 전류 필수, 관리자 reason/memo 분리 원자 저장을 확정했다.

### 남은 의도적 범위/미구현

| 항목 | 상태 |
|---|---|
| 음성 안내 설정 | 요구사항에는 있으나 v3 미구현 |
| 감사 로그 상세 모달 | v3에서 행 클릭 동작이 없어 제외 유지 |
| 상대시간·mock 수치 | 프로토타입 표현이며 실제 구현은 서버 UTC와 실데이터 사용 |
