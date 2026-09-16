# 검증 매트릭스

이 문서는 작업 범위에 맞는 최소 검증과 중단 조건을 정한다. 모든 명령을 매번 실행하는 것이 아니라, 변경한 계층과 관련된 행을 적용한다.

## 작업 시작 전

| 확인 | 명령·방법 | 통과 기준 |
|---|---|---|
| 기존 변경 보존 | `git status --short --branch` | 작업과 무관한 변경을 확인하고 보존한다 |
| 작업 범위 | [`AGENTS.md`](../AGENTS.md)와 관련 정본 문서 읽기 | 대상 파일·정본·중단 조건이 명확하다 |
| 공백·패치 오류 | `git diff --check` | 출력이 없다 |
| 로컬 문서 링크 | `DOC=AGENTS.md; rg -o '\]\([^)]*\)' "$DOC" | sed -E 's/^\]\((.*)\)$/\1/'` 후 대상 존재 확인 | 깨진 상대 링크가 없다 |

## 문서·계약 변경

| 변경 범위 | 검증 | 통과 기준 | 실패·중단 |
|---|---|---|---|
| Markdown 문서 | `git diff --check`, 상대 링크 대상 확인 | 문법 오류·깨진 링크가 없다 | 정본과 충돌하면 구현하지 말고 정본을 먼저 수정·합의 |
| 제품 계약서 | `python3 tools/contract_lint.py docs/product_contract.md` | `위반 0건` | 금지 어휘·REQ·게이트·불변 위반을 먼저 해결 |
| HTML 번들 | `python3 tools/landing_lint.py <번들 HTML>` | `0건` 또는 `토큰 규칙 통과` | 원본 HTML이 없거나 번들 형식이 다르면 검증 결과를 만들지 않는다 |
| 요구사항 수 변경 | `tools/test_contract_lint.py`와 관련 문서 대조 | EXPECTED/EXCLUDED REQ와 문서가 일치 | 개수 불일치를 무시하고 통과 처리하지 않는다 |

## 백엔드

