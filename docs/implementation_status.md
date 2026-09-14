# 구현 상태 및 문서 지도

> 기준일: **2026-09-14** (직전 갱신 2026-08-25). 아래 표는 브라우저·curl·테스트 실제 실행으로 재확인했다.

이 문서는 설계 문서의 요구사항과 현재 저장소에 실제로 존재하는 구현을 구분하기 위한 실행용 지도다. 요구사항의 정본이 아니며, 상세 계약은 아래 링크의 원본 문서를 따른다.

> **남은 작업을 담당자별로 나눈 상세 목록은 이 문서 맨 아래 [「남은 작업과 담당 경계」](#남은-작업과-담당-경계)에 있다.** 아래 표는 현황 요약이고, 그쪽이 실행 목록이다.

## 2026-08-25 범위 결정 — 먼저 읽을 것

이 네 가지가 이후의 모든 판단을 바꾼다. `CLAUDE.md`·`PLAN.md`에도 같은 날짜로 반영했다.

1. **전 구성이 호스트 PC 1대에서 로컬로 돈다. AWS EC2는 쓰지 않는다.** 에지만 같은 LAN의 별도 장비다. Kafka는 LAN 한정 PLAINTEXT이며 TLS/SASL을 쓰지 않는다.
2. **Google Colab은 학습 전용이고 실시간 경로에 없다.** 로컬 Kafka가 NAT 뒤라 Colab이 인바운드로 못 붙기 때문이다. 체크포인트를 내려받아 호스트 PC의 **로컬 추론 프로세스**가 로드한다. 이 프로세스는 **별도 담당자**가 만든다.
3. **Phase 1 Better Auth 실인증은 보류한다.** 코드는 남기고 `AUTH_MODE=demo`로 꺼둔다. 데모 계정에 ADMIN이 있어 RBAC·감사로그 시연에는 지장이 없다.
4. **Phase 6 카카오톡 발송은 보류한다.** 설정 화면의 채널 토글은 **현행 유지** — 저장은 되지만 발송은 일어나지 않고, 화면에 미구현 표시를 추가하지 않는다. ⚠️ 시연에서 "알림이 간다"고 설명하지 않도록 주의.

## 2026-09-14 PostgreSQL 저장소 갱신

`backend/src/store/postgres.ts`가 `CellGuardStore` 전체를 구현했고, `store.ts`는
`DATA_MODE=postgres`에서 이 구현체를 선택한다. `initializeStore()`는 서버가
listen하기 전에 migrations `000`~`007`의 핵심 스키마와
`diagnosis.progress_snapshot`을 확인하며, 실패 시 memory 데이터로 대체하지
않고 기동을 중단한다. `telemetry_metric.raw_payload`도 확인한다.
`advanceDiagnosis`의 진행 상태는 런타임 메모리에 유지하고 phase 경계에서만
`progress_snapshot`에 저장한다.

`backend/src/telemetryConsumer.ts`는 `battery-raw-metrics` version-1 raw
frame을 PostgreSQL transaction으로 적재한다. 활성 세션은 `device_id`로
조회해 DB 소유의 `battery_id`·`session_id`를 붙이고, 세션이 없으면 두 값을
`null`로 보존한다. `(device_id, measured_at)` 충돌은 replay 성공으로
처리하며, `battery_latest`는 더 최신 timestamp일 때만 갱신한다. 서버는
`DATA_MODE=postgres`이고 `KAFKA_CONSUMER_ENABLED=true`이며
`KAFKA_ENABLED=true`일 때만 Consumer를 시작한다.

PostgreSQL 계약·동시성 테스트는 `TEST_DATABASE_URL`이 설정된 경우에만 실제
DB를 초기화해 실행한다. 현재 실행 환경에는 이 변수가 없어 명확한 skip 1건을
남기고, DB 연결 없이 unit/메모리 테스트를 통과했다.

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
| 백엔드 데모 도메인 API | `backend/src/server.ts`: 발급 토큰 인증, 사용자·관리자 REST 라우트(`/health`·`/api/demo/*` 포함), 계약형 대시보드, F21 fail-closed, 릴레이 승인·재인증·멱등성, Raw CSV. 게이트 실동작 확인(`409 BATTERY_BLOCKED`/`NO_ACTIVE_SESSION`, `401 REAUTH_REQUIRED`, `ACK_REQUIRED`, 관리자 `403`) | **데모 런타임 구현·실 REST 브라우저 검증 완료** |
| 백엔드 도메인 데이터 저장 | `backend/src/store/contract.ts`의 `CellGuardStore`, `memory.ts` 참조 구현, `postgres.ts` PostgreSQL 구현, `store.ts`의 `DATA_MODE` 분기. PostgreSQL은 자산 최신값·릴레이·진단·건강 집계·텔레메트리 CSV를 읽고, 상태+감사 변경을 트랜잭션으로 처리한다 | **구현 완료 / TEST_DATABASE_URL 설정 시 실 DB 계약 검증** |
| 백엔드 실시간 스트림 (WS 발신) | **C1 완료(2026-08-25).** 프론트가 처리하는 11종 중 `metrics.tick`·`anomaly.score`·`anomaly.gradeChanged`·`relay.changed`·`alert.created`·`event.created`·`session.ended`·`resync.required` 8종이 실제로 발신되고, `subscribe`/`resume`이 1만 건 링버퍼로 실제 재전송을 수행한다. 단 `metrics.tick`·`anomaly.score`·`anomaly.gradeChanged`·`alert.created`는 이 저장소 안에 `battery.latest.score`를 사후에 바꾸는 코드가 아직 없어 **매초 같은 값을 반복 push하는 휴면 상태**다(AI 추론 연동 후 살아난다) — 이는 버그가 아니라 현재 범위의 자연스러운 결과다. `relay.autoCut`은 **구현됨(문턱 미설정이라 휴면)**(B3 완료, §4 C1 참조), `diagnosis.progress`/`.done`/`.aborted`는 여전히 미발신 | **구현됨(부분 휴면)** — 잔여 `diagnosis.*`(→ F21 안전 프로필) |
| 에지 명령 경로 | `backend/src/device/port.ts`(`DeviceCommandPort` 인터페이스, 메서드 4개) + `backend/src/device/logging.ts`(로깅 스텁 — 콘솔에만 남기고 실제 전송 없음) + `backend/src/kafka.ts`(version 1 wire contract·Zod 검증·파티션 키). `SESSION_ENDED`도 `batteryId`를 payload·파티션 키에 포함하도록 계약을 고정했다. `battery-events` 발행을 실제로 수행하는 Kafka 구현체는 인프라 인계(`docs/handover/infra-implementations.md` 2부) — dual-write outbox 배선은 미구현 | **wire contract + DeviceCommandPort + 로그 스텁 / Kafka 구현체 대기** (→ B4) |
| 백엔드 DB 도메인 provider·Consumer·TimescaleDB | `backend/migrations/000_identity.sql`~`007_telemetry_raw_payload.sql`, `postgres.ts`, `telemetryConsumer.ts`. Raw Consumer는 session tagging·raw payload·단조 latest·수동 offset commit·프레임별 Fail-Safe hook을 구현했고, `TEST_DATABASE_URL`이 없으면 실 DB 계약 테스트는 skip한다. Timescale 실측과 anomaly Consumer는 별도다. `AUTH_MODE=betterauth`의 WS 인증은 여전히 보류되고, WS upgrade가 `DATA_MODE`를 별도로 검사하지 않는 갭은 남아 있다 | **Raw Consumer 구현 / 실 Kafka·DB 인수 검증 대기** |
| 알림 발송 (카카오·SMS·메일) | 채널 ON/OFF 토글과 policy 응답만 있고(`server.ts:405`·`:409`), **실제로 메시지를 보내는 코드는 `backend/src`에 없다** | **보류(의도적)** — 토글 현행 유지, 추가 작업 없음 |
| AI 로컬 추론 프로세스 | 코드 없음. `ai/` 디렉터리도 없다. 학습(Colab)·체크포인트 반출 절차·추론 프로세스 모두 미착수 | 미착수 — **별도 담당자** |
| 로컬 실행 패키징 | **C8 완료(2026-08-25)** — 단일 오리진(`:3005`), `start-local.bat`(Windows, 수동 실행), `docs/local_run.md`. memory 모드 한정(Kafka·PostgreSQL·추론은 별도) | 완료 (memory 모드) |
| 에지 소프트웨어 | `edge/bw150/`에 BW150 HID 로거·탐지·BLE 프로브(914줄)만 있고, 센서·릴레이·Kafka 프로듀서 구현은 없음 | 부분 구현 (BW150 한정) |
| AI 소프트웨어 | 모델 설계는 있으나 `ai/` 디렉터리, Colab 노트북, 학습·추론·Kafka 연동 구현은 없음 | 미착수 |
| 프론트엔드 | [`frontend/src/`](../frontend/src/)의 Vite + React + TypeScript strict 앱, v3 사용자 15·관리자 6 라우트, 계약형 API/WS 계층, MSW 시나리오, `npm run dev:real` 데모 경로. WS 이벤트 11종 핸들러 중 **9종이 서버 발신을 실제로 수신**(C1 8종 + B3의 `relay.autoCut`), 잔여 `diagnosis.*` 2종은 F21이 fail-closed라 도달 불가 | 부분 구현 / production WS 인증 미착수 |
| 프론트엔드 실행 기반 | `frontend/package.json`, React Router, Query, RHF/Zod, 토큰 CSS, 공용 UI, Vitest/RTL/Playwright. **Vitest 44건·Playwright 28건·`tsc --noEmit` 통과**(2026-08-25 실행) | 구현됨 |
| 미구현 REST·화면 | **C3 완료(2026-08-25)**: `POST /api/account/email-availability`, `POST /api/exports`+`GET /api/exports/{id}`+`GET /api/exports/{id}/download`(QUEUED→READY 비동기 잡, 서명·시한부 다운로드 URL, 멱등성·소유권 검증까지 실측 완료). **C4 완료(2026-08-25)**: `GET`/`PATCH /api/settings/voice-alert` + 설정 화면 새 탭. 남은 것은 `GET /api/trends/export.pdf`(503 스텁 — PDF 생성에 새 의존성이 필요해 이번 라운드는 범위 밖으로 확정) | 부분 구현 — 잔여 `export.pdf`(범위 밖 확정) |
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

데모 계정은 memory mode에서는 `backend/src/store/memory.ts:30`~`35`, PostgreSQL
mode에서는 migrations `000_identity.sql`·`002_domain_gaps.sql`에 있다 —
`hong@cellguard.io`(USER) / `lee@lab.io`(ADMIN) / `park@test.io`(SUSPENDED),
비밀번호는 모두 `demo-password`. `PACK-001`은 `opsStatus: BLOCKED`라 세션을
시작할 수 없으니(의도된 게이트) memory 시연에는 `DEMO-PACK-001`을 쓴다.

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
| Phase 3 스트리밍 | Consumer·세션 태깅·적재·오프셋 | Raw Consumer·세션 태깅·적재·오프셋 구현 / 실 Kafka·Timescale 인수 및 anomaly Consumer 대기 |
| Phase 4 AI | 데이터셋·특징·AE·Informer·추론 | 미착수. **추론이 Colab에서 호스트 PC로 내려왔고 별도 담당자 몫** |
| Phase 5 웹 | React 초기화·라우팅·화면·관리자 | 부분 구현. v3 화면·계약 계층·mock QA·localhost demo REST 연결 완료. **WS 서버 발신이 1/11종 → 8/11종으로 확장**(C1, 2026-08-25)됐으나 잔여 2종은 각각 B3·F21 안전 프로필 선행. production DB provider 통합(B1)은 구현 완료, 실 DB 인수 검증 대기 |
| Phase 6 알림·차단 | 카카오·Fail-Safe·음성 설정 | **카카오는 보류(의도적).** Fail-Safe 판정·구독 배선은 구현됐고 실측 문턱이 대기 중이며, 음성 설정은 API·화면 모두 없음 |
| Phase 7 통합·**로컬 실행 패키징** | E2E·시나리오·실행 묶기 | **로컬 실행 패키징은 C8로 완료(2026-08-25)**. **AWS 배포 항목은 삭제**(클라우드 미사용). 프론트 단독 E2E(Playwright 29건, C8에서 1건 추가)는 동작 |

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

1. **화면·동작의 정본은 `frontend/` 구현이다(2026-08-28 확정).** 예전 정본이던 `설계 산출물/셀가드 프로토타입_v3.html`은 폐기됐다 — 이 문서에 남은 `[v3 실측]` 인용은 당시 근거 표시이지 "지금 v3를 보라"는 뜻이 아니며, v3와 `frontend/`가 다르면 `frontend/`가 맞다. 충돌 해소 순서는 `CLAUDE.md` §충돌 해소 순서. 단 화면이 존재한다는 것이 **실제 REST·안전 제어 구현 완료를 뜻하지는 않는다.**
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

## 1. 지금 실제로 돌아가는 것 (2026-09-14 실측, C1/C2/C3/B1 반영)

- `backend` 타입체크·빌드 통과 + Vitest **235건 통과, 1건 명시적 skip**(PostgreSQL URL 부재), `frontend` 타입체크 통과 + Vitest 44건 + Playwright 28건, `contract_lint.py` 위반 0건.
- `AUTH_MODE=demo DATA_MODE=memory` + `npm run dev:real`로 브라우저에서 로그인 → 자산 게이트 → 세션 시작 → 대시보드까지 실제 REST/WS로 동작. 콘솔 에러 없음. (`DEMO_MODE`는 C2에서 완전히 제거됐다 — 아래 참조.)
- 서버측 게이트 실동작 확인: `409 BATTERY_BLOCKED`, `409 NO_ACTIVE_SESSION`, `401 REAUTH_REQUIRED`, `ACK_REQUIRED`, USER의 관리자 API `403`.
- **C1**: WebSocket이 `relay.changed` 1종에서 8종 발신으로 확장됐다(§4 C1). **C2**: `DEMO_MODE` → `AUTH_MODE`/`DATA_MODE` 분리 완료. **C3**: `email-availability`·`exports` 계열 REST 2건 신규 구현.

**브라우저 실측 시나리오는 여전히 `DATA_MODE=memory` 기준이다.** 다만 B1
provider·분기·기동 스키마 검사가 구현됐고, 실제 PostgreSQL 계약/경쟁 검증은
`TEST_DATABASE_URL`이 제공된 환경에서 추가로 실행해야 한다. Kafka Consumer,
Timescale 적재, 물리 Fail-Safe는 여전히 별도 범위다.

## 2. A군 — 타 담당자 몫

### A-1. Kafka·DB 담당

| # | 항목 | 완료 판정 |
|---|---|---|
| A1 | 호스트 PC에 Kafka 설치·토픽 3개 생성, LAN 한정 PLAINTEXT | 에지·추론·백엔드가 LAN에서 접속 성공 |
| A2 | `battery-raw-metrics` Consumer → `telemetry_metric` 적재 | version-1 frame이 session tagging·raw payload와 함께 테이블에 초 단위 지연으로 쌓임 |
| A3 | TimescaleDB 하이퍼테이블·압축·보존정책 (`telemetry_metric`) | 100ms × 다중 세션 부하에서 조회 지연 확인 |
| A4 | `battery-anomaly-alerts`(추론 결과) Consumer | 이상점수·AE/Informer 개별 점수·파생 온도가 적재됨 |
| A5 | Consumer 오프셋·재처리·중복 방지 | DB transaction 이후에만 offset commit, `(device_id, measured_at)` replay 무해 |

> ⚠️ **`advertised.listeners`를 `localhost`로 두면 라즈베리파이가 못 붙는다.** 브로커가 클라이언트에게 자기 주소를 되돌려주는 값이라, `localhost`면 에지가 자기 자신에게 접속을 시도하며 조용히 실패한다. 호스트의 LAN IP로 잡는다.

> **✅ Raw A2/A5 구현에 필요한 스키마가 반영됐다** — 추론 결과 적재 테이블, `age_ms`·`temp_points`·`mode`·`soc_basis`, TimescaleDB 하이퍼테이블, 진단기(`device`) 테이블, 중복 방지 키, `battery_asset.memo`, `diagnosis.progress_snapshot`, `telemetry_metric.raw_payload`가 `backend/migrations/002`~`007`에 있다. 실 Kafka·PostgreSQL/Timescale 인수 검증과 anomaly Consumer는 남아 있으며, 결정 기록은 [`docs/handover/schema-open-questions.md`](handover/schema-open-questions.md)다.

> ✅ **마이그레이션 실행 선행 문제는 해소됐다** — `000_identity.sql`이 `"user"` 테이블과 데모 seed를 먼저 만들고, `001`~`007`이 파일명 순서대로 적용된다. 실행기는 [`docs/handover/infra-implementations.md` §3-1·§4](handover/infra-implementations.md)를 따른다.

> 스키마의 정본은 `backend/migrations/000_identity.sql`~`007_telemetry_raw_payload.sql`이다. `001`의 기존 8개 테이블과 `002`~`007`의 추가 테이블·컬럼은 `store.ts` 타입과 완전한 1:1이 아니므로, **스키마를 바꾸면 `store.ts` 타입도 같이 바꾸고 반드시 합의 후 변경한다.**

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

### B1. `store.ts` → PostgreSQL 리포지토리 교체 — **구현 완료(2026-09-14) / 실 DB 인수 검증 대기**

사실 회색지대가 아니다. 버전 충돌(`version` 컬럼), 멱등성 키, `opsStatus` 게이트, 소유자 스코프가 전부 백엔드 계약이라 **DB를 쓰는 애플리케이션 코드**다.

**1단계(백엔드, 완료) 산출물**:
- 인터페이스 `backend/src/store/contract.ts` — `CellGuardStore`. 에러는 `throw new Error("<CODE>")`, 반환값 방어 복사, 감사 로그 동반 메서드(`changeRelay`·`engageFailsafe`·`changeOpsStatus`·`saveMemo`·`changeUserStatus`·`startSession`)는 원자적이어야 한다는 규칙을 명문화.
- 인메모리 구현체 `backend/src/store/memory.ts` — 위 인터페이스를 만족하는 참조 구현. 데모 시드(`hong`/`kimeng`/`leelab`/`parktest`, `PACK-001`~`005`, `DEMO-PACK-001`)를 포함.
- facade `backend/src/store.ts` — 기존 호출부 이름을 유지한 채 `active.<method>.bind(active)`로 위임하고 `DATA_MODE=memory|postgres`에 따라 구현체를 선택한다. PostgreSQL은 listen 전에 핵심 스키마를 검사하며 실패 시 기동하지 않는다.
- 계약 테스트 20건 — `backend/src/store/contract.test.ts`의 `runStoreContractTests()`가 `TEST_DATABASE_URL`이 있을 때 PostgreSQL에도 같은 스위트를 적용한다. DB가 없는 환경에서는 연결 없이 명시적으로 skip한다. 별도 테스트는 전역 active-session unique 경합을 `Promise.allSettled`로 검증한다.
- 라우트 57개 async 전환 + `asyncRoute` 래퍼(`backend/src/asyncRoute.ts`) — `store.ts`의 모든 메서드가 `Promise`를 반환하도록 바뀌었으므로 `server.ts`의 호출부 전체가 `await`로 전환됐고, 각 라우트 핸들러를 `asyncRoute(async (req, res) => { ... })`로 감싸 에러를 `errorFromDomain()`으로 일괄 처리한다.

**2단계 산출물(2026-09-14) — 정본은 `docs/handover/infra-implementations.md` 1부**:
- `backend/src/store/postgres.ts`에 `createPostgresStore(pool: pg.Pool): CellGuardStore` 구현. 자산·세션·릴레이·진단·건강 집계·텔레메트리 CSV 조회와 멱등성/도메인 오류 변환을 포함한다.
- 상태 변경과 감사 로그 6개 경로를 한 트랜잭션으로 처리하고, `23505` 전역 세션/진단 unique 위반을 기존 도메인 코드로 변환한다.
- `backend/migrations/006_diagnosis_progress_snapshot.sql`을 추가해 진단 phase 경계 스냅샷을 저장하고, `007_telemetry_raw_payload.sql`로 edge raw payload 보존 컬럼을 추가했다. 기존 `000`~`006`은 수정하지 않았다.
- 남은 인수 조건은 `TEST_DATABASE_URL`을 가진 PostgreSQL에서 migrations 적용 후 계약·동시성 테스트와 실제 `DATA_MODE=postgres` 재시작 시나리오를 수행하는 것이다.

### B2. `battery_id` 세션 태깅 — **구현 완료(2026-09-14) / 실 인프라 인수 검증 대기**

- **현재 상태**: 에지는 `device_id`만 싣고 `battery_id`를 모른다(CLAUDE.md 센서 스키마). 적재 시점에 백엔드 세션 정보로 귀속해야 한다.
- **완료된 것(백엔드)**: [`docs/handover/b2-session-tagging.md`](handover/b2-session-tagging.md)의 규칙을 `telemetryConsumer.ts`로 구현했다. 각 프레임의 처리 시점에 `device_id` + `status='ACTIVE'`를 DB에서 조회하고, 활성 세션이 없으면 `session_id`·`battery_id`를 `null`로 보존한다. edge payload의 backend ID는 받지 않는다.
- **멱등성·최신값**: `(device_id, measured_at)` 자연키 충돌은 `on conflict do nothing`으로 처리하고, `battery_latest`는 `excluded.measured_at > battery_latest.measured_at` 조건에서만 갱신한다. DB transaction과 safety hook이 끝난 뒤에만 Kafka offset을 수동 commit한다.
- **남은 일**: `TEST_DATABASE_URL`을 가진 PostgreSQL/Timescale과 실제 Kafka에서 migration 000~007 적용 후 세션 경계·재시작·부하 인수를 수행한다.
- **완료 판정**: 세션 시작→종료 사이 프레임의 `battery_id`가 100% 채워지고, 세션 밖 프레임이 잘못 귀속되지 않음(문서 §5의 SQL 검증 2건).

### B3. Fail-Safe 판정 주체 — **판정 엔진·구독 배선 완료(2026-09-14) / 문턱 실측 대기**

- **완료된 것(백엔드)**: 순수 판정 함수 `judgeFailsafe`(`backend/src/failsafe.ts`) — 절대온도(IR·접촉) → 가스 → 압력 상대상승률 → 온도 상승률 순으로 검사하고, 하드웨어 프로필(`MODE1_EXTERNAL_CELL_V1`/`COMBINED_EXISTING_PARTS_V1`)별로 실재하는 센서만 활성화한다. 이걸 저장소·에지·WS에 잇는 `evaluateFailsafe`(`backend/src/failsafeRunner.ts`) — 인터락 중복 방지(이미 걸려 있으면 재차단 안 함) → `engageFailsafe`(저장소, 릴레이 전이+`RELAY_AUTO_CUT` 감사 원자적) → `devicePort.relayCut`(에지 통보) → `broadcastAutoCut`(WS `relay.autoCut` 푸시) 순서로 실행하며, `backend/src/server.ts`가 `runFailsafe(batteryId, profile, sample, thresholds)`로 이 전체를 노출한다.
- **⚠️ 문턱값이 전부 `0`이라 현재 어떤 계층도 차단하지 않는다.** `failsafe.ts`의 `UNSET_THRESHOLDS`가 미설정 sentinel이며, `judgeFailsafe`는 `threshold > 0`일 때만 그 계층을 활성화한다. 하드웨어 실측(`mode1_backend_spec.md` §13 H8, `mode2_powerbank_diagnosis_spec.md` §8 H2) 전까지 의도된 휴면 상태다.
- **구독 배선**: PostgreSQL + `KAFKA_CONSUMER_ENABLED=true`일 때 Consumer가 frame별 `runFailsafe` hook을 호출한다. 배터리별 Promise queue로 TOCTOU 경합을 직렬화하고, `relay.autoCut` WS broadcast 실패는 로그로 남긴다. memory/test 모드에서는 Kafka 연결을 만들지 않는다.
- **완료 판정**: 문턱값 설정 후 — 조건 충족 시 모달이 뜨고, 릴레이가 `OPEN`으로 남고, 재인증·사유 없이는 복구되지 않음(자동 복구 없음).

### B4. 릴레이 차단 → 에지 실제 전달 — **포트 완료(2026-08-27) / Kafka 구현체 인계**

- **완료된 것(백엔드)**: `DeviceCommandPort` 인터페이스(`backend/src/device/port.ts`, 메서드 4개 — `relayCut`/`relayRestore`/`sessionStarted`/`sessionEnded`) + 로깅 스텁(`backend/src/device/logging.ts`, 실제로 명령을 보내지 않고 콘솔에 `[device] {...}` 형태로만 남김). 서버는 이미 이 인터페이스를 통해 `relayCut`을 호출하도록 배선돼 있다.
- **남은 일(인프라)**: `backend/src/device/kafka.ts`에 `createKafkaDeviceCommandPort(...)`를 구현해 로깅 스텁을 대체하고 `battery-events` 토픽으로 발행한다. **dual-write 원자성**(저장소 커밋과 Kafka 발행 사이 원자성 미확보 — 브로커가 죽으면 DB 상태와 에지 상태가 어긋남)과 **`sessionEnded` 배선 지점**(세션 종료가 라우트가 아니라 저장소 내부 사건이라 지금 훅이 없음)이 미결정이며, 정본은 `docs/handover/infra-implementations.md` 2부 §13·§15(둘 다 outbox 테이블로 동시에 풀 수 있음을 제안).
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
| `relay.autoCut` | `:285` | `:1628` (B3) | ✓ (문턱 미설정이라 휴면) |
| `alert.created` | `:290` | `:1629` | ✓ (휴면 — 위 참조) |
| `event.created` | `:291` | `:1630` | ✓ |
| `session.ended` | `:292` | `:1631` | ✓ |
| `diagnosis.progress`/`.done`/`.aborted` | `:297` | `:1633` | ✗ |
| `resync.required` | `:309` | `:1638` | ✓ |

- **`relay.autoCut`은 2026-08-25 시점에는 시도하지 않았으나, B3(Fail-Safe 판정 로직)가 2026-08-27에 완료돼 지금은 배선돼 있다.** `judgeFailsafe`·`evaluateFailsafe`·`runFailsafe`(§3 B3 참조)가 조건 충족 시 이 이벤트를 실제로 발신한다. 단 **문턱값이 전부 `0`(미설정)이라 실행 경로는 있어도 실제로 트리거되지는 않는 휴면 상태**다 — Raw Consumer 구독 배선은 완료됐고 하드웨어 실측 문턱값이 갖춰져야 관찰 가능하다.
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
- `/api/*` 도메인 게이트는 **`DATA_MODE`만 본다**: `memory`면 인메모리
  provider를, `postgres`면 PostgreSQL provider를 사용한다. PostgreSQL은
  listen 전 migrations `000`~`007` 핵심 스키마 검사를 통과해야 하며, 실패 시
  `RUNTIME_NOT_READY`로 요청을 열지 않고 기동을 중단한다.

`DATA_MODE=postgres`는 이제 실제 DB provider를 사용한다. 스키마가 없거나
연결할 수 없을 때 memory 데이터로 조용히 대체하지 않는 것이 fail-closed
동작이다. 현재 저장소에서 확인한 PostgreSQL 실 DB 결과는
`TEST_DATABASE_URL`이 없는 환경에서 생략됐으므로, 별도 DB 인수 테스트가 남아
있다.

**⚠️ 남은 실제 갭 — 이번 계획에서 고치지 않음**: WebSocket upgrade 핸들러의
데모/프로덕션 분기 선택은 여전히 `AUTH_MODE`만 본다. 따라서
`AUTH_MODE=demo DATA_MODE=postgres`에서도 데모 토큰 WS가 열리며, 연결 후
데이터는 선택된 PostgreSQL provider를 조회한다. Better Auth cookie 기반 WS
인증은 C2b 보류 항목으로 남아 있다.

**주의**: Better Auth 코드와 `/api/auth/*` 라우트는 **삭제하지 않았다**(2026-08-25 결정 유지). `AUTH_MODE=betterauth`로 바꾸면 켜지는 상태로 남아 있다. 데모 쿼리 토큰(`access_token`)은 `AUTH_MODE=betterauth`에서 **절대 허용하지 않는다**(`backend/README.md`).

**완료 판정**: 메커니즘(변수 분리·`/health`·REST provider 분기·기동 스키마
검사)은 구현 완료. `AUTH_MODE=demo DATA_MODE=postgres`의 브라우저·재시작
시나리오는 실제 DB가 준비된 인수 환경에서 추가 확인한다.

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

### C4. 음성 안내 설정 `/api/settings/voice-alert` — **완료(2026-08-25)**

- **구현**: `GET`/`PATCH /api/settings/voice-alert` (`backend/src/voiceAlert.ts` — 순수 검증/머지 함수 + `vitest` 5건, `backend/src/server.ts`에 Map 기반 사용자별 저장으로 배선). 필드는 계약대로 `enabled`·`volume`(0–100)·`connectionEnabled`·`anomalyEnabled`·`failsafeRelayEnabled`·`deviceErrorEnabled`·`networkEnabled`·`updatedAt`.
- **프론트**: `설정` 화면에 새 탭 `음성 안내` 추가(`frontend/src/pages/UserPages.tsx`의 `SettingsPage`) — 전체 ON/OFF, 볼륨 슬라이더, 카테고리 5종 토글. 전체가 꺼지면 하위 토글·슬라이더가 비활성화된다(계약: 릴레이/Fail-Safe 판단에 영향 없음, 운영 보조 기능).
- **버그 하나 잡음**: `.toggle-row input`이 타입 구분 없이 모든 input을 토글 스위치로 렌더링하고 있어(`styles.css`), 볼륨 range 슬라이더가 깨진 토글처럼 보였다. `[type="checkbox"]`/`[type="range"]`로 분리해 수정.
- **실측**: 브라우저로 배터리 연결 → 설정 → 음성 안내 탭에서 전체 ON, 볼륨 드래그(40%→100%), 카테고리 토글까지 확인. `curl`로 GET/PATCH 검증 완료, 볼륨 범위 밖(140) 요청은 `400 VALIDATION_FAILED`.
- 프론트 테스트: `frontend/src/test/settings-ui.test.tsx`에 음성 안내 탭 2건 추가.

### C5. 카카오톡 알림 발송 — **보류(의도적), 추가 작업 없음**

- **현재 상태**: 채널 ON/OFF 토글과 policy 응답만 있다(`server.ts:405`·`:409`). 실제로 메시지를 보내는 코드는 `backend/src`에 없다.
- **2026-08-25 결정**: 발송을 구현하지 않는다. **설정 화면의 토글은 현행 유지** — 저장은 되지만 아무 일도 일어나지 않고, 화면에 미구현 표시를 **추가하지 않는다.** 즉 이 항목에 지금 할 일은 없다.
- ⚠️ **시연 주의**: 화면상 토글이 정상으로 보이므로 "알림이 간다"고 설명하면 사실과 다르다.
- 나중에 되살릴 때 필요한 것(지금 하지 않음): 이상점수/이벤트 → 채널 정책(`sendOn: ["DANGER","WARNING"]`, `smsOnlyDanger`, `dedupeWindowMinutes: 5`) 적용 → Kakao API 발송 → 결과 기록. **서버는 사용자 문구를 만들지 않는다는 규칙(CLAUDE.md API 계약)의 예외가 필요하다** — 수신자가 웹 프론트가 아니라 서버가 문장을 만들어야 한다.

### C6. `?metric=` 배선 (소) — **완료(2026-08-25)**

- **구현**: `frontend/src/api/normalize.ts`에 프론트 카드 키(`voltageV`|`currentA`|`representativeTempC`|`socPct`) ↔ 서버 쿼리 값(`volt`|`curr`|`temp`|`soc`) 순수 매핑 함수 `dashboardMetricParam`/`dashboardMetricKey` 추가(단위 테스트 포함, `normalize.test.ts`).
  - `useDashboard(enabled, metric)`(`api/hooks.ts`)가 `?metric=`을 실어 보낸다.
  - `useRealtime`(`realtime/useRealtime.ts`)에 `refetchMetric(metric)`을 새로 노출 — 지표 카드 클릭 시 이걸 호출해 `/api/dashboard?metric=...`을 다시 받아 `quickTrend`만 교체한다(웹소켓 재연결 없이). 내부 `metricRef`로 최근 선택을 기억해두어 이후 `fetchSnapshot`/`resyncQueries`(초기 연결·재동기화)도 같은 지표로 요청한다.
  - `DashboardPage`의 카드·세그먼트 버튼 클릭이 `setMetric` + `realtime.refetchMetric(...)`을 함께 호출하도록 배선(`UserPages.tsx`).
- **실측**: 브라우저에서 "전류" 카드 클릭 → 네트워크 탭에 `GET /api/dashboard?metric=curr 200` 확인, 카드·세그먼트 활성 상태 전환 확인.
- 프론트 테스트: `frontend/src/test/dashboard-ui.test.tsx`에 클릭→`refetchMetric` 호출, 응답 반영 후 해당 카드에만 선이 그려지는지 검증하는 2건 추가.

### C7. 전류 부호 표기 — 추세 차트 — **완료(2026-08-25)**

- **결정**: 사용자 확인 결과 — *"부호는 신경 쓰지 말고 abs()로 하자."* 축 라벨 명시나 서브라인 분리 없이 단순 `abs()`로 확정.
- **구현**: `frontend/src/pages/UserPages.tsx`에 순수 함수 `trendSeriesValue(metricKey, value)` 추가 — `curr`만 `magnitude()`(null-safe abs)를 적용하고 나머지 지표는 그대로 둔다. `TrendCharts`가 이 함수를 통해 포인트를 만들도록 배선.
- **테스트**: `frontend/src/test/trend-charts.test.ts` 3건(부호 제거, null 보존, 다른 지표는 그대로).
- **실측**: 배터리 상세 → 추세 차트에서 전류 Y축이 `0 – 2.4`(음수 없음)로 렌더링됨을 브라우저로 확인.

### C8. 로컬 실행 패키징 (구 Phase 7 배포) — **완료(2026-08-25), 실측 범위는 memory 모드 한정**

정본은 `docs/local_run.md`. AWS 배포는 삭제됐고, 기본 시연은
`AUTH_MODE=demo DATA_MODE=memory`로 한다. PostgreSQL provider와 Raw Kafka
Consumer는 구현됐지만, DB/Kafka 실측 인수와 AI 추론 프로세스는 별도 인수
환경·담당자 몫이다.

- **호스트 PC는 Windows로 확인됐다(2026-08-25)** — 이 사실을 CLAUDE.md와 개인 메모리에 남겼다. 이하 전부 Windows 기준.
- **단일 오리진**: `backend/src/server.ts`에 `/api/*` 명시적 JSON 404(기존엔 Express 기본 HTML 404로 새고 있었음) + `express.static(frontend/dist)` + SPA 폴백(`index.html`)을 추가. `frontend/dist`가 없으면(백엔드 단독 dev 세션) 조용히 스킵된다.
- **버그 하나 발견·수정**: `frontend/src/api/client.ts`의 `demoTransportEnabled()`(및 `App.tsx`·`PublicPages.tsx`의 동일 로직)가 `__CELLGUARD_DEV_SERVER__`(Vite `dev` 커맨드에서만 `true`) 뒤에 숨어 있어서, 단순히 `vite build`만 하면 데모 로그인이 전혀 안 됐다 — 진짜 Better Auth(C2b)가 아직 없어 대체 경로가 없다. `VITE_DEMO_MODE==="true"` 단독 체크로 게이트를 바꿔 해결(서버가 `AUTH_MODE=demo`로 이미 독립적으로 재검증하므로 안전). `main.tsx`의 MSW 목 게이트는 그대로 dev 전용 유지.
- **`frontend/.env.production`(신규)**: `npm run build`가 자동으로 읽어 `VITE_API_BASE=`(동일 오리진)·`VITE_DEMO_MODE=true`·`VITE_USE_MOCKS=false`를 굽는다.
- **Windows 배치 스크립트**: `start-local.bat` — `.env` 확인 → 최초 1회만 `npm install` → 매번 프론트 재빌드 → `npm run start:local`(`tsx src/server.ts`, backend/package.json에 신규 추가)로 백엔드 기동. **작업 스케줄러 등록 등 영구 자동시작은 설치하지 않는다** — 사용자가 명시적으로 이 옵션을 거절했다(재부팅 후 수동 실행).
- **시드 데이터**: memory mode는 `backend/src/store/memory.ts`에 내장된 데모 데이터, PostgreSQL mode는 migrations `000`·`002`의 사용자/프로필 seed를 사용한다. 배터리 자산은 PostgreSQL에서 등록 또는 테스트 fixture 준비가 필요하다.
- **`.env` 템플릿**: `backend/.env.example`·`frontend/.env.example`에 주석 보강(왜 `DATABASE_URL`이 memory 모드에서도 필요한지, `.env.production`이 별도 파일인 이유).
- **실측(이 세션, macOS에서 실제 프로덕션 빌드로 검증)**: `npm run build` → 백엔드 기동 → `curl`로 `/`·`/dashboard`(200 HTML)·`/api/does-not-exist`(404 JSON, HTML로 새지 않음) 확인. 브라우저로 `localhost:3005` 접속 → 데모 로그인 자동 진행 → 배터리 연결 → 대시보드·설정(C4 음성 안내 탭)·`?metric=` 배선(C6)·전류 abs() 추세(C7)까지 전부 단일 오리진에서 재확인. 콘솔 에러 없음.
- **Playwright**: 기존 `e2e/production-bundle.spec.ts`(실서비스 빌드에 데모 자격증명이 새지 않는지 검증하는 기존 테스트)에 대칭 테스트 1건 추가 — `VITE_DEMO_MODE=true` 빌드에는 데모 로그인 트랜스포트가 **반드시 포함**돼야 함을 검증. 29건 전체 통과.
- ⚠️ **Windows `.bat` 자체는 실제 Windows PC에서 실행해 검증하지 못했다** — macOS 세션에서 작성만 했다. 처음 돌릴 때 문제가 있으면 알려달라고 `docs/local_run.md`에 남겨뒀다.
- **완료 판정 재확인**: "PC 재부팅 후 `localhost:3005` 하나로 전체 시나리오 동작"은 memory 모드 기준으로 today 성립한다. Kafka/PostgreSQL/추론이 붙는 순간(B1 이후) 이 문서·스크립트는 다시 봐야 한다.

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
3. ~~**C2 `AUTH_MODE`/`DATA_MODE` 분리**~~ — **완료(2026-08-25), PostgreSQL provider 배선 보강(2026-09-14).** WS upgrade가 `DATA_MODE`를 별도로 보지 않는 갭은 남아 있다.
4. ~~**B1 리포지토리 교체**~~ — **구현 완료(2026-09-14).** `TEST_DATABASE_URL`을 가진 DB에서 migrations `000`~`007` 적용 후 계약·동시성·재시작 인수 검증을 남겼다.
5. **B3·B4 안전 경로** — A2/A4가 데이터를 주기 시작한 뒤. B3이 끝나면 C1의 `relay.autoCut`도 같이 닫힌다.
6. ~~**C3 REST 미구현**~~ — **완료(2026-08-25).** `email-availability`·`exports` 계열 구현·실측 완료. `export.pdf`는 범위 밖 확정으로 남김.
7. ~~**C8 로컬 실행 패키징**~~ — **완료(2026-08-25).** memory 모드 한정, Windows 배치 스크립트는 실제 Windows PC에서 미검증.
8. ~~**C4 음성 안내 설정**~~ · ~~**C6 `?metric=` 배선**~~ · ~~**C7 전류 부호 표기**~~ · ~~**C8 로컬 실행 패키징**~~ — **모두 완료(2026-08-25).** 남은 것: WS의 `DATA_MODE` 인지(C2 갭)뿐. (C2b·C5는 보류)

### 지금 하지 않기로 한 것

| 항목 | 이유 | 되살릴 때 |
|---|---|---|
| Better Auth 실인증 (C2b) | Phase 1 보류 결정 | `AUTH_MODE=betterauth`로 전환 + WS upgrade 분기 연결 |
| WS upgrade의 `DATA_MODE` 인지 (C2 갭, 2026-08-25 신규 발견) | 이번 계획 범위 밖. `AUTH_MODE=demo`이면 `DATA_MODE=postgres`여도 WS가 열리며, 연결 후에는 선택된 provider를 사용한다 | WS upgrade 핸들러의 provider 준비 상태·production 인증 정책을 C2b와 함께 정리 |
| 카카오톡 발송 (C5) | Phase 6 보류 결정 | 토글은 이미 있으니 발송 경로만 추가 |
| AWS 배포 | 로컬 단일 PC 구성 | 해당 없음 |
| `POST /api/account/email-availability`·`email-lookup`의 Origin 검증·rate-limit·감사 이벤트 부재 (2026-08-25 최종 리뷰 신규 발견) | 이번 계획이 만든 갭이 아니라 두 엔드포인트가 원래부터 갖고 있던 것. 계약이 요구하는 보호를 붙이려면 전용 보안 인프라(요청 Origin 검증 미들웨어, rate-limit 저장소, 감사로그 연결)가 먼저 필요해 이번 수정 라운드 범위를 넘는다 | Origin 검증·rate-limit·감사 이벤트를 두 엔드포인트에 함께 추가(하나만 고치면 다시 벌어진다) |
| 알림 채널 정책의 `dedupeWindowMinutes: 5`(`GET /api/settings/alerts`) 미적용 | 반복 알림을 실제로 눌러줄 코드가 없다. 오늘은 `battery.latest.score`를 사후에 바꾸는 코드가 없어 휴면 상태라 관찰 자체가 불가능 | AI 추론 연동으로 실 이상탐지 데이터가 흐르기 시작할 때, `alert.created` 발신 직전에 dedupe 로직을 추가 |
| `exports.ts`의 `ExportStatus`에 `EXPIRED`가 있지만 어떤 코드도 잡을 이 상태로 전이시키거나 오래된 완료 잡을 정리하지 않음 | 현재 인메모리 데모 규모(잡 몇 개)에서는 실질적 문제가 없다. 다만 상태 enum이 구현이 실제로 지키는 것보다 많은 것을 약속하고 있다 | 만료 스윕(주기적 `setInterval` 또는 다운로드 시점 지연 평가)을 추가하거나, 그럴 계획이 없다면 enum에서 `EXPIRED`를 빼는 쪽을 판단 |

> `backend/dist/`는 빌드 산출물이며 구현 근거로 세지 않는다.
