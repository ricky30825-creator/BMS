# 로컬 AI 추론 프로세스 경계

기준일: **2026-09-15**

이 문서는 `ai/`의 실행 경계와 외부 모델 번들 인계 조건을 정의한다. 현재
저장소에는 학습된 LSTM-AutoEncoder/Informer checkpoint, scaler, 권위 feature
metadata가 없다. 따라서 이 저장소는 모델을 추정하거나 임의 점수를 발행하지
않으며, 아래 조건이 갖춰지지 않으면 기동하지 않는다.

## 현재 구현과 차단 상태

- `ai/contracts.py`: `battery-raw-metrics` v1과 `battery-anomaly-alerts` v1의
  strict validator, 모드별 센서 불변식, adapter/broker Protocol.
- `ai/bundle.py`: 파일 경로·SHA-256·모델 버전·feature order·window·scaler를
  교차 검증하는 fail-closed loader.
- `ai/runtime.py`: raw 수신 → 명시적 adapter → anomaly publish → 성공 뒤 offset
  commit 순서, raw timestamp 기반 replay identity, graceful lifecycle.
- `ai/kafka.py`: `kafka-python` 선택적 transport. 계약 테스트는 Kafka 없이 돈다.
- `ai/inference.py`: 외부 모델 구현을 주입하는 adapter 경계. 외부 runner가
  없으면 `AI_INFERENCE_ADAPTER_UNAVAILABLE`로 중단한다.

`python3 -m ai.runtime`의 production 기본값은 `AI_MODEL_BUNDLE_DIR`가 없을 때
`AI_MODEL_BUNDLE_NOT_CONFIGURED`로 종료한다. 번들이 있더라도 이 저장소에 실제
모델 실행 구현이 없으므로 `AI_INFERENCE_ADAPTER_UNAVAILABLE`이 발생한다. 이것은
실제 AI 추론·점수 품질·Kalman/내부 셀 온도 추정 완료를 의미하지 않는다.

## 외부에서 준비할 파일

`AI_MODEL_BUNDLE_DIR`는 호스트 PC의 **번들 디렉터리**를 가리킨다. 저장소 안에
checkpoint를 복사하지 않는다. 기본 배치는 다음과 같다.

```text
<AI_MODEL_BUNDLE_DIR>/
  metadata.json
  feature_metadata.json
  scaler.json
  lstm_autoencoder.pt
  informer.pt
```

확장자 `.pt`는 예시일 뿐이다. 실제 형식은 외부 adapter가 읽을 수 있어야 하며,
manifest의 `file`과 SHA-256이 실제 파일과 일치해야 한다. 두 checkpoint는 서로
다른 파일이어야 한다.

### `metadata.json` (bundle manifest)

필수 키는 `schema_version: 1`, `bundle_id`, `model_version`,
`feature_metadata_file`, `scaler_file`, `checkpoints`, `implementations`다.
`checkpoints`에는 반드시 `lstm_autoencoder`와 `informer`가 모두 있어야 하고,
각 항목은 다음 키를 가진다.

```json
{
  "schema_version": 1,
  "bundle_id": "<approved-bundle-id>",
  "model_version": "<approved-model-version>",
  "feature_metadata_file": "feature_metadata.json",
  "scaler_file": "scaler.json",
  "checkpoints": {
    "lstm_autoencoder": {
      "file": "lstm_autoencoder.pt",
      "sha256": "<64 lowercase hex characters>",
      "model_version": "<same as manifest>",
      "feature_version": "<same as feature metadata>",
      "feature_order": ["<feature-1>", "<feature-2>"],
      "window_size": 30
    },
    "informer": {
      "file": "informer.pt",
      "sha256": "<64 lowercase hex characters>",
      "model_version": "<same as manifest>",
      "feature_version": "<same as feature metadata>",
      "feature_order": ["<feature-1>", "<feature-2>"],
      "window_size": 30
    }
  },
  "implementations": {
    "adapter": "python:<package.module>:create_adapter",
    "score_fusion": "external:<approved-fusion>",
    "kalman": "external:<approved-kalman>",
    "internal_cell_temperature": "not_available"
  }
}
```

`adapter`는 외부에서 검토·설치한 Python package의 factory 경로를 명시한다.
`python:module:factory` 이외의 표기는 추정해 import하지 않고
`AI_INFERENCE_ADAPTER_UNAVAILABLE`로 중단한다. 실제 `feature_order`와 `window_size`는 학습 산출물의 권위 metadata를 그대로
기입한다. 코드가 `V_scaled` 등의 순서나 `30`을 추정해 보정하지 않는다.
`implementations`는 반드시 선언해야 하며 `fake`, `mock`, `stub`, `placeholder`,
`noop` 구현은 거부한다. `not_available`은 해당 파생 채널을 명시적으로
산출하지 않는 경우에만 허용되며, adapter는 그 값을 `null`로 내야 한다.

### `feature_metadata.json`

필수 키는 `schema_version`, `feature_version`, `model_version`, `feature_order`,
`window_size`, `normalization`이다. `normalization`은 `kind`, `scaler_file`,
`scaler_sha256`를 가져야 한다.

```json
{
  "schema_version": 1,
  "feature_version": "<approved-feature-version>",
  "model_version": "<same as manifest>",
  "feature_order": ["<feature-1>", "<feature-2>"],
  "window_size": 30,
  "normalization": {
    "kind": "<approved-normalization-kind>",
    "scaler_file": "scaler.json",
    "scaler_sha256": "<sha256 of scaler.json>"
  }
}
```

### `scaler.json`

