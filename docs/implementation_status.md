# 구현 상태 및 문서 지도

> 기준일: 2026-08-11

이 문서는 설계 문서의 요구사항과 현재 저장소에 실제로 존재하는 구현을 구분하기 위한 실행용 지도다. 요구사항의 정본이 아니며, 상세 계약은 아래 링크의 원본 문서를 따른다.

## 읽는 법

- **구현됨**: 저장소에서 실행 가능한 코드나 검증 가능한 산출물을 확인할 수 있다.
- **부분 구현**: 골격·스텁·단일 화면만 있고 전체 계약은 아직 구현되지 않았다.
- **문서만 있음**: 설계·계약은 있지만 실행 코드나 실물 검증 결과가 없다.
- **미착수**: 계획에는 있으나 현재 저장소에서 구현을 확인할 수 없다.

## 현재 저장소 상태

| 영역 | 현재 확인되는 것 | 상태 |
|---|---|---|
| 요구사항·제품 계약 | [`PLAN.md`](../PLAN.md), [`docs/product_contract.md`](product_contract.md), 기능정의서·유저플로우 | 구현 기준 문서 있음 |
| 백엔드 인증 골격 | `backend/src/auth.ts`, 세션 미들웨어, 감사 로그, DB 연결, Better Auth `/api/auth/*` | 부분 구현 |
| 백엔드 데모 도메인 API | `backend/src/server.ts`, `backend/src/store.ts`: 발급 토큰 인증, 핵심 사용자·관리자 REST, 계약형 대시보드, F21 fail-closed, 릴레이 승인·멱등성, Raw CSV, 세션 스코프 WS | **데모 런타임 구현·실 REST/WS 브라우저 검증 완료** |
| 백엔드 DB 도메인 provider·Consumer·TimescaleDB | `backend/migrations/001_app_auth.sql`에 자산/세션/릴레이/텔레메트리/진단/멱등성 스키마가 있으나 production repository·Kafka Consumer·시계열 적재는 없음. `DEMO_MODE=false`에서는 `RUNTIME_NOT_READY`로 fail-closed | 부분 구현 / production 미착수 |
| 에지 소프트웨어 | `edge/bw150/`에 BW150 HID 로거·탐지·BLE 프로브(914줄)만 있고, 센서·릴레이·Kafka 프로듀서 구현은 없음 | 부분 구현 (BW150 한정) |
| AI 소프트웨어 | 모델 설계는 있으나 `ai/` 디렉터리, Colab 노트북, 학습·추론·Kafka 연동 구현은 없음 | 미착수 |
| 프론트엔드 | [`frontend/src/`](../frontend/src/)의 Vite + React + TypeScript strict 앱, v3 사용자·관리자 라우트, 계약형 API/WS 계층, MSW 시나리오, `npm run dev:real` 데모 경로 | 부분 구현 / production provider 미착수 |
| 프론트엔드 실행 기반 | `frontend/package.json`, React Router, Query, RHF/Zod, 토큰 CSS, 공용 UI, Vitest/RTL/Playwright 실행 설정 | 구현됨 / 계약·실행 검증 범위는 하단 참고 |
| 모드 1 하드웨어 | KiCad 회로 파일, [`docs/hardware/mode1_backend_spec.md`](hardware/mode1_backend_spec.md), 조립 안내서 | 문서·설계 있음, 실물 검증 전 |
| 모드 2 하드웨어 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](hardware/mode2_powerbank_diagnosis_spec.md) | 설계 계약 있음, 구현 전 |
| 디자인·목업 | [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](../web/cellguard_mockup_v4.html) | 참고 산출물 있음 |
| 자동 검증 도구 | `tools/contract_lint.py`, `landing_lint.py`, `bundle_io.py` 및 단위 테스트 | 부분 구현 |

### 2026-08-06 계약 동기화 주의

v3 프로토타입과 정본 문서에는 모드 1/2, 대표 온도 최댓값, signed 전류, 모드 2 상대 SOC, F21 `0=미설정` fail-closed, 서버 승인 릴레이, Raw CSV, WS envelope, 관리자 상태·메모·계정 사유 게이트가 반영됐다. 데모 provider의 REST/WS와 실제 Chromium 클릭 검증은 완료했지만, 실제 PostgreSQL transaction provider·Kafka/Timescale 적재·물리 Fail-Safe 판정·하드웨어 릴레이는 아직 구현/실측 전이다. `DEMO_MODE=false`는 이 provider가 생길 때까지 `RUNTIME_NOT_READY`로 닫힌다.