| 변경 범위 | 명령·방법 | 통과 기준 |
|---|---|---|
| TypeScript·타입 | `npm --prefix backend run typecheck` | 종료 코드 0 |
| 빌드 | `npm --prefix backend run build` | 종료 코드 0, 소스 오류 없음 |
| Raw Kafka Consumer unit | `npm --prefix backend test -- src/telemetryConsumer.test.ts` | fake Kafka/PG로 valid·registered-device server-clock liveness·out-of-order 신규 frame·OFFLINE duplicate no-revive·rollback·unknown device·no session/transition audit·audit `created_at` event time·mode mismatch·malformed poison explicit commit·replay·세션별 persisted mode1 pressure median·500 미만 event/dedupe·older safety sample 제외·DB/safety failure no commit·serialization·shutdown 통과 |
| Anomaly Kafka Consumer unit | `npm --prefix backend test -- src/anomalyConsumer.test.ts` | fake Kafka/PG로 v1 계약·device/ACTIVE-session attribution·null attribution·모든 AI 필드 보존·`(device_id,evaluated_at)` replay·세션 변경 replay 보존·`battery_latest` 단조성·poison explicit commit·DB/콜백 실패 no commit·중복 이벤트 방지·manual commit/shutdown 통과 |
| DeviceCommand outbox worker unit | `npm --prefix backend test -- src/outboxWorker.test.ts src/device/kafka.test.ts` | fake PostgreSQL/Kafka로 `FOR UPDATE SKIP LOCKED` claim 경쟁·배터리별 선행 row ordering·성공 ACK 후 `sent_at`·publish 실패 retry/backoff·만료 lease/restart recovery·invalid payload poison quarantine·producer header/key·lifecycle 통과. `FAILSAFE_*` 사유와 `failsafe-relay-cut:` durable dedupe identity가 모두 맞는 `RELAY_CUT`만 Kafka publish + `sent_at` ACK 뒤 `relay.autoCut` 1회 발신; manual cut, publish/retry/poison/ACK failure는 미발신; callback failure는 ACK된 command를 재발행하지 않음 |
| PostgreSQL 저장소 계약 | `TEST_DATABASE_URL=... npm --prefix backend test` (migrations `000`~`012` 적용 DB) | memory 계약 스위트·전역 active-session 경합·Fail-Safe relay/audit/domain/outbox transaction·rollback/replay·공지/조회수 동시성 계약 통과. URL이 없으면 실제 연결 없이 명시적 skip |
| 영속 domain event·관리자 추이 | `npm --prefix backend test -- src/*event*.test.ts` 및 `GET /api/admin/event-trend?period=24h|7d|30d` | 새 anomaly 등급 전이만 `domain_event`에 dedupe 저장되고, UTC 25/7/30 bucket·caution/warning/danger·total/dangerTotal/peak 요약과 빈 기간 `null/0`이 계약과 일치. `CUT`·`NORMAL`·관리자 감사는 제외 |
| 공지 DB·조회수 | 공지 작성→게시→사용자 목록/상세→보관 및 동시 상세 조회 테스트 | `PUBLISHED`/`DRAFT`/`ARCHIVED` 전이, `ALL`/`USER`/`ADMIN` 노출, summary 120자·상세 본문, 사용자별 24시간 조회 dedupe, audit 원자성이 PostgreSQL 재시작 후에도 유지 |
| 추세 집계·PDF | `GET /api/trends`와 `GET /api/trends/export.pdf`를 같은 DB fixture로 호출하고 PDF parse/render | 두 경로가 동일 bucket·소유권 검증을 사용하고 PDF가 `application/pdf`, 안전한 다운로드 파일명, 기간·지표·비교 배터리·요약·표/차트·빈 데이터·한글 글꼴을 충족. PDF는 Raw CSV와 분리 |
| Fail-Safe 설정 경계 | `npm --prefix backend test -- src/failsafe.test.ts src/failsafeRunner.test.ts src/telemetryConsumer.test.ts src/store/postgres.unit.test.ts src/outboxWorker.test.ts src/config/env.test.ts` | synthetic trace가 `[postgres commit, kafka.publish, outbox.sent, ws.relay.autoCut]` 순서를 검증; mode 1/2 센서 가용성, 각 0 sentinel, 10초 세션 baseline·500 미만 부착 event, duplicate/replay/out-of-order, already cut, outbox publish/ACK retry·poison, manual cut, write rollback, AI 부재 확인. 실제 broker·물리 relay actuation ACK(Task 7)와 threshold 승인은 별도 |
| Consumer runtime gate | `DATA_MODE=memory KAFKA_CONSUMER_ENABLED=true ...` 및 `DATA_MODE=postgres KAFKA_CONSUMER_ENABLED=true KAFKA_ENABLED=false ...` | memory/test에서는 Kafka 연결 없음, PostgreSQL enabled 상태에서 invalid config는 HTTP listen 전에 fail-closed |
| 런타임 기본 상태 | 환경변수·DB 준비 후 `npm --prefix backend run dev`, `curl http://localhost:3005/health` | `{"status":"ok"}` 응답 |
| 인증·권한 | Better Auth 마이그레이션/세션으로 `/api/auth/*`, `/api/me`, `/api/admin/*` 확인 | 세션 검증과 `ADMIN` 재검증이 서버에서 동작 |
| API 계약 변경 | [`docs/backend_contract.md`](backend_contract.md) 해당 절과 요청/응답·에러 코드 비교 | 계약서의 도메인 불변식·소유권·감사 로그를 만족 |

## 로컬 통합 실행 구성 (Task 7)

