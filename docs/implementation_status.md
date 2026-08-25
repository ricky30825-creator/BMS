# 구현 상태 및 문서 지도

> 기준일: **2026-08-25** (직전 갱신 2026-08-11). 아래 표는 브라우저·curl·테스트 실제 실행으로 재확인했다.

이 문서는 설계 문서의 요구사항과 현재 저장소에 실제로 존재하는 구현을 구분하기 위한 실행용 지도다. 요구사항의 정본이 아니며, 상세 계약은 아래 링크의 원본 문서를 따른다.

> **남은 작업을 담당자별로 나눈 상세 목록은 이 문서 맨 아래 [「남은 작업과 담당 경계」](#남은-작업과-담당-경계)에 있다.** 아래 표는 현황 요약이고, 그쪽이 실행 목록이다.

## 2026-08-25 범위 결정 — 먼저 읽을 것

이 네 가지가 이후의 모든 판단을 바꾼다. `CLAUDE.md`·`PLAN.md`에도 같은 날짜로 반영했다.

1. **전 구성이 호스트 PC 1대에서 로컬로 돈다. AWS EC2는 쓰지 않는다.** 에지만 같은 LAN의 별도 장비다. Kafka는 LAN 한정 PLAINTEXT이며 TLS/SASL을 쓰지 않는다.
2. **Google Colab은 학습 전용이고 실시간 경로에 없다.** 로컬 Kafka가 NAT 뒤라 Colab이 인바운드로 못 붙기 때문이다. 체크포인트를 내려받아 호스트 PC의 **로컬 추론 프로세스**가 로드한다. 이 프로세스는 **별도 담당자**가 만든다.
3. **Phase 1 Better Auth 실인증은 보류한다.** 코드는 남기고 `AUTH_MODE=demo`로 꺼둔다. 데모 계정에 ADMIN이 있어 RBAC·감사로그 시연에는 지장이 없다.
4. **Phase 6 카카오톡 발송은 보류한다.** 설정 화면의 채널 토글은 **현행 유지** — 저장은 되지만 발송은 일어나지 않고, 화면에 미구현 표시를 추가하지 않는다. ⚠️ 시연에서 "알림이 간다"고 설명하지 않도록 주의.

## 읽는 법

- **구현됨**: 저장소에서 실행 가능한 코드나 검증 가능한 산출물을 확인할 수 있다.
- **부분 구현**: 골격·스텁·단일 화면만 있고 전체 계약은 아직 구현되지 않았다.
- **문서만 있음**: 설계·계약은 있지만 실행 코드나 실물 검증 결과가 없다.
- **미착수**: 계획에는 있으나 현재 저장소에서 구현을 확인할 수 없다.

## 현재 저장소 상태

| 영역 | 현재 확인되는 것 | 상태 |
|---|---|---|
| 요구사항·제품 계약 | [`PLAN.md`](../PLAN.md), [`docs/product_contract.md`](product_contract.md), 기능정의서·유저플로우 | 구현 기준 문서 있음 |
| 백엔드 인증 골격 | `backend/src/auth.ts`, 세션 미들웨어, 감사 로그, DB 연결, Better Auth `/api/auth/*`. 데모 토큰 인증으로 RBAC·정지 계정 차단까지 실동작 | 골격 구현 / **실인증 전환은 보류(의도적)** |
| 백엔드 데모 도메인 API | `backend/src/server.ts`(991줄): 발급 토큰 인증, 사용자·관리자 REST 56개 라우트(`/health`·`/api/demo/*` 포함), 계약형 대시보드, F21 fail-closed, 릴레이 승인·재인증·멱등성, Raw CSV. 게이트 실동작 확인(`409 BATTERY_BLOCKED`/`NO_ACTIVE_SESSION`, `401 REAUTH_REQUIRED`, `ACK_REQUIRED`, 관리자 `403`) | **데모 런타임 구현·실 REST 브라우저 검증 완료** |
| 백엔드 도메인 데이터 저장 | `backend/src/store.ts`(360줄)가 **전부 인메모리 배열·Map**이며 SQL을 실행하지 않는다. `backend/src/db.ts`의 풀은 `auth.ts`(Better Auth)만 사용. 프로세스 재시작 시 데이터 소멸 | **미착수** (→ B1) |
| 백엔드 실시간 스트림 (WS 발신) | **C1 완료(2026-08-25).** 프론트가 처리하는 11종 중 `metrics.tick`·`anomaly.score`·`anomaly.gradeChanged`·`relay.changed`·`alert.created`·`event.created`·`session.ended`·`resync.required` 8종이 실제로 발신되고, `subscribe`/`resume`이 1만 건 링버퍼로 실제 재전송을 수행한다. 단 `metrics.tick`·`anomaly.score`·`anomaly.gradeChanged`·`alert.created`는 이 저장소 안에 `battery.latest.score`를 사후에 바꾸는 코드가 아직 없어 **매초 같은 값을 반복 push하는 휴면 상태**다(AI 추론 연동 후 살아난다) — 이는 버그가 아니라 현재 범위의 자연스러운 결과다. `relay.autoCut`·`diagnosis.progress`/`.done`/`.aborted`는 여전히 미발신(§4 C1 참조) | **구현됨(부분 휴면)** — 잔여 `relay.autoCut`(→B3)·`diagnosis.*`(→ F21 안전 프로필) |
| 백엔드 DB 도메인 provider·Consumer·TimescaleDB | `backend/migrations/001_app_auth.sql`에 자산/세션/릴레이/텔레메트리/진단/멱등성 스키마가 있고 컬럼이 `store.ts` 타입과 1:1로 맞으나, production repository·Kafka Consumer·시계열 적재는 없음. `DATA_MODE=postgres`에서는 `/api/*` 전체가 `RUNTIME_NOT_READY`(503)로 fail-closed(C2, 2026-08-25 실측), `AUTH_MODE=betterauth`에서는 WS도 `socket.destroy()`(C2b, 보류) — 단 WS upgrade는 `DATA_MODE`를 보지 않는 갭이 있다(§4 C2 참조) | 스키마만 있음 / provider 미착수 |
| 알림 발송 (카카오·SMS·메일) | 채널 ON/OFF 토글과 policy 응답만 있고(`server.ts:405`·`:409`), **실제로 메시지를 보내는 코드는 `backend/src`에 없다** | **보류(의도적)** — 토글 현행 유지, 추가 작업 없음 |
| AI 로컬 추론 프로세스 | 코드 없음. `ai/` 디렉터리도 없다. 학습(Colab)·체크포인트 반출 절차·추론 프로세스 모두 미착수 | 미착수 — **별도 담당자** |
| 로컬 실행 패키징 | 프론트 production 빌드를 백엔드가 서빙하는 구성 없음(현재 5173↔3005 두 오리진), 프로세스 자동 시작 없음, 시드 데이터 절차 없음 | 미착수 (→ C8) |
| 에지 소프트웨어 | `edge/bw150/`에 BW150 HID 로거·탐지·BLE 프로브(914줄)만 있고, 센서·릴레이·Kafka 프로듀서 구현은 없음 | 부분 구현 (BW150 한정) |
| AI 소프트웨어 | 모델 설계는 있으나 `ai/` 디렉터리, Colab 노트북, 학습·추론·Kafka 연동 구현은 없음 | 미착수 |
| 프론트엔드 | [`frontend/src/`](../frontend/src/)의 Vite + React + TypeScript strict 앱, v3 사용자 15·관리자 6 라우트, 계약형 API/WS 계층, MSW 시나리오, `npm run dev:real` 데모 경로. WS 이벤트 11종 핸들러 중 **8종이 서버 발신을 실제로 수신**(C1), 잔여 `relay.autoCut`·`diagnosis.*` 3종은 여전히 대기 | 부분 구현 / production provider 미착수 |
| 프론트엔드 실행 기반 | `frontend/package.json`, React Router, Query, RHF/Zod, 토큰 CSS, 공용 UI, Vitest/RTL/Playwright. **Vitest 44건·Playwright 28건·`tsc --noEmit` 통과**(2026-08-25 실행) | 구현됨 |
| 미구현 REST·화면 | **C3 완료(2026-08-25)**: `POST /api/account/email-availability`, `POST /api/exports`+`GET /api/exports/{id}`+`GET /api/exports/{id}/download`(QUEUED→READY 비동기 잡, 서명·시한부 다운로드 URL, 멱등성·소유권 검증까지 실측 완료). 남은 것은 `GET /api/trends/export.pdf`(503 스텁 — PDF 생성에 새 의존성이 필요해 이번 라운드는 범위 밖으로 확정), `GET`/`PATCH` `/api/settings/voice-alert`(백엔드·프론트 양쪽 없음) | 부분 구현 — 잔여 `export.pdf`(범위 밖 확정)·C4 |
| 모드 1 하드웨어 | KiCad 회로 파일, [`docs/hardware/mode1_backend_spec.md`](hardware/mode1_backend_spec.md), 조립 안내서 | 문서·설계 있음, 실물 검증 전 |
| 모드 2 하드웨어 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](hardware/mode2_powerbank_diagnosis_spec.md) | 설계 계약 있음, 구현 전 |
| 디자인·목업 | [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](../web/cellguard_mockup_v4.html) | 참고 산출물 있음 |
| 자동 검증 도구 | `tools/contract_lint.py`(계약서 어휘·영역·REQ 인용 검증, 위반 0건), `landing_lint.py`, `bundle_io.py`, 회로 생성기 2종. 단위 테스트 **48건 통과** | 구현됨 |