필수 키는 `schema_version: 1`, `feature_version`, `model_version`,
`feature_order`, `method`, `parameters`다. `parameters`의 각 값은 feature 수와
같은 길이의 finite numeric vector여야 한다. 실제 정규화 의미는 adapter가
사용하되, loader는 scaler가 다른 feature order/version을 조용히 통과시키지
않는다.

## 기동 검증과 실패 코드

검증 순서는 환경 → bundle 디렉터리 → metadata JSON → 안전한 상대 경로 → 파일
존재/읽기 → SHA-256 → feature/scaler/checkpoint cross-check → 외부 adapter →
Kafka 연결이다. 주요 중단 코드는 다음과 같다.

| 코드 | 의미 |
|---|---|
| `AI_CONFIG_INVALID` | 환경변수·topic·broker·timeout이 유효하지 않음 |
| `AI_FAKE_ADAPTER_FORBIDDEN` | fake/mock 선택을 환경으로 시도함 |
| `AI_MODEL_BUNDLE_NOT_CONFIGURED` | `AI_MODEL_BUNDLE_DIR`가 없음 |
| `AI_MODEL_BUNDLE_NOT_FOUND` | 번들 디렉터리가 없음 |
| `AI_MODEL_BUNDLE_FILE_MISSING` | manifest·metadata·scaler·checkpoint 중 누락 |
| `AI_MODEL_BUNDLE_FILE_EMPTY` | scaler 또는 checkpoint가 비어 있음 |
| `AI_MODEL_BUNDLE_CHECKSUM_MISMATCH` | 선언 SHA-256과 파일이 다름 |
| `AI_MODEL_BUNDLE_METADATA_MISMATCH` | version/order/window/scaler 관계가 다름 |
| `AI_MODEL_BUNDLE_SCALER_INVALID` | scaler 구조·vector가 유효하지 않음 |
| `AI_MODEL_BUNDLE_IMPLEMENTATION_FORBIDDEN` | fake/mock/stub 등 구현 선언 |
| `AI_INFERENCE_ADAPTER_UNAVAILABLE` | 외부 LSTM-AE/Informer 실행 adapter 없음 |
| `AI_KAFKA_CLIENT_UNAVAILABLE` | 선택적 `kafka-python` 미설치 |

실패 시 memory fallback, placeholder score, 임의 grade, 임의 Kalman 값,
`battery_id`/`session_id` 생성은 하지 않는다.

## 메시지·offset lifecycle

1. `battery-raw-metrics`에서 v1 JSON을 받고 모드별 실제 필드/`temp_points`
   peak 불변식을 검증한다. `battery_id`와 `session_id`는 입력에도 없다.
2. 외부 adapter가 authoritative bundle로 feature 추출·정규화·두 모델 추론·
   score fusion·필요한 파생 온도 계산을 수행한다. 런타임은 이 계산을 복제하지
   않는다.
3. adapter 결과의 `model_version`이 bundle과 같은지, 두 개별 score와 final
   score가 0–1인지 검증한다. 실패하면 publish하지 않는다.
4. `evaluated_at`은 adapter의 처리 시각이 아니라 **검증된 raw frame의
   `timestamp`를 그대로 사용한다**. adapter가 반환한 `evaluated_at`도 외부
   결과 계약의 필수 timestamp로 엄격히 검증하지만, wall-clock 값이
   `(device_id, evaluated_at)` 자연키가 되도록 허용하지 않는다. 따라서 같은
   raw frame을 프로세스 재시작 후 다시 처리해도 자연키와, 나머지 adapter
   결과가 동일할 때의 직렬화 payload가 변하지 않는다.
5. `battery-anomaly-alerts` v1을 JSON으로 발행한다. partition key는 raw의
   `device_id`이며 payload에는 `device_id`만 권위 식별자로 들어간다.
6. producer 성공 응답 뒤에만 입력 offset + 1을 manual commit한다. publish 또는
   commit이 실패하면 offset을 commit하지 않고 같은 partition/offset의 직렬화된
   결과를 재사용한다. 잘못된 raw JSON/계약은 publish·commit 없이 프로세스를
   중단해 운영자가 원인을 격리할 수 있게 한다.

AI 결과의 세션·배터리 귀속은 `backend/src/anomalyConsumer.ts`가 처리 시점의
등록 device와 ACTIVE session으로 수행한다. AI 프로세스가 이를 만들거나
추정하지 않는다. 가스·압력·음향 Fail-Safe도 AI 런타임의 책임이 아니다.

## 테스트 및 외부 차단 조건

외부 패키지와 broker 없이 계약/fail-closed 테스트를 실행한다.

```bash
python3 -m unittest discover -s ai/tests -p 'test_*.py'
python3 -m py_compile ai/*.py
```

현재 직접 확인된 차단 조건은 다음과 같다.

- 저장소의 제한적 artifact 검색에서 `ai/`, checkpoint, scaler, feature metadata
  파일이 없었다.
- 따라서 실제 LSTM-AE/Informer 추론, score 품질/정확도, Kalman/내부 셀 온도
  추정, 실 Kafka roundtrip은 검증하지 않았다.
- 외부 담당자는 승인된 두 checkpoint와 scaler/feature metadata를 위 schema로
  제공하고, score fusion·Kalman·내부 셀 온도 구현을 명시한 adapter를 주입한
뒤에만 실환경 인수를 진행해야 한다. 그 전까지 Task 5 상태는
`EXTERNALLY_BLOCKED`다.

환경변수 예시는 [`ai/.env.example`](../ai/.env.example)에 둔다. 이 파일은
비밀정보나 model binary를 포함하지 않으며, `.env` 자체는 gitignore 대상이다.