| 변경 범위 | 명령·방법 | 통과 기준 | 실패·중단 |
|---|---|---|---|
| Compose/YAML 정적 구성 | Docker가 있는 환경에서 `docker compose -f docker-compose.local.yml config --quiet`; Docker가 없으면 YAML parser와 파일-level inspection | pinned TimescaleDB/Kafka/Node/Python images, healthchecks, dependency completion gates, loopback/LAN listener 분리, no private address/secret | Compose config 오류, unpinned `latest`, localhost를 LAN advertised listener로 사용, private secret/address commit |
| Topic bootstrap | `kafka-init` service 또는 Kafka CLI로 목록 확인 | `battery-raw-metrics`, `battery-anomaly-alerts`, `battery-events` 3개가 모두 존재 | 하나라도 없으면 backend/edge 인수를 진행하지 않는다 |
| Migration fail-closed | `npm --prefix backend run db:migrate` against TimescaleDB | ordered `000`~`009`와 Task 2~6에서 추가한 `010`~`012`(해당 시), advisory lock, per-file transaction, extension availability와 두 hypertable post-check 통과 | plain PostgreSQL/extension/hypertable 누락은 `TIMESCALEDB_REQUIRED`, memory fallback 금지 |
| Runtime health | `docker compose ... up -d backend`, `curl http://localhost:3005/health` | `status=ok`, `data=postgres`; backend starts only after migration/topic completion | DB/Kafka/migration failure 전에 HTTP listen하면 안 된다 |
| Optional AI profile | `docker compose ... --profile ai up ai` with external bundle/adapter | bundle loader와 explicit adapter가 통과한 뒤에만 Kafka 연결·anomaly publish | bundle/adapter 미설정은 `AI_MODEL_BUNDLE_*`/`AI_INFERENCE_ADAPTER_*`로 종료, fake/memory fallback 금지 |
| Lifecycle/recovery | `logs`, `stop`, `start`, `restart`, migration/topic rerun commands in [`docs/local_run.md`](local_run.md) | operator can inspect health/logs and rerun deterministic one-shot services without deleting named volumes | `down -v` 또는 수동 offset skip을 recovery 절차로 제시하지 않는다 |

현재 호스트에는 Docker/Podman, `psql`, `kafka-topics` CLI가 없어 이 표의 실제
Compose 기동·health·토픽·Timescale 적재·Kafka roundtrip 항목은 **미검증**이다.

현재 데모 런타임에는 발급 토큰 인증, 자산/세션/계약형 대시보드, 핵심 사용자·관리자 REST, 관리자 상태·메모·계정 사유 게이트, F21 fail-closed, 릴레이 승인·멱등성, Raw CSV, 세션 스코프 WS가 있다. `DATA_MODE=postgres`는 기동 전에 migrations `000`~`009` 핵심 스키마를 확인한 뒤 실제 PostgreSQL domain provider를 사용하며, 초기화 실패 시 memory 데이터로 대체하지 않는다. Raw/Anomaly Consumer와 Outbox Worker unit 경로 및 수동 offset/재처리/lease 규칙은 구현됐지만 실제 Kafka·Timescale 부하 인수는 별도다. Task 1에서 domain event·공지·추세/PDF·Fail-Safe 설정 계약을 고정했으며 구현 전이다. 프론트는 `npm --prefix frontend run dev:real`로 실제 REST/WS를 확인할 수 있고, 기본 `npm run e2e`는 MSW fixture 검증이다.

## 에지 명령 Consumer (Task 6)

| 변경 범위 | 명령·방법 | 통과 기준 | 실패·중단 |
|---|---|---|---|
| `edge/commands/` 단위 테스트 | `python3 -m unittest discover -s edge/commands -p 'test_*.py'` | version-1 명령·파티션 키·durable SQLite 멱등성·fail-closed relay·manual commit, 실패한 현재 레코드의 retry/stall boundary, commit-failure durable duplicate replay가 통과한다 | 실패한 물리 명령을 자동 abandon하거나 성공으로 기록하지 않는다 |
| 에지 Python 문법 | `python3 -m py_compile edge/commands/*.py` | 종료 코드 0 | 실제 GPIO/Kafka 의존성을 fake 통과로 대체하지 않는다 |
| 실물 인수 | Raspberry Pi의 실제 `RPi.GPIO`·로컬 Kafka broker에서 startup, relay, restart, duplicate, offset 순서를 수행 | 실제 핀 HIGH fail-closed, 배터리별 순서, commit 뒤 재실행 없음 확인 | 현재 환경에서는 Pi·Kafka 연결과 실물 릴레이를 검증하지 않고 **미검증**으로 기록한다 |