### 이 표를 다시 확인하는 방법

> **C2(`AUTH_MODE`/`DATA_MODE` 분리) 완료.** `DEMO_MODE=true`는 `AUTH_MODE=demo DATA_MODE=memory`로 바뀌었다.

```bash
# 백엔드 데모 런타임 (PostgreSQL 없이 뜬다 — pg 풀이 lazy라 auth 경로를 안 밟으면 접속하지 않는다)
cd backend && AUTH_MODE=demo DATA_MODE=memory PORT=3005 \
  DATABASE_URL=postgres://x:x@127.0.0.1:5432/x \
  BETTER_AUTH_URL=http://localhost:3005 \
  BETTER_AUTH_SECRET=<32자 이상> npx tsx src/server.ts

# 프론트엔드를 실 백엔드에 붙여 띄우기 (기본 `npm run dev`는 MSW 목이다)
cd frontend && npm run dev:real     # → http://localhost:5173

cd frontend && npm run typecheck && npx vitest run && npx playwright test
cd backend  && npm run typecheck
cd tools    && python3 -m unittest discover -p "test_*.py"   # ⚠️ tools/ 안에서 실행해야 import가 풀린다
python3 tools/contract_lint.py docs/product_contract.md      # 인자 없이 부르면 usage만 출력
```

데모 계정은 `backend/src/store.ts:132`~`135`에 있다 — `hong@cellguard.io`(USER) / `lee@lab.io`(ADMIN) / `park@test.io`(SUSPENDED), 비밀번호는 모두 `demo-password`. `PACK-001`은 `opsStatus: BLOCKED`라 세션을 시작할 수 없으니(의도된 게이트) 시연에는 `DEMO-PACK-001`을 쓴다.

### 2026-08-25 재확인에서 정정된 것

- **`/api/calibrations`·`/api/relay/kill-switch/confirm`·`/api/me/notification-preferences`가 404인 것은 정상이다.** 계약이 각각 "만들지 않는다"(`backend_contract.md:1145`), "`/api/relay/cut`으로 교체 확정"(`:1049`), "정본은 `/api/settings/alerts`"(`:1082`)로 정해둔 것이다. 미구현으로 세어 구현하면 계약 위반이다. 전체 목록은 아래 §5 D군.
- **`/api/settings/voice-alert`(REQ-WEB-072)는 반대로 계약이 "포함"인데 백엔드·프론트 양쪽 모두 없다**(`:1086`·`:1113`·`:1134`).
- 프론트엔드 대시보드의 전류 표시에서 부호를 제거했다(`magnitude()`) — 계약상 `current_a`는 부호를 살려 전송하되 표시할 때만 `abs()`하고 방향은 라벨로 낸다. 온도는 영하가 정상값이라 적용 대상이 아니다.
- 빠른 추세 카드의 미니 스파크라인이 하드코딩 좌표였던 것을 실제 `quickTrend` 시리즈 기반으로 교체했다. 서버가 한 번에 지표 하나의 시리즈만 주므로 해당 지표 카드에만 그리고, 표본이 2개 미만이면 그리지 않는다.

### 2026-08-06 계약 동기화 주의

v3 프로토타입과 정본 문서에는 모드 1/2, 대표 온도 최댓값, signed 전류, 모드 2 상대 SOC, F21 `0=미설정` fail-closed, 서버 승인 릴레이, Raw CSV, WS envelope, 관리자 상태·메모·계정 사유 게이트가 반영됐다. 데모 provider의 REST/WS와 실제 Chromium 클릭 검증은 완료했지만, 실제 PostgreSQL transaction provider·Kafka/Timescale 적재·물리 Fail-Safe 판정·하드웨어 릴레이는 아직 구현/실측 전이다. `DATA_MODE=postgres`(과거 `DEMO_MODE=false`)는 이 provider가 생길 때까지 `RUNTIME_NOT_READY`로 닫힌다.

`backend/dist/`는 TypeScript 빌드 산출물이며 소스 구현의 근거로 세지 않는다. `PLAN.md`의 예정 폴더 구조도 실제 디렉터리 존재를 의미하지 않는다.

