# ai/model — 이상탐지 알고리즘 베이스라인 (v0.5)

정상 방전 데이터만 학습하는 **LSTM-Autoencoder + InformerLite** 하이브리드다.
AE는 과거 96초를 복원하고(현재 상태), InformerLite는 다음 32초를 예측한다(미래 상태).
두 모델의 피처별 오차를 정상 분포로 보정한 뒤 **Max Fusion**으로 합쳐 최종 이상점수를 낸다.

이 폴더에는 **코드와 설정 JSON만** 있다. 체크포인트(`*.pt`), 전처리 CSV, 원본 측정 데이터는
`.gitignore`로 막혀 있으며 번들로 따로 전달한다(`docs/ai_inference.md`).

```
센서 시계열 (1초)
  → preprocess   ina/soc/temp CSV → 1초 공통 축, 방전 양수, 온도 통일, phase 라벨
  → features     eligible window (5 context + 96 history + 32 future) → local_relative6
  → networks     LSTM-AE (복원 오차)  ‖  InformerLite (예측 오차)
  → scoring      피처별 오차 → 정상 median/p95 보정 → 상위 2개 평균 → p99 정규화 → max(AE, Informer)
  → 위험지수 0~100 → NORMAL / CAUTION / WARNING / DANGER
```

## 파일

| 파일 | 역할 |
|---|---|
| `preprocess.py` | 원본 run 폴더(`PB*/run_*`, `18650/*/run_*`) → `<battery>_<run>.csv` |
| `features.py` | window 추출 규칙, `local_relative6` 변환 (run 통계 불필요, 온라인 적용 가능) |
| `networks.py` | `LSTMAutoencoder`, `InformerLite` (full-attention; ProbSparse로 교체 가능) |
| `scoring.py` | 피처별 오차, 보정, fusion, FAR/TPR/AUROC, 위험지수·등급 |
| `synthetic.py` | 평가 전용 합성 이상 5 시나리오 × 3 강도 (학습에 절대 사용 안 함) |
| `train.py` | 학습 → 보정/fusion 탐색 → `selected_configuration.json` + 리포트 |
| `predict.py` | 133행 물리 샘플 1개 채점 (`BaselineScorer`) |
| `adapter.py` | `ai.runtime`용 브리지 **뼈대** (미연결, 아래 "런타임 연동" 참조) |
| `configs/powerbank_v0_5_selected_configuration.json` | 보조배터리 10 run으로 선택한 v0.5 설정·보정값 |
| `tests/test_baseline.py` | 데이터 없이 도는 단위 테스트 8개 |

## 입력 피처 `local_relative6`

| 채널 | 원천 | 상대화 |
|---|---|---|
| `voltage_v` | INA 전압 | history 초반 16초 중앙값 대비 **비율** 변화 |
| `current_discharge_a` | INA 전류 (방전 = 양수) | 〃 |
| `power_discharge_w` | V × I 재계산 | 〃 |
| `cell_temp_c` | DS18B20 접촉 온도 | 초반 16초 중앙값 대비 **온도차** |
| `ir_a_temp_c`, `ir_b_temp_c` | MLX90614 ×2 표면 온도 | 〃 |

SOC·변화율은 실험(v0.5/v0.6) 결과 최종 입력에서 제외됐다.

## 실행

Python 3.10+ (`ai/` 패키지가 `dataclass(slots=True)`를 쓴다), `pip install -r ai/model/requirements.txt`.

```bash
# 1. 전처리 (Raw_data는 저장소 밖)
python -m ai.model.preprocess --data-root <Raw_data> --output data/processed_pb
python -m ai.model.preprocess --data-root <Raw_data> --output data/processed_cell --battery-type cell

# 2. 학습 + 설정 선택 (산출물은 git-ignored 폴더로)
python -m ai.model.train --processed data/processed_pb --output ai/artifacts/pb_v0_5

# 3. 샘플 1개 채점
python -m ai.model.predict --artifacts ai/artifacts/pb_v0_5 --csv sample.csv --run PB20000_run_04_2A

# 테스트
python -m unittest ai.model.tests.test_baseline
```

