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
| Raw Kafka Consumer unit | `npm --prefix backend test -- src/telemetryConsumer.test.ts` | fake Kafka/PG로 valid·registered-device server-clock liveness·out-of-order 신규 frame·OFFLINE duplicate no-revive·rollback·unknown device·no session/transition audit·audit `created_at` event time·mode mismatch·malformed poison explicit commit·replay·out-of-order safety·DB/safety failure no commit·serialization·shutdown 통과 |
| Anomaly Kafka Consumer unit | `npm --prefix backend test -- src/anomalyConsumer.test.ts` | fake Kafka/PG로 v1 계약·device/ACTIVE-session attribution·null attribution·모든 AI 필드 보존·`(device_id,evaluated_at)` replay·세션 변경 replay 보존·`battery_latest` 단조성·poison explicit commit·DB/콜백 실패 no commit·중복 이벤트 방지·manual commit/shutdown 통과 |
| DeviceCommand outbox worker unit | `npm --prefix backend test -- src/outboxWorker.test.ts src/device/kafka.test.ts` | fake PostgreSQL/Kafka로 `FOR UPDATE SKIP LOCKED` claim 경쟁·배터리별 선행 row ordering·성공 ACK 후 `sent_at`·publish 실패 retry/backoff·만료 lease/restart recovery·invalid payload poison quarantine·producer header/key·lifecycle 통과 |
| PostgreSQL 저장소 계약 | `TEST_DATABASE_URL=... npm --prefix backend test` (migrations `000`~`009` 적용 DB) | memory 계약 스위트·전역 active-session 경합·outbox 순서/rollback/replay unit 테스트 통과. URL이 없으면 실제 연결 없이 명시적 skip |
| Consumer runtime gate | `DATA_MODE=memory KAFKA_CONSUMER_ENABLED=true ...` 및 `DATA_MODE=postgres KAFKA_CONSUMER_ENABLED=true KAFKA_ENABLED=false ...` | memory/test에서는 Kafka 연결 없음, PostgreSQL enabled 상태에서 invalid config는 HTTP listen 전에 fail-closed |
| 런타임 기본 상태 | 환경변수·DB 준비 후 `npm --prefix backend run dev`, `curl http://localhost:3005/health` | `{"status":"ok"}` 응답 |
| 인증·권한 | Better Auth 마이그레이션/세션으로 `/api/auth/*`, `/api/me`, `/api/admin/*` 확인 | 세션 검증과 `ADMIN` 재검증이 서버에서 동작 |
| API 계약 변경 | [`docs/backend_contract.md`](backend_contract.md) 해당 절과 요청/응답·에러 코드 비교 | 계약서의 도메인 불변식·소유권·감사 로그를 만족 |

현재 데모 런타임에는 발급 토큰 인증, 자산/세션/계약형 대시보드, 핵심 사용자·관리자 REST, 관리자 상태·메모·계정 사유 게이트, F21 fail-closed, 릴레이 승인·멱등성, Raw CSV, 세션 스코프 WS가 있다. `DATA_MODE=postgres`는 기동 전에 migrations `000`~`009` 핵심 스키마를 확인한 뒤 실제 PostgreSQL domain provider를 사용하며, 초기화 실패 시 memory 데이터로 대체하지 않는다. Raw/Anomaly Consumer와 Outbox Worker unit 경로 및 수동 offset/재처리/lease 규칙은 구현됐지만 실제 Kafka·Timescale 부하 인수는 별도다. 프론트는 `npm --prefix frontend run dev:real`로 실제 REST/WS를 확인할 수 있고, 기본 `npm run e2e`는 MSW fixture 검증이다. PDF aggregate export는 아직 범위 밖이다.

## Python 도구

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
```

2026-08-06 현재 `tools/test_contract_lint.py:151`의 기준 기대치도 실제 요구사항 집합 110개에 맞췄다. 전체 도구 테스트는 **48개 중 48개 통과**를 목표 기준으로 한다.

## 하드웨어·회로

| 변경 범위 | 검증 | 통과 기준 |
|---|---|---|
| 모드 1 회로 | `tools/gen_mode1_sch.py` 실행 후 KiCad ERC와 netlist 확인 | 생성 회로와 네트 연결이 일치하고 ERC 위반 0건 |
| 모드 1 센서 | [`docs/hardware/mode1_backend_spec.md` §13](hardware/mode1_backend_spec.md#13-실물로-확인해야-하는-것)의 H1~H9 순서 | 실측값·주소·ROM 위치·프레임·baseline·TFT 전원 호환성을 기록하기 전 구현 확정 금지 |
| 모드 2 진단 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md` §3~§8](hardware/mode2_powerbank_diagnosis_spec.md#8-미결정) | 안전 중단·완충 게이트·기준선·미결정 문턱을 구분 |
| 보유부품 통합형 | [`docs/hardware/mode1_mode2_combined_beginner_guide.md`](hardware/mode1_mode2_combined_beginner_guide.md) | `SOURCE_P` 양극 한 가닥, INA226 ID·CAL·OVF·션트 검산, 0.5A·10초 중단. 서버 `device_id` 프로필=V1에서 quick/capacity 각각 `409 SAFETY_PROFILE_NOT_READY`, Raw의 `gas_raw`·`temp_contact`·`temp_points.contact`·`pressure_raw`·`soc_pct`·`diag_phase`·`load_target_a` 모두 `null`, 릴레이 `1,0,0,0` 요청 거부 증적 |
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
| 숨은 프로토타입 속성 `MODE2_FULL` | 최종 사용자 화면에 프로필 전환기가 없고, 서버 capability가 준비되지 않은 현재 상태에서는 속성을 켜도 `SAFETY_PROFILE_NOT_READY`로 잠긴다. 문턱 실측 후에만 진행/중단/이력을 검증한다 |
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