같은 날짜에 프론트엔드 실행 기반과 v3 도달 화면을 추가했다. `/api/me` 부트, 자산·세션 게이트, 대시보드 snapshot/WS 재연결, 릴레이 서버 승인, F21 fail-closed, 관리자 상태·메모 분리 UI를 계약형 클라이언트와 MSW로 연결했다. 2026-08-11에는 명시적 `dev:real` 경로를 추가하고 데모 로그인 토큰을 REST·다운로드·WS에만 전달하도록 연결했다. Better Auth 경로와 production/cookie 경로에는 Demo 헤더·쿼리 토큰을 넣지 않는다. 알림 설정은 GET canonical 조회와 `{ channels: { KAKAO, EMAIL, SMS, WEBPUSH } }` PATCH 응답 반영·실패 rollback을 사용하며, 비밀번호 변경은 현재/새/새 확인 입력을 검증한 뒤 확인 필드를 제외하고 POST한다. F21은 기본 `SAFETY_PROFILE_NOT_READY` 자산을 계속 잠그고, capability=true 모드 2는 MSW 전용 검증 시나리오에서만 요청·진행·중단·이력·상세를 확인한다. PDF aggregate export와 production domain provider는 아직 준비되지 않아 UI/API가 사용 불가 상태를 명시한다.

2026-08-06 프론트엔드 계약 회귀: WebSocket 클라이언트 메시지는 `{ v: 1, type, payload }` 봉투를 사용하고, 일반 재연결은 마지막 cursor/eventId로 resume하며 snapshot을 재조회하지 않는다. `resync.required`/`4410`에서만 `/api/me`, dashboard, alert summary, relay, active diagnosis를 다시 조회한다. Vitest/RTL/MSW 계약 테스트는 이 동작과 알림·비밀번호·F21 요청 shape 및 안전 profile 시나리오를 검증한다.

## PLAN 로드맵과 실제 상태

| 단계 | PLAN 기준 | 현재 판단 |
|---|---|---|
| Phase 1 인프라·백엔드 기반 | 백엔드 초기화·인증 골격만 완료 | 부분 구현. 로컬 Kafka·PostgreSQL/TimescaleDB 미착수. **EC2 항목은 삭제**(로컬 구성), **Better Auth 실인증은 보류** |
| Phase 2 에지 수집 | 센서·100ms 폴링·릴레이·음성·프로듀서 | 미착수 (BW150 도구만 존재) |
| Phase 3 스트리밍 | Consumer·세션 태깅·적재·오프셋 | 미착수 |
| Phase 4 AI | 데이터셋·특징·AE·Informer·추론 | 미착수. **추론이 Colab에서 호스트 PC로 내려왔고 별도 담당자 몫** |
| Phase 5 웹 | React 초기화·라우팅·화면·관리자 | 부분 구현. v3 화면·계약 계층·mock QA·localhost demo REST 연결 완료. **WS 서버 발신이 1/11종 → 8/11종으로 확장**(C1, 2026-08-25)됐으나 잔여 2종은 각각 B3·F21 안전 프로필 선행. production DB provider 통합(B1)은 미완료 |
| Phase 6 알림·차단 | 카카오·Fail-Safe·음성 설정 | **카카오는 보류(의도적).** Fail-Safe는 판정 코드 자체가 없고, 음성 설정은 API·화면 모두 없음 — 이 둘은 미착수 |
| Phase 7 통합·**로컬 실행 패키징** | E2E·시나리오·실행 묶기 | 미착수. **AWS 배포 항목은 삭제**(클라우드 미사용). 단 프론트 단독 E2E(Playwright 28건)는 동작 |