빠른 동작 확인: `train.py --epochs 1 --max-windows 300 --synthetic-per-run 2`.

## v0.5 결과 (보조배터리 10 run, 정상 재사용 오탐 1% 고정)

| 구성 | 합성 이상 탐지율 | AUROC |
|---|---:|---:|
| AE 단독 | 70.79% | 0.8727 |
| InformerLite 단독 | 91.29% | 0.9792 |
| **Max Fusion (선택)** | **92.33%** | 0.9787 |

- 정상 오탐률은 학습에 쓴 run을 재사용한 **개발 단계 수치**다. 미사용 배터리 성능이 아니다.
- 탐지율은 설계된 합성 패턴에 대한 반응이며 실제 열폭주 검증이 아니다.
- 예측 오차는 다음 32초 실측이 확보된 뒤 계산되므로 32초 조기 경보를 입증한 것이 아니다.

## 모델 인스턴스 계획

같은 코드로 **배터리 종류 × 진단 길이**별 인스턴스를 따로 학습한다. 보조배터리는 승압 회로 뒤 5V
출력이라 전압이 거의 일정하고, 18650은 셀 전압 곡선이 그대로 보여 정상 패턴이 다르기 때문이다.

| | Full (완전 방전, 수 시간) | Quick (현장 5분) |
|---|---|---|
| 보조배터리 (모드 2) | v0.5 (이 설정) | 계획 — 첫 5분 학습, 전역 보정, Safety Gate 병행 |
| 18650 (모드 1) | 계획 — 같은 파이프라인, `--battery-type cell` | 이후 |

## 런타임 연동 (2026-09-29 구현)

`export_bundle.py` → 번들 → `adapter.py` 경로가 연결됐다. **실제 학습 산출물로는 아직 한 번도 돌려 보지 않았다**
(무작위 초기화 모델로 형식·동작만 테스트). 실행:

```bash
python -m ai.model.export_bundle --artifacts <global 보정으로 학습한 폴더> --output <AI_MODEL_BUNDLE_DIR>
AI_MODEL_BUNDLE_DIR=<위 폴더> python -m ai.runtime
```

- **내보내기가 거부하는 것**: `per_run` 보정, AE·Informer의 feature set 불일치, `local_relative5` 이외.
- **스칼라 설정**(`score_q99`·임계·top-k·융합 가중)은 번들 형식상 벡터만 허용돼 **상수 벡터로 저장**한다. `bundle.py`는 바꾸지 않았다.
- **점수 매핑**(`scoring.wire_score`): 융합 점수/임계 비율 0.25·0.5·1.0·≥2.0 → 0.3·0.6·0.8·1.0. 비율 1.0(학습 정상 p99)이 위험 경계다. 실제 이상 데이터가 생기면 재조정.
- **1초 격자**는 학습(`merge_asof nearest`)과 같게 **정시에 가장 가까운 프레임 1개**를 쓴다(평균·최댓값 아님).
- **점수가 없는 경우**(어댑터가 `None` 반환, 런타임은 발행 없이 커밋만): 창 채우는 중, 1초 이상 결측, 값 누락, 부하 0.1A 이하(대기·충전). 첫 점수는 활성 연속 173초(startup 10 + 보정 30 + 창 133) 뒤.
- **Informer 성분은 32초 지연**이다(다음 32초 실측과 비교). 발행 점수는 그 프레임 32초 전에 끝난 창의 것이다.
- **거부(예외)**: 모드 1 프레임, IR 존 수가 2가 아닌 프레임 — 학습하지 않은 입력이므로 서비스를 멈춘다.
- Kalman·내부 셀 온도는 `None`(번들 `not_available`).
