# ai_results

| 폴더·파일 | 내용 | 데이터 |
|---|---|---|
| `pb_v0_5_part2/` | 6채널 학습 결과 (현재 기준) | 13 run, 정상창 15,978, **`ina_part2` 포함** |
| `pb_5feat_part2/` | 5채널(`local_relative5`) 학습 결과 (현재 기준) | 위와 같음 |
| `PB20000_r15_2A_scores_part2.csv` | r15 를 5채널(part2) 모델로 채점한 창별 점수 | per_run 보정 |
| `pb_v0_5/`, `pb_5feat/`, `PB20000_r15_2A_scores.csv` | **이전 결과 — `ina_part2` 두 개(r1, r3b)를 빠뜨린 데이터로 학습** | 정상창 15,434. 참고용 |

수치는 모두 개발 단계 값이다(오탐률은 학습 run 재채점, 탐지율은 합성 패턴 반응, hold-out 없음).
체크포인트(`*.pt`)는 저장소에 없다. 재현하려면 `raw_data` 브랜치(`data/raw`)의 `stage_for_preprocess.py` 로 풀고 학습한다.