## Python 도구

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
```

2026-08-06 현재 `tools/test_contract_lint.py:151`의 기준 기대치도 실제 요구사항 집합 110개에 맞췄다. 전체 도구 테스트는 **48개 중 48개 통과**를 목표 기준으로 한다.

## 로컬 AI 추론 경계 (Task 5)

| 변경 범위 | 명령·방법 | 통과 기준 | 실패·중단 |
|---|---|---|---|
| v1 raw/anomaly 계약·모드별 필드 | `python3 -m unittest discover -s ai/tests -p 'test_*.py'` | 외부 패키지·Kafka 없이 계약, `device_id` 전용 payload, 0–1 점수, mode 1/2 unavailable 필드 검증 통과 | payload 불변식 위반·가짜 필드/점수는 publish하지 않는다 |
| model bundle loader | 같은 명령의 bundle tests | 두 checkpoint·scaler·feature metadata가 존재하고 SHA-256·model version·feature order·window이 모두 일치할 때만 load | 누락·경로 탈출·checksum/version/order/window 불일치·fake 구현은 `AI_MODEL_BUNDLE_*`로 기동 실패 |
| production entrypoint gate | `python3 -m ai.runtime` (artifact 미설정 환경) | 비정상 종료(코드 1), `AI_MODEL_BUNDLE_NOT_CONFIGURED` 또는 외부 adapter 부재 메시지, Kafka 연결 전 실패 | 실제 모델이 없는데 memory/fake/placeholder로 계속 실행하면 안 된다 |
| raw → inference → anomaly → offset | 위 unittest의 runtime tests; fake는 테스트 코드에서만 명시 주입 | anomaly publish 성공 뒤에만 다음 offset commit. publish/commit 실패·잘못된 입력은 commit하지 않고 재처리 시 직렬화 결과를 재사용하며, 새 서비스/adapter 재시작 replay도 raw timestamp 기반 같은 자연키·payload를 유지 | publish 또는 commit 전 offset commit, `battery_id/session_id` 생성, 파생값 추정은 금지 |
| Python 문법 | `python3 -m py_compile ai/*.py` | 종료 코드 0 | 외부 모델 코드나 binary를 이 명령의 통과 근거로 세지 않는다 |

실행 시점에 승인된 checkpoint/scaler/feature metadata 및 외부 adapter가 없으면
실 Kafka roundtrip·실제 AI 점수 품질·Kalman/내부 셀 온도 추정은 **검증하지
않고 `EXTERNALLY_BLOCKED`로 기록**한다. 해당 artifact와 adapter가 준비된 뒤에만
`battery-raw-metrics` → `battery-anomaly-alerts` broker 인수 테스트를 추가한다.

## 하드웨어·회로

| 변경 범위 | 검증 | 통과 기준 |
|---|---|---|
| 모드 1 회로 | `tools/gen_mode1_sch.py` 실행 후 KiCad ERC와 netlist 확인 | 생성 회로와 네트 연결이 일치하고 ERC 위반 0건 |
| 모드 1 센서 | [`docs/hardware/mode1_backend_spec.md` §13](hardware/mode1_backend_spec.md#13-실물로-확인해야-하는-것)의 H1~H9 순서 | 실측값·주소·ROM 위치·프레임·baseline·TFT 전원 호환성을 기록하기 전 구현 확정 금지 |
| 모드 2 진단 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md` §3~§8](hardware/mode2_powerbank_diagnosis_spec.md#8-미결정) | 안전 중단·완충 게이트·기준선·미결정 문턱을 구분 |
| 보유부품 통합형 | [`docs/hardware/mode1_mode2_combined_beginner_guide.md`](hardware/mode1_mode2_combined_beginner_guide.md) | `SOURCE_P` 양극 한 가닥, INA226 ID·CAL·OVF·션트 검산, 0.5A·10초 중단. 서버 `device_id` 프로필=V1에서 미지원 Raw의 `gas_raw`·`temp_contact`·`temp_points.contact`·`pressure_raw`·`soc_pct`·`diag_phase`·`load_target_a`는 `null`이며, Fail-Safe 문턱 `0` 자체를 `SAFETY_PROFILE_NOT_READY`로 바꾸지 않는다. 실제 릴레이 실행은 프로필·하드웨어 인수 후에만 검증한다 |
| 릴레이·Fail-Safe | 무부하·전류 0A·인터락 순서 포함한 벤치 시험 | AI 결과와 무관한 안전 차단, 자동 복구 금지, 감사 이벤트 기록 |

실물 전압·전류·온도 확인 없이 센서 주소, 임계값, 부하 동작을 추정하지 않는다.

## 프론트엔드·시각 검토

- `frontend/`는 실행 가능한 전체 React 프로젝트이며 `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`로 정적·MSW 검증을 수행한다. 이 MSW 결과는 실제 REST/WS·production provider 통합의 증거로 대체하지 않는다.
- 화면 변경은 [`docs/product_contract.md`](product_contract.md), [`docs/backend_contract.md`](backend_contract.md), [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), 최신 권위 HTML을 함께 확인한다.
- 반응형·접근성·WebSocket 재연결은 코드 리뷰만으로 끝내지 않고 실제 브라우저에서 데스크톱·태블릿·모바일 폭을 확인한다.
- `anomaly_score`·등급 경계·원본 데이터 표시는 계약서의 스케일과 불변식에 맞는지 확인한다.

### F21·관리자 상세 브라우저 인수 기준

| 상태 | 통과 기준 |
|---|---|
| 미연결 / 모드 1 | F21은 실행 경로를 열지 않고 각각 연결 필요 / 모드 2 전용을 안내한다 |
| 모드 2 + 기본 `COMBINED_EXISTING_PARTS_V1` | 안전 준비 전·실행 잠금, 빠른/정밀 버튼 우회 불가, `soc_pct`·가스·접촉온도·진단 단계 등 미지원값을 `—`로 표시한다 |
| 숨은 프로토타입 속성 `MODE2_FULL` | 최종 사용자 화면에 프로필 전환기가 없고, 서버가 배포 프로필로만 선택한다. 문턱이 `0`이면 해당 Fail-Safe 계층만 비활성화하며 실제 외부 발송·하드웨어 검증을 성공으로 간주하지 않는다. 문턱 실측 후에만 실물 차단을 검증한다 |
| 관리자 운영 상태 | NORMAL/WATCH/BLOCKED의 모든 실제 전환에서 사유와 확인을 요구하고, 성공 전에는 목록/상세를 바꾸지 않는다. BLOCKED 해제도 세션/릴레이를 자동 복구하지 않는다 |
| 관리자 메모 | 상태와 별도 native 입력·별도 저장이며, 상태 사유 없이 저장할 수 있고 상세 재진입 후 유지된다 |

## 통합·배포

다음 조건이 모두 준비되기 전에는 E2E 통과를 선언하지 않는다.

- 에지 Raw 발행과 TLS/SASL 인증
- Kafka 토픽·Consumer·TimescaleDB 적재
- `battery_id` 측정 세션 태깅
- AI의 `battery-anomaly-alerts` 발행
- 백엔드 WebSocket과 프론트 화면
- Fail-Safe·이벤트·감사 로그

통합 테스트의 기준 흐름은 `에지 → Kafka → DB → AI → 백엔드 → 대시보드`이며, 이상 시나리오에서는 오탐·미탐·센서 오류·네트워크 단절·릴레이 차단 순서를 별도로 기록한다.