`backend/dist/`는 TypeScript 빌드 산출물이며 소스 구현의 근거로 세지 않는다. `PLAN.md`의 예정 폴더 구조도 실제 디렉터리 존재를 의미하지 않는다.

같은 날짜에 프론트엔드 실행 기반과 v3 도달 화면을 추가했다. `/api/me` 부트, 자산·세션 게이트, 대시보드 snapshot/WS 재연결, 릴레이 서버 승인, F21 fail-closed, 관리자 상태·메모 분리 UI를 계약형 클라이언트와 MSW로 연결했다. 2026-08-11에는 명시적 `dev:real` 경로를 추가하고 데모 로그인 토큰을 REST·다운로드·WS에만 전달하도록 연결했다. Better Auth 경로와 production/cookie 경로에는 Demo 헤더·쿼리 토큰을 넣지 않는다. 알림 설정은 GET canonical 조회와 `{ channels: { KAKAO, EMAIL, SMS, WEBPUSH } }` PATCH 응답 반영·실패 rollback을 사용하며, 비밀번호 변경은 현재/새/새 확인 입력을 검증한 뒤 확인 필드를 제외하고 POST한다. F21은 기본 `SAFETY_PROFILE_NOT_READY` 자산을 계속 잠그고, capability=true 모드 2는 MSW 전용 검증 시나리오에서만 요청·진행·중단·이력·상세를 확인한다. PDF aggregate export와 production domain provider는 아직 준비되지 않아 UI/API가 사용 불가 상태를 명시한다.

2026-08-06 프론트엔드 계약 회귀: WebSocket 클라이언트 메시지는 `{ v: 1, type, payload }` 봉투를 사용하고, 일반 재연결은 마지막 cursor/eventId로 resume하며 snapshot을 재조회하지 않는다. `resync.required`/`4410`에서만 `/api/me`, dashboard, alert summary, relay, active diagnosis를 다시 조회한다. Vitest/RTL/MSW 계약 테스트는 이 동작과 알림·비밀번호·F21 요청 shape 및 안전 profile 시나리오를 검증한다.

## PLAN 로드맵과 실제 상태

| 단계 | PLAN 기준 | 현재 판단 |
|---|---|---|
| Phase 1 인프라·백엔드 기반 | 백엔드 초기화·인증 골격만 완료 | 부분 구현. EC2, Kafka, PostgreSQL/TimescaleDB는 미착수 |
| Phase 2 에지 수집 | 센서·100ms 폴링·릴레이·음성·프로듀서 | 미착수 |
| Phase 3 스트리밍 | Consumer·세션 태깅·적재·오프셋 | 미착수 |
| Phase 4 AI | 데이터셋·특징·AE·Informer·추론 | 미착수 |
| Phase 5 웹 | React 초기화·라우팅·화면·관리자 | 부분 구현. v3 화면·계약 계층·mock QA·localhost demo REST/WS 연결 완료, production provider 통합은 미완료 |
| Phase 6 알림·차단 | 카카오·Fail-Safe·음성 설정 | 미착수 또는 스텁 |
| Phase 7 통합·배포 | E2E·시나리오·운영 모니터링 | 미착수 |

