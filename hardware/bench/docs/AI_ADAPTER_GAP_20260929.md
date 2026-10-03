# AI 번들 ↔ 런타임 연결: 형식 차이와 결정 필요 항목 (2026-09-29)

`STATE_20260929.md` §5 의 3번(「번들 형식 연결(`adapter.py`)」)을 위해 코드를 대조한 결과다.
대상: `ai/bundle.py`·`ai/contracts.py`·`ai/inference.py`(main) 와
`ai/model/{features,preprocess,predict,scoring,adapter}.py`(`feat/mode2-5feature`, 45e752d).
**2026-09-29 갱신: §2 의 권고 A–D 를 그대로 채택해 구현했다**(`ai/model/export_bundle.py`, `adapter.py`, `scoring.wire_score`, 테스트 `ai/model/tests/test_adapter.py`). 결정 B(32초 지연)는 문구 명시로 처리했고, §2-5 의 `bundle.py` 계약 변경은 하지 않았다(스칼라는 상수 벡터로 저장). 실제 학습 산출물로는 미검증.

## 1. 형식이 안 맞는 곳 (사실)

| # | 런타임(`bundle.py`)이 요구 | 학습 산출물(`train.py`/`predict.py`) | 결과 |
|---|---|---|---|
| 1 | `scaler.json` 1개, `parameters` 의 **모든 값이 `len(feature_order)` 길이의 벡터** | 모델별 스케일러 2개(AE·Informer 각각 `mean`/`std`), 보정값 `median`/`spread`(벡터) + **`score_q99`(스칼라)** | 스칼라 `score_q99` 는 `_finite_vector` 에서 `AI_MODEL_BUNDLE_SCALER_INVALID` |
| 2 | `feature_order` 1개, 두 체크포인트가 **동일** | AE·Informer 가 서로 다른 `feature_set` 을 고를 수 있음(`selected_configuration.json` 의 `features`) | 다르면 `AI_MODEL_BUNDLE_METADATA_MISMATCH` |
| 3 | `window_size` 1개(문서 예시 30) | 물리 창 **133행**(context 5 + history 96 + future 32), 모델 입력 128 | 어느 값을 `window_size` 로 쓸지 정의 없음 |
| 4 | `.pt` 는 파일 존재·SHA 만 검사 | `predict.py` 는 `config` JSON 이 체크포인트·스케일러 **경로 이름**을 참조 | 번들 내 파일명 규칙 필요 |
| 5 | 점수 0.0–1.0, 등급 0.3/0.6/0.8 (서버 계산) | 점수는 임계 정규화(**1.0 ≈ 경고 경계**), 사용자 표시는 `risk_index` 0–100, 경계 60/80/95, 등급명 NORMAL/CAUTION/WARNING/DANGER | 스케일·경계 둘 다 다름 (§2-A) |

## 2. 결정이 필요한 것 (내 권고 포함)

### A. 0–1 점수 매핑
`risk_index` 경계(60/80/95)와 웹 등급 경계(30/60/80)가 다르다. `risk_index/100` 을 그대로 쓰면
같은 사건이 모델 쪽에서는 CAUTION, 웹에서는 WARNING 으로 나온다.

**권고**: `ratio = final / threshold` 를 구간 선형으로 매핑한다.

| ratio | wire score | 웹 등급 경계 |
|---|---|---|
| 0 | 0.0 | — |
| 0.25 | 0.3 | 정상→주의 |
| 0.5 | 0.6 | 주의→경고 |
| 1.0 | 0.8 | 경고→위험 (= 학습 정상 p99 초과, 즉 임계) |
| ≥ 2.0 | 1.0 | 상한 |

「임계(ratio 1.0)를 넘으면 위험」이 되도록 잡은 것이다. 경계 수치는 실제 이상 데이터가 생기면 다시 조정한다.
등급은 서버가 계산하므로 어댑터는 등급명을 내지 않는다.

### B. 32초 지연
Informer 점수는 **다음 32초의 실측**과 비교해 나온다(`feature_errors`, `target = future`).
실시간 프레임 T 에서 낼 수 있는 점수는 **T−32s 시점의 창**에 대한 것이다.
`README` 도 「32초 조기 경보를 입증한 것이 아니다」라고 적고 있다.

- `evaluated_at` 은 런타임이 **원시 프레임 timestamp** 로 덮어쓴다(`build_anomaly_alert`).
  그러면 wire 상 점수가 실제로는 32초 전 창의 것인데 시각은 지금으로 찍힌다.
- **권고**: 그대로 두되 `docs/ai_inference.md` 와 대시보드 문구에 「Informer 성분은 32초 지연」을 명시한다.
  AE 성분은 지연이 없으니(과거 96초만 사용) 필요하면 AE 단독 점수를 즉시 값으로 쓰는 안도 있다.
  **어느 쪽인지는 팀 결정.**

### C. 학습과 서빙의 1초 격자 처리 불일치 (train/serve skew)
- 학습 `preprocess.resample_run`: 1초 격자에 **최근접 샘플**(`merge_asof nearest`)을 붙이고 결측은 `interpolate(limit=2)`.
- 서빙 `adapter.SecondAggregator._reduce`: 1초 구간 **평균**(V/I/W), **최댓값**(온도).

100ms 프레임을 평균내면 학습 때 없던 평활이 생기고, 온도는 max 라 상향 편향이 있다.
**권고**: 서빙을 학습에 맞춘다 — 각 1초 경계에 가장 가까운 프레임 1개를 쓴다.
(반대로 학습을 평균으로 바꾸면 재학습 + 13 run 재전처리가 필요하다.)

### D. IR 채널 수
모델 입력은 `ir_a_temp_c`/`ir_b_temp_c` 2개로 고정이다. 어댑터 `frame_to_row` 는 IR 이 1개면
`ir_b = ir_a` 로 복제한다. 모드 1 은 IR 1존이라 별도 모델이 필요하고, 모드 2 도 존 수가 바뀌면
(CLAUDE.md: `temp_points.ir` 길이를 상수로 박지 말 것) 재학습이 필요하다.
**권고**: 어댑터는 `len(ir) != 2` 이면 추론을 거부한다(복제로 메우지 않는다).

## 3. 막힌 것 (데이터가 로컬에 있음)
- `global` 보정으로 재선택한 `selected_configuration.json`이 없다 → 어댑터가 `scope != "global"` 이면 기동 거부하도록만 지금 만들 수 있다.
- 5채널 체크포인트(`*.pt`)와 스케일러는 로컬 `ai_artifacts/` 에만 있다.

## 4. 결정이 나면 할 일 (순서)
1. `export_bundle`: 두 스케일러 + 보정값을 §1-1 제약에 맞게 직렬화 (`score_q99` 는 길이 k 벡터로 복제하거나, `bundle.py` 가 스칼라를 허용하도록 계약 변경 — **후자는 `ai/` 계약 변경이라 팀 합의 필요**).
2. `create_adapter`: `global` 만 허용, IR 2존만 허용, §2-A 매핑, §2-C 격자 규칙.
3. 합성 데이터로 소형 학습(`train.py --epochs 1 --max-windows 300`) → 번들 → `ai.runtime` 통합 테스트 (CI 에서 돈다).
