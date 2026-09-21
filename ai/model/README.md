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

## 런타임 연동 (미완료)

`adapter.py`는 아직 `ai.runtime`에 연결되지 않았다. 남은 계약 차이:

1. **모드 2 접촉온도 없음** — 웹 계약(`temp_contact = null`)과 2026-09-20 이후 측정 run에는 DS18B20
   접촉 온도가 없다. v0.5 설정은 `cell_temp_c`를 쓰므로 IR 2존만 쓰는 재학습 설정이 필요하다.
2. **보정 범위** — v0.5는 `per_run` 보정(run id 필요). 런타임은 `global` 보정 설정을 써야 한다.
3. **점수 스케일** — 런타임/백엔드는 0~1 점수와 0.3/0.6/0.8 등급을 가정한다. 베이스라인 점수는
   임계값 정규화(≈1.0 = 경고)이고 사용자 표시는 0~100 위험지수(60/80/95)다. 매핑을 합의해야 한다.

세 항목이 정리되면 `export_bundle`로 `metadata.json`/`feature_metadata.json`/`scaler.json`을 만들고
`create_adapter`를 `BaselineScorer`에 연결한다.