세부 체크리스트는 [`PLAN.md` §8 개발 로드맵](../PLAN.md#8-개발-로드맵)을 기준으로 갱신한다.

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

## 1. 지금 실제로 돌아가는 것 (2026-08-25 실측)

- `backend`·`frontend` 타입체크 통과, Vitest 44건, Playwright 28건, `contract_lint.py` 위반 0건.
- `DEMO_MODE=true` + `npm run dev:real`로 브라우저에서 로그인 → 자산 게이트 → 세션 시작 → 대시보드까지 실제 REST/WS로 동작. 콘솔 에러 없음.
- 서버측 게이트 실동작 확인: `409 BATTERY_BLOCKED`, `409 NO_ACTIVE_SESSION`, `401 REAUTH_REQUIRED`, `ACK_REQUIRED`, USER의 관리자 API `403`.

**단, 도메인 데이터는 전부 인메모리다.** `backend/src/store.ts`(360줄)는 `node:crypto`만 import하며 어떤 SQL도 실행하지 않는다. `backend/src/db.ts`의 풀은 `auth.ts`(Better Auth)만 쓴다.

## 2. A군 — 동료(Kafka·DB) 몫

| # | 항목 | 완료 판정 |
|---|---|---|
| A1 | EC2 Kafka 브로커 운영, 클라이언트 TLS/SASL 자격 발급 | 백엔드·에지·Colab이 각자 자격으로 접속 성공 |
| A2 | `battery-raw-metrics` Consumer → `telemetry_metric` 적재 | 에지 발행분이 테이블에 초 단위 지연으로 쌓임 |
| A3 | TimescaleDB 하이퍼테이블·압축·보존정책 (`telemetry_metric`) | 100ms × 다중 세션 부하에서 조회 지연 확인 |
| A4 | `battery-anomaly-alerts`(AI 추론 결과) Consumer | 이상점수·AE/Informer 개별 점수·파생 온도가 적재됨 |
| A5 | Consumer 오프셋·재처리·중복 방지 | 재시작 후 유실·중복 없음 |

> 스키마 자체는 이미 `backend/migrations/001_app_auth.sql`에 있다 — `battery_asset`(38) / `measurement_session`(62) / `relay_state`(77) / `telemetry_metric`(88) / `diagnosis`(110) / `idempotency_key`(127) / `audit_log`(20) / `app_user_profile`(1). 컬럼은 `store.ts`의 타입과 이미 1:1로 맞는다. **동료가 스키마를 바꾸면 `store.ts` 타입도 같이 바뀌므로 반드시 합의 후 변경한다.**

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
- **완료 판정**: `DEMO_MODE=false`로 띄우고 브라우저 시나리오(로그인→자산→세션→대시보드→릴레이 차단)가 끝까지 동작. 프로세스 재시작 후 데이터 유지.

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

### C1. WebSocket 실시간 발신 — **최우선**

프론트엔드는 이벤트 **11종**을 처리하는데 백엔드가 보내는 건 **1종**(`relay.changed`, `backend/src/server.ts:530`)뿐이다. `broadcast()` 함수는 `:895`에 있고 호출부가 한 곳이며, 주기 푸시 타이머(`setInterval`)가 전혀 없다.

| 이벤트 | 프론트 핸들러 | 계약 | 상태 |
|---|---|---|---|
| `metrics.tick` | `useRealtime.ts:246` | `backend_contract.md:1597`·`:1624` | ✗ |
| `anomaly.score` | `:255` | `:1625` | ✗ |
| `anomaly.gradeChanged` | `:266` | `:1626` | ✗ |
| `relay.changed` | `:271` | — | **✓ 유일** |
| `relay.autoCut` | `:285` | `:1628` (B3) | ✗ |
| `alert.created` | `:290` | `:1629` | ✗ |
| `event.created` | `:291` | `:1630` | ✗ |
| `session.ended` | `:292` | `:1631` | ✗ |
| `diagnosis.progress`/`.done`/`.aborted` | `:297` | `:1633` | ✗ |
| `resync.required` | `:309` | `:1638` | ✗ |

- **`metrics.tick`은 100ms 원본을 그대로 흘리지 않는다.** 서버가 **1초 단위로 다운샘플링**해 푸시한다(`:1643`). 페이로드는 `GET /api/dashboard`의 `metrics`와 **동일 구조**(각 지표 `{ value, status }` + `measuredAt`).
- **`relay.autoCut`을 `relay.changed`에 섞지 않는다**(`:1646`) — 사용자 차단과 구분이 안 된다.
- **`anomaly.gradeChanged`는 등급 전이에서만**(`:1647`), **`diagnosis.progress`는 단계 전환에서만**(`:1648`) 보낸다.
- 봉투 형식과 `sequence`/`cursor`는 이미 `server.ts:878`(`wsEnvelope`)에 구현돼 있으니 재사용한다.
- **완료 판정**: 대시보드를 열어둔 채 값이 1초마다 갱신되고, 등급 전이·알림·이벤트가 새로고침 없이 반영됨

### C2. production 인증 경로 (WebSocket)

- **현재 상태**: `DEMO_MODE=false`이면 upgrade 핸들러가 Better Auth 세션을 확인한 **뒤에도 그냥 `socket.destroy()`** 한다(`backend/src/server.ts:945-948`). 즉 production WS는 미구현이며 의도된 fail-closed다.
- **해야 할 일**: B1 완료 후 이 분기를 실제 구독 경로로 연결한다. 데모 쿼리 토큰(`access_token`)은 production에서 **절대 허용하지 않는다**(`backend/README.md`).
- **완료 판정**: 쿠키 인증만으로 WS 연결·구독·재연결(resume)이 동작

### C3. REST 미구현 — 실제로 3건뿐

| 엔드포인트 | 계약 | 현재 |
|---|---|---|
| `POST /api/account/email-availability` | `backend_contract.md:467` | 404 — 회원가입 이메일 중복확인 |
| `POST /api/exports` + `GET /api/exports/{id}` | `:904`·`:905` | 404 — 1시간 초과 CSV 비동기 작업. `export.ready` WS 이벤트 동반 |
| `GET /api/trends/export.pdf` | `:907` | 503 스텁 (`server.ts:832`) |

### C4. 음성 안내 설정 `/api/settings/voice-alert`

- **현재 상태**: 백엔드 라우트 없음, 프론트 화면도 없음.
- **계약 근거**: `backend_contract.md:1086`·`:1113`·`:1134`, `REQ-WEB-072`. *"v3 어느 화면에도 없다. 그러나 `PLAN.md`에 모델·API가 이미 확정돼 있고 에지 하드웨어 동작과 직결되므로 계약에 포함한다. 프론트가 설정 화면에 탭 또는 섹션을 새로 만들어야 한다."*
- 필드 정의는 `PLAN.md`에 있다. 전체 ON/OFF·음량·카테고리 5종.

### C5. 카카오톡 알림 발송

- **현재 상태**: 채널 ON/OFF 토글과 policy 응답만 있다(`server.ts:405`·`:409`). **실제로 메시지를 보내는 코드는 `backend/src`에 없다** — `KAKAO` 문자열이 나오는 곳은 설정 저장뿐.
- **해야 할 일**: 이상점수/이벤트 발생 → 채널 정책(`sendOn: ["DANGER","WARNING"]`, `smsOnlyDanger`, `dedupeWindowMinutes: 5`) 적용 → Kakao API 발송 → 결과 기록.
- **주의**: 서버는 사용자에게 보일 문구를 만들지 않는다는 규칙(CLAUDE.md API 계약)이 있으나, **카카오 발송은 예외적으로 서버가 문장을 만들어야 한다** — 수신자가 웹 프론트가 아니다. 템플릿 위치와 다국어 처리를 먼저 정한다.

### C6. `?metric=` 배선 (소)

- **현재 상태**: `/api/dashboard`가 `metric` 쿼리를 보내지 않는다 — `frontend/src/api/hooks.ts:33`, `frontend/src/realtime/useRealtime.ts:168`·`:179`. 그래서 지표 선택이 서버 시리즈를 바꾸지 못하고, 큰 차트는 선 색만 바뀐다.
- **계약 근거**: `backend_contract.md:755` — *"`quickTrend.metric`은 `volt|curr|temp|soc` 중 프론트가 선택. 쿼리 `?metric=temp`로 지정."*
- **연관**: 2026-08-25에 미니 스파크라인을 실데이터 기반으로 고치면서(`UserPages.tsx`) 이 배선은 남겨뒀다. 배선하면 선택한 카드에 실제 선이 그려진다.

### C7. 전류 부호 표기 — 추세 차트 (판단 필요)

- **현재 상태**: 빠른 추세 카드와 배터리 상세는 2026-08-25에 `magnitude()`로 부호를 제거했다. 그러나 배터리 상세의 **추세 차트는 전류 Y축이 여전히 음수**(`TrendCharts`).
- **판단이 필요한 이유**: 시계열에 `abs()`를 걸면 충전→방전 전환이 가짜 V자로 접혀 CLAUDE.md가 지키라는 충·방전 구분이 오히려 깨진다. 축 라벨을 `A (+충전 / −방전)`로 명시하는 쪽이 유력하나 확정 전이다.

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

1. **B군 4건의 담당을 문서로 확정한다** — 코드보다 먼저. 특히 B3는 넘기지 않는다.
2. **C1 WebSocket 발신** — Kafka·DB 없이 지금 당장 가능하고, 프론트가 이미 기다리고 있어 효과가 즉시 보인다. 데모 스토어 기반으로 먼저 구현해도 된다.
3. **B1 리포지토리 교체** — 분량이 가장 크다(360줄 + 동기→비동기 전환). 동료의 A2와 병렬로 진행 가능하다.
4. **C2 production 인증** — B1 이후.
5. **B3·B4 안전 경로** — A2/A4가 데이터를 주기 시작한 뒤.
6. **C3~C7** — 나머지.

> `backend/dist/`는 빌드 산출물이며 구현 근거로 세지 않는다.
