# 물리 Fail-Safe 실측·릴레이 인수 기록 (Task 7)

이 문서는 물리 Fail-Safe 문턱 실측값, 승인 근거, 그리고 Kafka부터 실제
릴레이 차단까지의 인수 결과를 기록한다. 승인된 실측값과 실물 인수 증거가
없어 현재 모든 항목은 EXTERNALLY_BLOCKED다.

## 문턱 활성화 원칙

- backend/.env.example과 docker-compose.local.yml의 FAILSAFE_* 5개 값은
  모두 0이다. backend/src/config/env.ts의 기본값도 각각 0이며, 각 0은 그
  안전 계층만 비활성화하는 미설정 sentinel이다. 루트 .env.example에는
  Fail-Safe 문턱을 따로 선언하지 않는다.
- 실측·승인 전에는 값을 제안하거나 활성화하지 않는다. 정상 범위, 위험 범위,
  제안 문턱은 실험 결과로 채우며 승인자와 승인일이 기록되기 전에는 배포
  설정을 변경하지 않는다.
- 추적 문서 조사에서 사용자 승인 근거는 찾지 못했다. 과거
  docs/superpowers/plans/2026-08-27-backend-handover.md의 configured 예시
  (60°C, 5°C/min, 30%, 800 raw 등)는 테스트용 코드 fixture일 뿐
  실측·승인값이 아니므로 복사하거나 활성화하지 않는다.
- 한 backend 프로세스가 사용하는 FAILSAFE_*는 전역 배포 설정이다. 같은
  환경에서 여러 하드웨어 프로필이 같은 센서를 사용한다면 모든 해당
  프로필에 안전한 값으로 승인하거나 프로필별 배포를 분리해야 한다.
  표의 프로필 기록만으로 설정이 프로필별 분리되는 것은 아니다.
- 센서 가용성은 MODE1_EXTERNAL_CELL_V1의 접촉 온도·IR·온도 상승률·압력,
  MODE2_FULL의 IR·온도 상승률·가스, COMBINED_EXISTING_PARTS_V1의
  IR·온도 상승률로 제한한다. 없는 센서의 문턱을 활성화하지 않는다.

## 실측 기록표

각 항목의 실제 하드웨어 리비전, 장비 모델·일련번호·교정 정보, 측정일과
표본 수, 정상/위험 분포, 문턱 제안, 승인자·승인일, 증거 경로, 결과를
기록한다. 현재 미측정 필드는 비워 두었고 숫자를 추정하지 않았다.

| 항목 | 기록 |
|---|---|
| 모드 1 접촉 온도 상한 | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE1_EXTERNAL_CELL_V1 / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_TEMP_CONTACT_CAP_C=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 1 IR 온도 상한 | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE1_EXTERNAL_CELL_V1 / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_TEMP_IR_CAP_C=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 1 온도 상승률 | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE1_EXTERNAL_CELL_V1 / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_TEMP_RISE_RATE_C_PER_MIN=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 1 압력 상승률 (H8) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE1_EXTERNAL_CELL_V1 / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 pressureRisePct: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_PRESSURE_RISE_PCT=0 (sentinel)<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 2 IR 온도 상한 (H2) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE2_FULL / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_TEMP_IR_CAP_C=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 2 온도 상승률 (H3) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE2_FULL / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_TEMP_RISE_RATE_C_PER_MIN=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 2 가스 임계 (H6) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE2_FULL / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미측정 / 미측정<br>제안 문턱: 미기입<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: FAILSAFE_GAS_RAW=0<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 2 MQ-2 배치 (H11) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE2_FULL / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미기록 (히터 열 간섭·가스 baseline 분포)<br>제안 문턱: 해당 없음 — 배치 적합성 게이트<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: 해당 없음 (배치 검증 전 FAILSAFE_GAS_RAW=0 유지)<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |
| 모드 2 챔버 구성 (H15) | 장비(모델/일련번호/교정): 미기록<br>프로필/하드웨어 리비전: MODE2_FULL / 미기록<br>측정일 / 표본 수: 미기록 / 미기록<br>정상 범위 / 위험 범위: 미기록 (재질·내부 치수·기류·센서 거치 기록)<br>제안 문턱: 해당 없음 — 챔버 구성 게이트<br>승인자 / 승인일: 미승인 / 미승인<br>활성 env key / 현재 값: 해당 없음 (H2/H6 문턱은 챔버 승인 전 0 유지)<br>증거 파일·로그: 미기록<br>결과: EXTERNALLY_BLOCKED |

### 모드 1 H8 압력 측정 절차

