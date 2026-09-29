# raw_data — 방전 원자료 (0.1초 원본, gzip)

2026-08-08 ~ 2026-09-28 의 방전 run 전체. **0.1초 원본을 줄이지 않고** 그대로 gzip 했다(파일당 3.4 MB 이하).
`*.csv.gz` 는 `pandas.read_csv` 가 그대로 읽는다. 합계 **107개 파일, 394 MB → 49.9 MB**.

    python verify_manifest.py .                      # sha256 대조
    python stage_for_preprocess.py . /tmp/stage      # preprocess.py 가 기대하는 배치로 풀기

## 구조

    <run 폴더>/<접두>_ina.csv.gz        INA226 0.1초: timestamp,elapsed_s,voltage_v,current_a,power_w,shunt_check_a,ovf
    <run 폴더>/<접두>_mlx01.csv.gz      IR 0.1초: mlx5a/5b obj·amb, temp_ir_surface(=max), missing
    <run 폴더>/<접두>_temp.csv.gz       온도 1초: ds18b20_c, ds_ambient_c, delta_c, mlx5a/5b obj·amb
    <run 폴더>/<접두>_soc.csv.gz        ina+temp 를 합친 1초 파생물 (add_soc.py). SOC 는 출력단 기준
    *_ina_part2 / *_ina_aborted* / *_ina_startup   로거 재시작·중단·시동 구간
    pilot_20260809/  8/9 예비 시험 (전자부하 소프트웨어 CSV)    misc/  기타

`MANIFEST.csv`: 파일별 kind · 줄 수 · 원본/압축 크기 · sha256(원본) · 첫/끝 시각.

## 폴더 이름 → 팩

| 폴더 접두 | 팩 | 비고 |
|---|---|---|
| `PB20000_*` | **원본 PB-20000** | r1 r4 r9 (CC 1/2/3A), c1 c4 c8 (CP), r12 r15 (CC 2A, 9월) |
| `PB10000_*` | 원본 PB-10000 | r2 r5 (CC), c2 c6 (CP) |
| `PB5000_*` | PB-5000 | r3 r3b r6 (CC), c3 c7 (CP) |
| **`PB20KB_*`** | **PB-20000B — 별개 팩, 열화 판정** | r10. 원본과 섞지 말 것 |
| **`PB10KB_*`** | **PB-10000B — 별개 팩** | r11 |
| `18650_b1/b2/b3_*` | 18650 맨 셀 BAT01/02/03 (1A/2A/3A) | 4선식 지그 |

`r` = CC(정전류), `c` = CP(정전력). 접미 `1A/2A/3A` 는 CC 전류, `10W` 등은 CP 전력.
**팩의 정체를 두 번 착각한 적이 있다(9/24, 9/28).** 새 run 은 어느 팩인지 폴더 이름에 명시할 것.

## 읽기 전에 알아야 할 것

- **전류 부호**: `current_a` 는 방전이 **음수**다. `preprocess.py` 가 양수(`current_discharge_a`)로 바꾼다.
- **DS18B20 열의 의미가 시기별로 다르다.**
  - `c6`(8/26) 이전: `ds18b20_c` = 공중, `ds_ambient_c` = 표면 (배치가 반대였음 → 문서 정정). 이 시기 `delta_c` 는 **부호가 반대**이고 어차피 폐기한 지표다.
  - 9/20 이후 모드 2: **`ds18b20_c` 는 비어 있다**(접촉 프로브 폐기), `ds_ambient_c` = 실온.
- **`r12`(9/24)는 `ina` 만 있다** (온도·IR 로거를 안 띄웠다) → AI 학습에 못 쓴다.
- **`r15`(9/28)는 부착 검증을 건너뛰었다.** `ir_a`/`ir_b` 가 run 내내 3.5℃ 벌어져 있다(겨냥 차). 대표값은 `max(5a,5b)`.
- **`*_aborted*` 는 방전이 아니다**(팩이 잠들어 중단된 구간). 학습·에너지 계산에서 뺀다.
- **기록 공백을 평균 전류로 메우면 안 되는 경우가 있다.** 공백 경계의 전압을 본다:
  `r1` 의 593초는 로거만 재시작(보정 가능), `r3b` 의 6,699초는 **방전 중단**(0.04 V 로 끝남 → 보정 금지).
- **`ina_part2` 는 `r1` 과 `r3b` 에 있다.** `preprocess.py` 는 `ina.csv` 뒤에 이어 붙인다. `stage_for_preprocess.py` 는 이를 같이 푼다.
- `soc` 는 부스트 컨버터 뒤(5V 출력) 기준이라 **셀의 진짜 SOC 가 아니다**. 진짜 SOC 는 18650 에서만 나온다.
- 이 저장소에는 학습 산출물(`*.pt`)이 없다. 재학습으로 만들 것.