세부 체크리스트는 [`PLAN.md` §8 개발 로드맵](../PLAN.md#8-개발-로드맵)을 기준으로 갱신한다. **담당자별 실행 목록은 [「남은 작업과 담당 경계」](#남은-작업과-담당-경계)를 본다.**

## 정본 문서 지도

- 전체 요구사항·데이터 모델·로드맵: [`PLAN.md`](../PLAN.md)
- 제품 동작·기능 계약: [`docs/product_contract.md`](product_contract.md)
- REST·WebSocket·도메인 불변식: [`docs/backend_contract.md`](backend_contract.md)
- 일반/관리자 기능과 흐름: [`docs/feature_definition.md`](feature_definition.md), [`docs/admin_feature_definition.md`](admin_feature_definition.md), [`docs/userflow.md`](userflow.md), [`docs/admin_userflow.md`](admin_userflow.md)
- 모드 1 수집·회로·조립: [`docs/hardware/mode1_backend_spec.md`](hardware/mode1_backend_spec.md), [`docs/hardware/mode1_beginner_guide.md`](hardware/mode1_beginner_guide.md), [`hardware/mode1/README.md`](../hardware/mode1/README.md)
- 모드 2 진단: [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](hardware/mode2_powerbank_diagnosis_spec.md)
- 디자인·목업: [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](../web/cellguard_mockup_v4.html)

## 현재 확인된 결정·미결정 게이트

1. 최신 화면 정본은 `설계 산출물/셀가드 프로토타입_v3.html`이다. F21 안전 잠금·숨은 `MODE2_FULL` 검토 상태와 관리자 상태/메모 분리 저장 화면까지 반영됐지만, 실제 REST·안전 제어 구현 완료를 뜻하지 않는다.
2. 모드 1은 [`docs/hardware/mode1_backend_spec.md` §13](hardware/mode1_backend_spec.md#13-실물로-확인해야-하는-것)의 H1~H9를 실물로 확인하기 전 센서 해석을 확정하지 않는다.
3. 모드 2의 표면온도·상승률·부스트 효율·컷오프 복귀 등은 [`docs/hardware/mode2_powerbank_diagnosis_spec.md` §8](hardware/mode2_powerbank_diagnosis_spec.md#8-미결정)의 미결정 항목을 임의로 채우지 않는다.
4. 백엔드 계약의 `[정의 필요]` 항목은 [`docs/backend_contract.md` §9](backend_contract.md#9-미결정-항목)를 확인하고, 값을 추정해 API나 UI에 하드코딩하지 않는다.
5. AI 구현에는 아직 데이터셋 위치·라벨 규칙·체크포인트 형식·특징 버전·추론 메시지 계약·Colab↔AWS 인증 절차가 없다. 이 정보 없이 모델 학습이나 실시간 추론 코드를 시작하지 않는다.

## 권장 다음 순서

> 아래는 프로젝트 전체 순서다. **본인(프론트·백엔드) 몫의 구체적 착수 순서는 [「남은 작업과 담당 경계」 §6](#6-착수-순서-제안)에 있다.**
>
> **2026-08-25 업데이트**: §6의 C1(WebSocket 실시간 발신)·C2(`AUTH_MODE`/`DATA_MODE` 분리)·C3(REST 2건)가 완료됐다. 아래 4번 "프론트엔드 계약 계층을 실WebSocket에 연결"의 서버 측 절반은 이걸로 끝났고, 다음은 1번(B1 리포지토리 교체)과 B3(Fail-Safe) 순서다 — 상세는 §6.

1. 백엔드의 `battery_asset`·`measurement_session`과 Kafka/DB 경계를 구현한다.
2. 에지 수집 계약을 코드로 옮기고 모드 1 실물 게이트를 닫는다.
3. AI 입출력 계약과 Colab 실행 절차를 확정한 뒤 모델 구현을 시작한다.
4. 프론트엔드 계약 계층을 실백엔드·실쿠키·실WebSocket에 연결하고 브라우저 인수를 수행한다.
5. 마지막에 에지→Kafka→DB→AI→대시보드 통합 검증을 수행한다.

---

# 남은 작업과 담당 경계

> 작성 2026-08-25. 저장소 실측(브라우저·curl·테스트 실행) 기준이며, 인용한 `파일:줄`은 그날의 커밋 기준이다.
> **분담 전제**: 프론트엔드·백엔드는 본인, Kafka·PostgreSQL/TimescaleDB 적재는 동료.

## 0. 이 문서를 쓰는 법

작업 단위마다 **현재 상태 → 해야 할 일 → 계약 근거 → 완료 판정**을 적었다. 착수 전 반드시 계약 근거를 먼저 읽는다. 계약과 이 문서가 어긋나면 **계약이 정본**이고 이 문서를 고친다.

**판단과 구현을 구분한다.** 경계가 애매한 항목에서 *무엇을 언제 어떤 규칙으로* 정하는 것은 백엔드 담당(계약 문서를 읽는 사람)의 몫이고, *어디에 어떻게 적재·전달할지*는 인프라 담당의 몫이다. 판단을 인프라 담당에게 넘기면 안전 로직이 두 곳으로 쪼개진다 — CLAUDE.md가 릴레이 채널 매핑을 모드 1·2에서 통일해 둔 것과 같은 이유다(*"안전 로직에서 두 벌은 곧 버그다"*).

## 1. 지금 실제로 돌아가는 것 (2026-08-25 실측, C1/C2/C3 반영)

- `backend` 타입체크 통과 + Vitest **21건**(신규 — 이번 계획에서 처음 생긴 백엔드 테스트 하네스. `grade.ts`·`eventLog.ts`·`store.ts`(신규 `sessionById`)·`exports.ts`), `frontend` 타입체크 통과 + Vitest 44건 + Playwright 28건, `contract_lint.py` 위반 0건.
- `AUTH_MODE=demo DATA_MODE=memory` + `npm run dev:real`로 브라우저에서 로그인 → 자산 게이트 → 세션 시작 → 대시보드까지 실제 REST/WS로 동작. 콘솔 에러 없음. (`DEMO_MODE`는 C2에서 완전히 제거됐다 — 아래 참조.)
- 서버측 게이트 실동작 확인: `409 BATTERY_BLOCKED`, `409 NO_ACTIVE_SESSION`, `401 REAUTH_REQUIRED`, `ACK_REQUIRED`, USER의 관리자 API `403`.
- **C1**: WebSocket이 `relay.changed` 1종에서 8종 발신으로 확장됐다(§4 C1). **C2**: `DEMO_MODE` → `AUTH_MODE`/`DATA_MODE` 분리 완료. **C3**: `email-availability`·`exports` 계열 REST 2건 신규 구현.

**단, 도메인 데이터는 전부 인메모리다.** `backend/src/store.ts`는 `node:crypto`만 import하며 어떤 SQL도 실행하지 않는다. `backend/src/db.ts`의 풀은 `auth.ts`(Better Auth)만 쓴다. **이 문서의 C1/C2/C3 실측은 모두 인메모리 데이터 위에서 확인한 것이며, `DATA_MODE=postgres`(B1)는 여전히 미착수다.**

## 2. A군 — 타 담당자 몫

### A-1. Kafka·DB 담당

| # | 항목 | 완료 판정 |
|---|---|---|
| A1 | 호스트 PC에 Kafka 설치·토픽 3개 생성, LAN 한정 PLAINTEXT | 에지·추론·백엔드가 LAN에서 접속 성공 |
| A2 | `battery-raw-metrics` Consumer → `telemetry_metric` 적재 | 에지 발행분이 테이블에 초 단위 지연으로 쌓임 |
| A3 | TimescaleDB 하이퍼테이블·압축·보존정책 (`telemetry_metric`) | 100ms × 다중 세션 부하에서 조회 지연 확인 |
| A4 | `battery-anomaly-alerts`(추론 결과) Consumer | 이상점수·AE/Informer 개별 점수·파생 온도가 적재됨 |
| A5 | Consumer 오프셋·재처리·중복 방지 | 재시작 후 유실·중복 없음 |

> ⚠️ **`advertised.listeners`를 `localhost`로 두면 라즈베리파이가 못 붙는다.** 브로커가 클라이언트에게 자기 주소를 되돌려주는 값이라, `localhost`면 에지가 자기 자신에게 접속을 시도하며 조용히 실패한다. 호스트의 LAN IP로 잡는다.

> 스키마 자체는 이미 `backend/migrations/001_app_auth.sql`에 있다 — `battery_asset`(38) / `measurement_session`(62) / `relay_state`(77) / `telemetry_metric`(88) / `diagnosis`(110) / `idempotency_key`(127) / `audit_log`(20) / `app_user_profile`(1). 컬럼은 `store.ts`의 타입과 이미 1:1로 맞는다. **스키마를 바꾸면 `store.ts` 타입도 같이 바뀌므로 반드시 합의 후 변경한다.**

### A-2. AI 담당

| # | 항목 | 완료 판정 |
|---|---|---|
| A6 | LSTM-AE·Informer 학습 (Colab) | 체크포인트 산출 |
| A7 | 체크포인트를 Colab → 호스트 PC로 반출하는 절차 확정 | 파일 형식·**특징 버전 표기**·저장 위치가 문서화됨 |
| A8 | **로컬 추론 프로세스** — 체크포인트 로드, `battery-raw-metrics` 구독, AE·Informer Score → Score Fusion, `battery-anomaly-alerts` 발행 | 대시보드 이상점수가 실제 측정에 반응 |
| A9 | 칼만 필터·내부 셀 온도 추정 (에지가 아니라 여기서 수행) | 파생 온도가 alerts에 실림 |

> **Colab은 학습 전용이며 실시간 경로에 없다.** 로컬 Kafka가 NAT 뒤라 인바운드 접속이 불가능하기 때문이다. 문서 어딘가에 남은 *"Colab이 raw-metrics를 구독한다"*는 폐기된 설계다.

> **`diag_phase != null` 프레임은 정상패턴 학습에서 제외한다**(CLAUDE.md). 진단 중 계단 스윙은 사람이 만든 전류 계단이라 정상으로 배우면 실제 이상을 놓친다.

> 미실측 리스크: 호스트 PC에 GPU가 없으면 추론이 100ms 스트림을 못 따라갈 수 있다. 30 time-step 윈도우라 CPU로도 가능할 것으로 보이나 확인 전이다. 못 따라가면 **추론 주기를 1초로 낮추는 것**을 먼저 검토한다 — 대시보드 `metrics.tick`이 이미 1초 다운샘플링이라 표시 해상도는 그대로다.

## 3. B군 — 회색지대 (판단은 백엔드, 구현이 갈림)

**이 4건이 지금 가장 위험하다.** "DB는 동료 몫"으로 뭉뚱그리면 양쪽 다 착수하지 않은 채 통합 시점에 드러난다.

### B1. `store.ts` → PostgreSQL 리포지토리 교체 — **판단·구현 모두 백엔드**

사실 회색지대가 아니다. 버전 충돌(`version` 컬럼), 멱등성 키, `opsStatus` 게이트, 소유자 스코프가 전부 백엔드 계약이라 **DB를 쓰는 애플리케이션 코드**다. 동료가 A2를 완벽히 끝내도 *그 테이블을 읽어 REST로 내보내는 코드가 존재하지 않는다.*

- **현재 상태**: `backend/src/store.ts` 전체가 모듈 스코프 배열·Map(`138` `demoBatteries` / `147` `demoSessions` / `148` `demoRelays` / `149` `demoDiagnoses` / `150` `demoAudits` / `151` `idempotency`). 프로세스 재시작하면 전부 사라진다.
- **해야 할 일**: `store.ts`가 내보내는 함수 시그니처를 그대로 두고 내부만 SQL로 교체한다. 교체 대상 표면(줄번호는 현재 파일 기준):
  - 조회: `userById`(166) `batteryById`(167) `users`(168) `batteries`(169) `activeSession`(170) `sessionsForBattery`(171) `activeDiagnosis`(172) `diagnosesForBattery`(173) `diagnosisById`(174) `relayByBattery`(175) `audits`(176)
  - 변경: `createBattery`(178) `updateBattery`(204) `recordAudit`(220) `startSession`(239) `changeOpsStatus`(257) `saveMemo`(278) `changeUserStatus`(288) `changeRelay`(299) `startDiagnosis`(320) `abortDiagnosis`(332)
  - 멱등성: `idempotent`(226) `rememberIdempotency`(235) → `idempotency_key` 테이블
  - 파생: `mode1Health`(341) `csvForBattery`(354)
- **주의**: 함수들이 동기 시그니처다. SQL로 바꾸면 전부 `Promise`가 되어 **`server.ts`의 모든 호출부가 `await`로 바뀐다.** 이 변환이 이 작업 분량의 절반이다. 한 번에 다 바꾸지 말고 리포지토리 인터페이스를 먼저 정의하고 도메인별로 옮긴다.
- **트랜잭션**: `backend/src/db.ts`의 `inTransaction()`이 이미 있다. `changeRelay`·`changeOpsStatus`·`startSession`처럼 감사로그를 같이 남기는 것은 반드시 한 트랜잭션에 넣는다.
- **동시성**: `measurement_session`에 `unique (device_id) where status='ACTIVE'`, `diagnosis`에 `unique (battery_id) where status='RUNNING'` 부분 인덱스가 이미 있다. 애플리케이션 레벨 체크에 의존하지 말고 이 제약 위반을 잡아 `409`로 변환한다.
- **완료 판정**: `AUTH_MODE=demo DATA_MODE=postgres`로 띄우고 브라우저 시나리오(로그인→자산→세션→대시보드→릴레이 차단)가 끝까지 동작. 프로세스 재시작 후 데이터 유지.

### B2. `battery_id` 세션 태깅 — **규칙은 백엔드, 실행은 Consumer**

- **현재 상태**: 에지는 `device_id`만 싣고 `battery_id`를 모른다(CLAUDE.md 센서 스키마). 적재 시점에 백엔드 세션 정보로 귀속해야 하는데, 그 적재 코드가 동료의 Consumer 안에 있다.
- **해야 할 일**: 백엔드가 **태깅 규칙을 명세로 내리고** 동료가 Consumer에 구현한다. 명세에 반드시 포함할 것:
  - `device_id` → 활성 `measurement_session` 조회 방법 (Consumer가 DB를 직접 읽을지, 백엔드가 캐시/API를 제공할지)
  - 활성 세션이 **없을 때** 도착한 프레임의 처리 (버림 / `battery_id=null`로 적재 / 보류)
  - 세션 전환 **경계 프레임** 처리 — 세션 종료 직후 도착한 늦은 프레임을 이전 세션에 붙일지
  - 시계 차이: `measured_at`(에지 시각) vs 적재 시각 중 무엇으로 세션 구간을 판정할지
- **계약 근거**: CLAUDE.md 「배터리 자산과 이력 추적」, `PLAN.md` 데이터 모델
- **완료 판정**: 세션 시작→종료 사이 프레임의 `battery_id`가 100% 채워지고, 세션 밖 프레임이 잘못 귀속되지 않음

### B3. Fail-Safe 판정 주체 — **판단·구현 모두 백엔드. 넘기지 말 것**

- **현재 상태**: 판정하는 코드가 **어디에도 없다.** 프론트엔드는 자동 차단 모달을 이미 갖고 있고(`frontend/src/App.tsx:133`·`161`) WS 핸들러도 있지만(`frontend/src/realtime/useRealtime.ts:285`), **보내는 쪽이 없다.**
- **왜 넘기면 안 되나**: 스트림이 지나가는 자리가 Consumer라 인프라 담당은 합리적으로 Consumer를 고른다. 그런데 인터락·감사로그·수동 복구 게이트는 전부 백엔드 도메인이라 안전 로직이 두 곳으로 쪼개진다. 관련 불변식이 계약에 이미 박혀 있다 — *"릴레이 자동 복구는 없다"*, *"계정 제재와 안전 감시는 분리한다"*, *"진단 중 알림은 억제하되 Fail-Safe는 억제하지 않는다"*, *"부하를 0A로 내린 다음 릴레이를 차단한다"*.
- **해야 할 일**: 백엔드가 적재된 텔레메트리(또는 A4 이상점수)를 구독해 안전 조건을 판정하고, ① `relay_state` 갱신 ② `audit_log`에 `RELAY_AUTO_CUT` 기록 ③ 에지로 차단 명령(B4) ④ WS `relay.autoCut` 푸시를 **한 흐름으로** 수행한다.
- **계약 근거**: `docs/backend_contract.md:357`(자동 차단 시 `relay.autoCut` 즉시 푸시), `:1628`(payload = `{ batteryId, batteryLabel, representativeTempC, representativeTempSource, triggerCode, cutAt }`), `:176`, `:1646`, `:1858`
- **미결정**: 온도 문턱은 모드 1이 55/60°C, **모드 2는 실측 미정**(`mode2_powerbank_diagnosis_spec.md` §8 H2). 값을 추정해 하드코딩하지 않는다.
- **완료 판정**: 조건 충족 시 모달이 뜨고, 릴레이가 `OPEN`으로 남고, 재인증·사유 없이는 복구되지 않음

### B4. 릴레이 차단 → 에지 실제 전달 — **판단은 백엔드, 프로듀서 배선은 도움 가능**

- **현재 상태**: `backend/src/store.ts:299` `changeRelay()`가 **메모리 상태만 바꾼다.** 물리 릴레이로 가는 경로가 없다.
- **해야 할 일**: 백엔드가 `battery-events` 토픽에 제어 이벤트를 발행한다. **즉 "카프카는 동료 몫"이어도 백엔드는 Kafka 프로듀서 클라이언트를 직접 쓴다 — 운영하는 것과 사용하는 것은 다르다.** 무엇을 언제 발행할지는 백엔드 도메인 판단.
- **같은 경로를 쓰는 것**: 세션 시작/종료 음성 안내 발행도 백엔드 책임이다(`docs/backend_contract.md:697`, `[PLAN: S-VOCALR]`).
- **완료 판정**: 백엔드 차단 승인 → 라즈베리파이 릴레이가 실제로 열림 → 결과가 `battery-events`로 되돌아와 상태가 일치

## 4. C군 — 백엔드·프론트 몫 (Kafka·DB 무관)

### C1. WebSocket 실시간 발신 — **완료(2026-08-25)**

프론트엔드가 처리하는 이벤트 **11종** 중 **8종을 실제로 발신한다.** `metrics.tick`·`anomaly.score`는 전역 활성 세션의 배터리에 대해 **매초** 실제 저장값을 push하고(현재 그 값을 사후에 바꾸는 코드가 저장소 어디에도 없어 지금은 정적값 반복이며, 이는 이번 계획의 범위 밖인 AI 추론 연동이 끝나야 움직인다 — 의도된 상태), `anomaly.gradeChanged`·`alert.created`는 등급 전이 감지와 `titleCode: "ANOMALY_GRADE_ESCALATED"` 알림 생성까지 배선은 맞았지만 같은 이유로 지금은 휴면이다. `event.created`는 릴레이 차단/복구 등 실제 액션에서 발신되고, `session.ended`는 세션이 상위 세션에 의해 대체되거나 관리자가 활성 배터리를 차단할 때 발신된다 — 이를 위해 `broadcast()`의 전달 게이트를 고쳤다(아래 참조). `subscribe`/`resume`은 더는 no-op ACK가 아니라 1만 건 링버퍼에서 실제로 누락 이벤트를 재전송하고, 커서가 버퍼에서 밀려났으면 `resync.required`를 정확히 반환한다.

| 이벤트 | 프론트 핸들러 | 계약 | 상태 |
|---|---|---|---|
| `metrics.tick` | `useRealtime.ts:246` | `backend_contract.md:1597`·`:1624` | ✓ (휴면 — 위 참조) |
| `anomaly.score` | `:255` | `:1625` | ✓ (휴면 — 위 참조) |
| `anomaly.gradeChanged` | `:266` | `:1626` | ✓ (휴면 — 위 참조) |
| `relay.changed` | `:271` | — | ✓ |
| `relay.autoCut` | `:285` | `:1628` (B3) | ✗ |
| `alert.created` | `:290` | `:1629` | ✓ (휴면 — 위 참조) |
| `event.created` | `:291` | `:1630` | ✓ |
| `session.ended` | `:292` | `:1631` | ✓ |
| `diagnosis.progress`/`.done`/`.aborted` | `:297` | `:1633` | ✗ |
| `resync.required` | `:309` | `:1638` | ✓ |

- **`relay.autoCut`은 이번 계획에서 시도하지 않았다** — B3(Fail-Safe 판정 로직)가 저장소 어디에도 없어 이 이벤트를 트리거할 실행 경로 자체가 없다. B3을 먼저 구현할 것.
- **`diagnosis.progress`/`.done`/`.aborted`도 시도하지 않았다** — `store.ts`의 `F21_THRESHOLDS.configured`가 하드코딩 `false`라 `startDiagnosis`가 항상 `409 SAFETY_PROFILE_NOT_READY`를 던지고, 진단 진행을 시뮬레이션할 도달 가능한 코드 경로가 없다. 이 플래그를 켜는 작업(§8 H2 등 안전 문턱 확정)이 선행돼야 한다.
- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 서버가 **1초 단위로 다운샘플링**해 푸시한다(`:1643`). 페이로드는 `GET /api/dashboard`의 `metrics`와 **동일 구조**(각 지표 `{ value, status }` + `measuredAt`).
- **`relay.autoCut`을 `relay.changed`에 섞지 않는다**(`:1646`) — 사용자 차단과 구분이 안 된다.
- **`anomaly.gradeChanged`는 등급 전이에서만**(`:1647`), **`diagnosis.progress`는 단계 전환에서만**(`:1648`) 보낸다.
- **`session.ended` 전달 게이트 수정**: `broadcast()`가 원래 "배터리가 여전히 현재 활성 상태"를 요구해 배달했는데, `session.ended`는 정의상 "방금 활성 상태를 벗어난 배터리"에 관한 이벤트라 이 조건으로는 영구히 배달 불가능이었다. `session.ended`에 한해 `client.batteryId === batteryId`만 요구하도록 특별 처리해 해결했다.
- 봉투 형식과 `sequence`/`cursor`는 이미 `server.ts:878`(`wsEnvelope`)에 구현돼 있으니 재사용한다.
- **완료 판정**: 대시보드를 열어둔 채 값이 1초마다 갱신되고, 등급 전이·알림·이벤트가 새로고침 없이 반영됨 — **충족.** (단, 등급 전이·알림은 점수가 실제로 바뀌어야 관찰 가능하므로 AI 추론 연동 전까지는 육안 확인이 어렵다.)

### C2. `DEMO_MODE` → `AUTH_MODE` + `DATA_MODE` 분리 — **완료(2026-08-25)**

`DEMO_MODE`는 저장소에서 완전히 제거됐다(`grep -rn "DEMO_MODE" backend/src`가 0건). 대신 서로 독립인 두 변수로 쪼갰다.

- `AUTH_MODE=demo|betterauth`(기본 `demo`), `DATA_MODE=memory|postgres`(기본 `memory`).
- `GET /health`가 `{ status, auth, data }`를 반환하도록 바뀜 — 지금 어떤 조합으로 떠 있는지 즉시 보인다.
- `/api/*` 도메인 게이트는 **`DATA_MODE`만 본다**: `memory`면 열려 인메모리 데모 스토어를 정직하게 서빙하고, `postgres`면 여전히 `503 RUNTIME_NOT_READY`다 — 실측으로 양방향 확인했다.

**⚠️ 이 게이트는 의도된 것이지 미완성이 아니다.** `store.ts`를 대체할 실 PostgreSQL 리포지토리(B1)가 아직 없으므로, `DATA_MODE=postgres`가 게이트를 열면 "실 DB"라는 라벨을 달고 조작된 인메모리 데이터를 내보내게 된다. **B1이 끝나기 전까지 `DATA_MODE=postgres`는 계속 503이어야 정상이다.** "당면 목표 조합 `AUTH_MODE=demo` + `DATA_MODE=postgres`"는 이 문서가 세워질 때부터 B1 완료를 전제로 한 목표였고, 이번 계획(C1/C2/C3)은 B1을 건드리지 않았으므로 아직 도달하지 않았다.

**⚠️ 새로 발견된 실제 갭 — 이번 계획에서 고치지 않음**: WebSocket upgrade 핸들러의 데모/프로덕션 분기 선택이 **`AUTH_MODE`만 보고 `DATA_MODE`를 전혀 보지 않는다.** 즉 `AUTH_MODE=demo`로 데모 인증에 성공한 WS 연결은 `DATA_MODE=postgres`여도 그대로 성공해 (데모) 데이터를 계속 스트리밍한다 — REST가 갖는 "`DATA_MODE=postgres`면 fail-closed" 보장이 WebSocket에는 확장되지 않는다. `backend/README.md`에 이미 명시적으로 기록해뒀지만 **고치지는 않았다.** WS upgrade 경로에 `DATA_MODE` 체크를 추가하는 건 이번 계획 범위 밖의 실제 설계 과제이며, 아래 C2b(프로덕션 WebSocket 인증, 이 문서에 이미 별도로 보류 처리돼 있던 항목)와 묶어 다음에 처리하는 게 자연스럽다.

**주의**: Better Auth 코드와 `/api/auth/*` 라우트는 **삭제하지 않았다**(2026-08-25 결정 유지). `AUTH_MODE=betterauth`로 바꾸면 켜지는 상태로 남아 있다. 데모 쿼리 토큰(`access_token`)은 `AUTH_MODE=betterauth`에서 **절대 허용하지 않는다**(`backend/README.md`).

**완료 판정**: 메커니즘(변수 분리·`/health`·REST 게이트)은 실측 완료. **`AUTH_MODE=demo DATA_MODE=postgres`로 브라우저 시나리오가 끝까지 도는 것은 B1이 끝나야 성립**하며 아직 아니다 — 이 완료 판정 문장은 B1 완료 시점의 기준으로 남겨둔다.

### C2b. production 인증 경로 (WebSocket) — **보류(의도적)**

- **현재 상태**: `DEMO_MODE=false`이면 upgrade 핸들러가 Better Auth 세션을 확인한 **뒤에도 그냥 `socket.destroy()`** 한다(과거 `backend/src/server.ts:945-948`; C2에서 `DEMO_MODE`가 제거되며 이 분기는 `AUTH_MODE`를 보도록만 갱신됐고 실제 구독 경로 연결은 손대지 않았다).
- Phase 1 인증 보류 결정에 따라 **지금 하지 않는다.** C2에서 `AUTH_MODE`로 분기만 정리해두고, 나중에 인증을 켤 때 이 분기를 실제 구독 경로로 연결한다.
- **위 C2의 "새로 발견된 실제 갭"(WS가 `DATA_MODE`를 안 봄)을 되살릴 때 같이 처리하는 것을 권장한다** — 둘 다 WS upgrade 핸들러의 같은 분기 지점을 고치는 작업이라 따로 하면 두 번 건드리게 된다.

### C3. REST 미구현 — **완료(2026-08-25), 잔여 1건은 범위 밖 확정**

| 엔드포인트 | 계약 | 현재 |
|---|---|---|
| `POST /api/account/email-availability` | `backend_contract.md:467` | **✓ 구현·실측 완료** — 회원가입 이메일 중복확인 |
| `POST /api/exports` + `GET /api/exports/{id}` + `GET /api/exports/{id}/download` | `:904`·`:905` | **✓ 구현·실측 완료** — QUEUED→READY 비동기 잡 전체 생애주기를 서명·시한부 다운로드 URL과 함께 구현. 멱등성·소유권 검증까지 end-to-end 실측 |
| `GET /api/trends/export.pdf` | `:907` | 503 스텁 (`server.ts:832`), **변경 없음** — PDF 생성이 새 의존성을 요구해 이번 라운드는 명시적으로 범위 밖 |

### C4. 음성 안내 설정 `/api/settings/voice-alert`

- **현재 상태**: 백엔드 라우트 없음, 프론트 화면도 없음.
- **계약 근거**: `backend_contract.md:1086`·`:1113`·`:1134`, `REQ-WEB-072`. *"v3 어느 화면에도 없다. 그러나 `PLAN.md`에 모델·API가 이미 확정돼 있고 에지 하드웨어 동작과 직결되므로 계약에 포함한다. 프론트가 설정 화면에 탭 또는 섹션을 새로 만들어야 한다."*
- 필드 정의는 `PLAN.md`에 있다. 전체 ON/OFF·음량·카테고리 5종.

### C5. 카카오톡 알림 발송 — **보류(의도적), 추가 작업 없음**

- **현재 상태**: 채널 ON/OFF 토글과 policy 응답만 있다(`server.ts:405`·`:409`). 실제로 메시지를 보내는 코드는 `backend/src`에 없다.
- **2026-08-25 결정**: 발송을 구현하지 않는다. **설정 화면의 토글은 현행 유지** — 저장은 되지만 아무 일도 일어나지 않고, 화면에 미구현 표시를 **추가하지 않는다.** 즉 이 항목에 지금 할 일은 없다.
- ⚠️ **시연 주의**: 화면상 토글이 정상으로 보이므로 "알림이 간다"고 설명하면 사실과 다르다.
- 나중에 되살릴 때 필요한 것(지금 하지 않음): 이상점수/이벤트 → 채널 정책(`sendOn: ["DANGER","WARNING"]`, `smsOnlyDanger`, `dedupeWindowMinutes: 5`) 적용 → Kakao API 발송 → 결과 기록. **서버는 사용자 문구를 만들지 않는다는 규칙(CLAUDE.md API 계약)의 예외가 필요하다** — 수신자가 웹 프론트가 아니라 서버가 문장을 만들어야 한다.

### C6. `?metric=` 배선 (소)

- **현재 상태**: `/api/dashboard`가 `metric` 쿼리를 보내지 않는다 — `frontend/src/api/hooks.ts:33`, `frontend/src/realtime/useRealtime.ts:168`·`:179`. 그래서 지표 선택이 서버 시리즈를 바꾸지 못하고, 큰 차트는 선 색만 바뀐다.
- **계약 근거**: `backend_contract.md:755` — *"`quickTrend.metric`은 `volt|curr|temp|soc` 중 프론트가 선택. 쿼리 `?metric=temp`로 지정."*
- **연관**: 2026-08-25에 미니 스파크라인을 실데이터 기반으로 고치면서(`UserPages.tsx`) 이 배선은 남겨뒀다. 배선하면 선택한 카드에 실제 선이 그려진다.

### C7. 전류 부호 표기 — 추세 차트 (판단 필요)

- **현재 상태**: 빠른 추세 카드와 배터리 상세는 2026-08-25에 `magnitude()`로 부호를 제거했다. 그러나 배터리 상세의 **추세 차트는 전류 Y축이 여전히 음수**(`TrendCharts`).
- **판단이 필요한 이유**: 시계열에 `abs()`를 걸면 충전→방전 전환이 가짜 V자로 접혀 CLAUDE.md가 지키라는 충·방전 구분이 오히려 깨진다. 축 라벨을 `A (+충전 / −방전)`로 명시하는 쪽이 유력하나 확정 전이다.

### C8. 로컬 실행 패키징 (구 Phase 7 배포)

AWS 배포는 삭제됐지만, 호스트 PC 1대에서 **재현 가능하게 묶는** 작업은 남는다.

- **프론트 production 빌드를 백엔드가 정적 서빙한다.** 지금은 `5173`(Vite) ↔ `3005`(Express) 두 오리진이라 CORS 설정(`server.ts:50-55`)과 쿠키 도메인 문제를 계속 안고 간다. `vite build` 산출물을 Express가 서빙해 **단일 오리진(:3005)** 으로 만들면 이 문제가 통째로 사라진다. SPA라 알 수 없는 경로는 `index.html`로 폴백해야 한다(`/dashboard` 직접 접속이 404가 되지 않도록).
- **프로세스 자동 시작·재시작** — Kafka·PostgreSQL·추론·백엔드. 시연 중 크래시나 PC 재부팅에서 복구되어야 한다.
- **`.env` 템플릿과 시드 데이터 절차** — 다른 PC에서도 같은 절차로 뜨는지 확인한다.
- **완료 판정**: PC를 재부팅해도 브라우저에서 `localhost:3005` 하나로 전체 시나리오가 동작.

## 5. D군 — 404지만 정상 (착각 방지)

**아래를 "미구현"으로 세지 말 것.** 계약이 명시적으로 만들지 말라고 했거나 다른 것으로 교체 확정된 항목이다.

| 엔드포인트 | 왜 없어야 하나 |
|---|---|
| `GET /api/devices` | v3에 마크업만 있고 전환 코드가 없는 **고아 라우트**. `REQ-WEB-030/031`은 구현 대상 아님 (CLAUDE.md API 계약) |
| `GET /api/calibrations` | `backend_contract.md:1145` — *"`GET /api/calibrations`를 만들지 않으며, 프론트는 해당 섹션을 제거한다"* (§12-21) |
| `POST /api/relay/kill-switch/confirm` | `:1049` — `POST /api/relay/cut`으로 **교체 확정**. 기존 구현은 `202`만 반환하던 스텁 |
| `PATCH /api/me/notification-preferences` | 정본은 `/api/settings/alerts`(`:1082`·`:1115`·`:1132`). `:1798`의 표기는 낡은 것 |
| `/api/settings/thresholds` | 임계치 설정 기능은 **제거 확정**. 등급 임계값은 시스템 고정 0.3/0.6/0.8 |

## 6. 착수 순서 제안

1. ~~**B군 4건의 담당을 문서로 확정한다**~~ — 코드보다 먼저. 특히 B3(Fail-Safe)는 넘기지 않는다.
2. ~~**C1 WebSocket 발신**~~ — **완료(2026-08-25).** 8/11종 발신, 링버퍼 재전송 포함. 잔여는 `relay.autoCut`(B3 선행)·`diagnosis.*`(F21 안전 프로필 선행).
3. ~~**C2 `AUTH_MODE`/`DATA_MODE` 분리**~~ — **완료(2026-08-25).** 단 `DATA_MODE=postgres`는 B1이 끝날 때까지 계속 503이 맞다. WS upgrade가 `DATA_MODE`를 안 보는 갭이 새로 발견됐다(§4 C2 참조, 미수정).
4. **B1 리포지토리 교체** — **다음 우선순위.** 분량이 가장 크다(`store.ts` 전체 + 동기→비동기 전환). A-1 담당자의 A2와 병렬 진행 가능. C2가 끝나 `AUTH_MODE=demo DATA_MODE=postgres` 조합의 배선은 준비돼 있으니, B1이 끝나는 즉시 이 조합이 실제로 열린다.
5. **B3·B4 안전 경로** — A2/A4가 데이터를 주기 시작한 뒤. B3이 끝나면 C1의 `relay.autoCut`도 같이 닫힌다.
6. ~~**C3 REST 미구현**~~ — **완료(2026-08-25).** `email-availability`·`exports` 계열 구현·실측 완료. `export.pdf`는 범위 밖 확정으로 남김.
7. **C8 로컬 실행 패키징** — 시연 리허설 전에 끝나야 한다. 단일 오리진 전환은 CORS·쿠키를 건드리므로 마지막에 몰아서 하지 말 것.
8. **C4·C6·C7, 그리고 WS의 `DATA_MODE` 인지(C2 갭)** — 나머지. (C2b·C5는 보류)

### 지금 하지 않기로 한 것

| 항목 | 이유 | 되살릴 때 |
|---|---|---|
| Better Auth 실인증 (C2b) | Phase 1 보류 결정 | `AUTH_MODE=betterauth`로 전환 + WS upgrade 분기 연결 |
| WS upgrade의 `DATA_MODE` 인지 (C2 갭, 2026-08-25 신규 발견) | 이번 계획(C1/C2/C3) 범위 밖. `AUTH_MODE=demo`이면 `DATA_MODE=postgres`여도 WS가 열려 데모 데이터를 계속 스트리밍한다 — REST의 fail-closed가 WS에는 확장 안 됨 | WS upgrade 핸들러에 `DATA_MODE` 체크 추가. C2b(프로덕션 WS 인증)와 같은 지점을 고치므로 함께 처리 권장 |
| 카카오톡 발송 (C5) | Phase 6 보류 결정 | 토글은 이미 있으니 발송 경로만 추가 |
| AWS 배포 | 로컬 단일 PC 구성 | 해당 없음 |
| `POST /api/account/email-availability`·`email-lookup`의 Origin 검증·rate-limit·감사 이벤트 부재 (2026-08-25 최종 리뷰 신규 발견) | 이번 계획이 만든 갭이 아니라 두 엔드포인트가 원래부터 갖고 있던 것. 계약이 요구하는 보호를 붙이려면 전용 보안 인프라(요청 Origin 검증 미들웨어, rate-limit 저장소, 감사로그 연결)가 먼저 필요해 이번 수정 라운드 범위를 넘는다 | Origin 검증·rate-limit·감사 이벤트를 두 엔드포인트에 함께 추가(하나만 고치면 다시 벌어진다) |
| 알림 채널 정책의 `dedupeWindowMinutes: 5`(`GET /api/settings/alerts`) 미적용 | 반복 알림을 실제로 눌러줄 코드가 없다. 오늘은 `battery.latest.score`를 사후에 바꾸는 코드가 없어 휴면 상태라 관찰 자체가 불가능 | AI 추론 연동으로 실 이상탐지 데이터가 흐르기 시작할 때, `alert.created` 발신 직전에 dedupe 로직을 추가 |
| `exports.ts`의 `ExportStatus`에 `EXPIRED`가 있지만 어떤 코드도 잡을 이 상태로 전이시키거나 오래된 완료 잡을 정리하지 않음 | 현재 인메모리 데모 규모(잡 몇 개)에서는 실질적 문제가 없다. 다만 상태 enum이 구현이 실제로 지키는 것보다 많은 것을 약속하고 있다 | 만료 스윕(주기적 `setInterval` 또는 다운로드 시점 지연 평가)을 추가하거나, 그럴 계획이 없다면 enum에서 `EXPIRED`를 빼는 쪽을 판단 |

> `backend/dist/`는 빌드 산출물이며 구현 근거로 세지 않는다.