1. 실제 부착 상태에서 세션 시작 후 셀을 건드리지 않고 10초간 표본을
   수집해 raw baseline 중앙값과 표본 수를 기록한다. 압력 안전계층은 이
   세션 baseline 대비 상대 상승률 ((pressure_raw - baseline) / baseline) × 100%를 쓴다.
2. baseline이 500 미만이면 기존 규칙대로 부착 불량으로 기록하고 해당
   세션의 압력 계층을 사용하지 않는다. 25,000 이상이면 예압 과다로 보고
   기구를 조정한 뒤 다시 측정한다. 유효한 부착 상태에서만 가이드를 따라
   가볍게 눌러 변화를 기록한다.
3. 눌렀을 때의 raw 분포·상승률과 반복 표본 수를 기록하되, 이 결과만으로
   자동 차단 문턱을 정하지 않는다. 승인 전 pressureRisePct 제안·승인
   필드는 비워 두고 FAILSAFE_PRESSURE_RISE_PCT=0을 유지한다.

### 모드 2 H11/H15 측정 순서

H15 챔버의 재질·내부 치수·기류·브래킷을 먼저 기록·승인하고, H2 온도와
H6 가스는 이후에도 같은 챔버 안에서 측정한다. H11에서는 MQ-2가 IR 시야
밖·위쪽에 배치됐는지와 히터 발열이 팩 표면 또는 발열 기울기를 오염시키는지
측정한다. 위치·워밍업·baseline 변화 및 반복 횟수를 기록한다. H3는
스펙대로 서로 다른 상태의 보조배터리 최소 3대에서 분포를 수집한다.

실제 셀을 의도적으로 위험하게 가열하거나 가스를 방출해 위험 범위를 만들지
않는다. 안전한 기준 자극이나 자격을 갖춘 시험 설비가 없으면 해당 항목은
EXTERNALLY_BLOCKED로 유지한다. COMBINED_EXISTING_PARTS_V1에는 MQ-2가
없으므로 H6 가스 측정·가스 문턱 활성화 대상이 아니다.

## 실물 Kafka → backend → outbox → Pi → relay 인수 절차

현재 호스트에는 Docker/Podman, psql, kafka-topics CLI와 Linux GPIO 장치
노드가 없고, backend/DB/Kafka의 로컬 대기 포트도 열려 있지 않다. 승인
임계값, 센서/릴레이 장치, 실 Kafka·TimescaleDB 자격증명과 연결 근거도
이 작업에 제공되지 않았다. 따라서 아래 인수는 실행하지 않았고 현재 결과는
EXTERNALLY_BLOCKED다.

1. **사전 게이트** — 해당 하드웨어 프로필의 센서와 회로 리비전, 계측기
   교정 정보, 승인 완료 기록표, 안전한 시험 부하, 담당자, 저장소에 넣지
   않은 유효한 런타임 자격증명을 확인한다. 관련 문턱이 여전히 0이면 실제
   자동 차단 자극을 진행하지 않는다. 챔버 미승인 상태에서는 모드 2 H2/H6
   시험을 시작하지 않는다.
2. **runtime 준비** — TimescaleDB에 migration 000~012를 실행기
   npm --prefix backend run db:migrate로 순서 적용하고 적용 목록과
   Timescale extension/hypertable 검사를 확인한다. Compose의 Kafka와 세
   토픽 battery-raw-metrics, battery-anomaly-alerts, battery-events를 확인한
   뒤 backend의 실제 health/data mode, consumer, outbox worker 로그를
   저장한다. DB 실패 시 memory fallback으로 통과 처리하지 않는다.
3. **Pi 준비** — 실제 Raspberry Pi에서 GPIO가 fail-safe 출력 상태로
   초기화된 뒤에만 Kafka 명령 consumer가 구독하는지 확인한다. 시작 상태,
   device/profile 식별자, relay channel/pin, consumer group과 버전을 기록한다.
4. **센서부터 outbox까지** — 승인된 안전한 물리 자극으로 센서 샘플을 만들고
   battery-raw-metrics의 topic/partition/offset과 실제 raw 측정값을 기록한다.
   PostgreSQL의 해당 telemetry row와 fail-safe transaction 내 relay state,
   audit/domain event, RELAY_CUT outbox row를 같은 battery/session/run ID로
   묶는다. raw frame natural key, DB event ID, outbox event ID와 dedupe key는
   각각 기록해 상관관계를 보존한다.
5. **Kafka 전달** — outbox worker가 battery-events에 해당 RELAY_CUT을
   발행한 broker ACK, event ID/dedupe key, partition/offset과 PostgreSQL
   sent_at을 함께 기록한다. publish/retry/poison/DB ACK 오류가 있으면
   중단하고 Pi actuation 성공으로 간주하지 않는다.
6. **Pi 실행·로컬 ACK** — Pi가 동일 event ID를 받아 계약·partition key를
   검증하고, durable idempotency 기록 후 물리 relay 호출을 수행하는지
   확인한다. relay 호출 성공이 로컬 저장소에 기록된 뒤에만 해당 Kafka
   offset이 commit되는지 로그·SQLite 상태로 확인한다. 재생/restart에서도
   동일 event가 두 번째 GPIO 동작을 만들지 않아야 한다.
7. **전기적 차단 증거** — Pi 로그만으로 차단을 판정하지 않는다. 시험 회로
   도면에 지정된 측정점에서 차단 전후 부하측 전압과 전류 또는 접점 개방
   증거를 독립 계측기로 기록하고, 이벤트 ID·relay channel·측정 시각과
   연결한다. 결과가 승인된 회로의 무전원/차단 상태와 맞지 않거나 계측이
   모호하면 실패로 중단한다.
8. **relay.autoCut 확인** — event payload의 battery, trigger, cut 시각과
   outbox event를 대조해 기록한다. 현재 PostgreSQL backend는 Kafka publish와
   outbox sent_at ACK 뒤 이 WebSocket 이벤트를 발신한다. Pi의 GPIO 실행,
   전기적 차단 증거, Pi offset commit ACK를 backend로 되돌리는 ACK 경로는
   없다. 따라서 relay.autoCut은 현재 Kafka 전달 ACK이지 물리 릴레이 실행
   ACK가 아니며, Pi 확인보다 먼저 올 수도 있다. 이는
   [product contract T8](../product_contract.md)의 “회로가 이미 차단” 전제가
   Pi의 물리 동작으로 보장되지 않을 수 있다는 뜻이므로, 실물 차단 증거를
   대체하는 UI 알림으로 취급하지 않는다.

### 성공 판정과 중단 조건

실물 전달 인수는 실제 PostgreSQL/TimescaleDB·Kafka runtime에서 센서 입력,
트랜잭션 outbox, broker publish ACK, Pi의 해당 event 처리와 offset commit,
독립적인 회로 차단 증거가 모두 같은 run ID로 연결돼야 통과한다. raw frame
자연키, fail-safe DB event, outbox event ID/dedupe key, Kafka partition/offset,
Pi event ID/commit offset을 각각 기록해 한 차례의 시험 흐름으로 추적한다.
relay.autoCut도 존재 여부와 시각을 기록하지만, 현 구현에서 Pi actuation
후속 확인을 의미하지 않는다. 요구된 순서가 “물리 actuation/ACK 뒤
relay.autoCut”이라면 현재 구현은 그 인수 기준을 충족하지 못한다. 그 순서를
성공으로 판정하려면 에지 ACK 왕복 및 server event 시점 변경이 선행돼야
하며, 이 문서 작업에서는 코드를 변경하지 않았다.

다음 중 하나라도 있으면 시험을 시작하지 않거나 즉시 실패·중단으로 기록한다:
승인/프로필/자격증명/계측 증거 누락, migration/topic/runtime 미준비,
센서 profile mismatch, pressure baseline <500 또는 >=25000, outbox
미전달·poison·ACK 실패, Pi idempotency/GPIO/offset commit 오류, 독립 측정
불일치, relay 재동작, 또는 이상 발열·팽창·연기·가스 징후. 재시험은 원인
확인과 안전 점검 뒤에만 수행한다.

| 인수 기록 필드 | 기록 |
|---|---|
| Run ID / 일시 / 담당자 | 미기록 |
| 승인 문턱 기록 행 / 활성 프로필·하드웨어 리비전 | 미기록 |
| DB migration 적용 목록 / Timescale 확인 | 미기록 |
| Kafka topic·partition·offset / consumer group | 미기록 |
| battery·session·raw event 식별자 | 미기록 |
| PostgreSQL relay/audit/domain/outbox ID·sent_at | 미기록 |
| Pi event ID / idempotency 결과 / commit offset | 미기록 |
| Relay 채널·핀 / 전후 전압·전류 또는 접점 증거 / 계측기 | 미기록 |
| relay.autoCut payload·수신 시각·Pi ACK 대비 순서 | 미기록 |
| 증거 파일·로그 / 결과 / 승인자·승인일 | 미기록 / EXTERNALLY_BLOCKED |
