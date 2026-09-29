# C1 실행표 — PB-20000 CP 10W

> 근거: 2026-08-25 기준 CC 8 run 재분석. 예측치는 전부 실측에서 뽑았다.
> 계획서: `CP모드_방전계획_20260825.md` §9 최소실행안의 첫 번째 run.

---

## 0. 시작 전 확인 (하나라도 아니면 멈춘다)

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | **BW150에 CP 모드가 있는가** | `Setup` → 모드 목록. 없으면 이 run 은 성립하지 않는다 (계획서 §6) |
| 2 | **PB-20000이 완충인가** | LED 4칸. r9(3A)를 8/24에 돌렸으니 충전이 끝나 있어야 한다 |
| 3 | **파이 접속** | `.\find_pi.ps1` → SSH 되면 `.\deploy_pi.ps1 -IP <IP>` |
| 4 | **로거 스크립트 6개가 파이에 있는가** | `deploy_pi.ps1` 이 확인해준다 |

---

## 1. 점검

```bash
python3 ~/preflight.py PB20000_c1_10W
```

`GO` 가 떠야 한다. `NO-GO` 항목별 대처:

| 항목 | 뜻 |
|---|---|
| `CH3 already ON` | 마스터가 켜져 있다. `pinctrl set 13 op dh` 로 끄고 다시 |
| `loggers already running` | `pgrep -f "[i]na_log" \| xargs -r kill` (CLAUDE.md 주의 참조) |
| `output prefix ... already has N CSV(s)` | 같은 이름의 이전 파일이 있다. 옮기거나 이름을 바꾼다 |
| `DS ... = PWR` | `t=85000` — VCC 미인가. 배선을 다시 꽂는다 |

**기준선을 반드시 적어둘 것**: `baseline delta_c`, `baseline mlx5a diff`.

---

## 2. 센서 부착 검증

```bash
python3 ~/sensorwatch.py 40
```

40초 동안 팩을 손으로 감싼다. **4채널이 전부 `OK`** 여야 한다.

> ⚠️ **이번 재분석에서 드러난 문제다.** r3b는 `mlx5a`가 방전 내내 반응이 없었고(낙폭 −0.016 ℃),
> r4·r9는 `mlx5b`가 5a의 1/7밖에 안 나왔다. **겨냥이 run 마다 달랐다**는 뜻이라
> 두 센서 사이 비교가 성립하지 않는다. 이 단계를 건너뛰지 말 것.

---

## 3. 로거 기동 — 로드보다 **먼저**

```bash
nohup python3 -u ~/thermal_log_alarm.py 1 ~/PB20000_c1_10W_temp.csv 55 </dev/null > ~/temp_logger.out 2>&1 &
nohup python3 -u ~/mlx_fast_log.py 0.1 ~/PB20000_c1_10W_mlx01.csv --rise 3 --window 30 </dev/null > ~/mlx_logger.out 2>&1 &
nohup python3 -u ~/ina_log.py 0.1 ~/PB20000_c1_10W_ina.csv --stop-v 3.0 --max-a 3.0 </dev/null > ~/ina_logger.out 2>&1 &
```

> ⚠️ **MLX 로거는 로드보다 최소 60분 먼저 띄운다.** 3분이 아니다.
> 재분석에서 확인된 것: `obj − amb` 는 로거 기동 후 **약 1시간의 정착 과도**가 있다.
> r1은 MLX 내부 `TA`가 24.5℃에서 시작해 1시간에 걸쳐 28.5℃로 올라갔고,
> 그 구간을 기준선으로 잡는 바람에 발열이 **음수로** 계산됐다.
> 60분이 어려우면 최소 20분이라도 벌고, **끝나고 꼬리를 30분 이상 받는다**(§6).

`tail -f ~/temp_logger.out` 로 센서 2개가 `OK` 인지 눈으로 확인한다.

---

## 4. 전력 경로

```bash
pinctrl set 5,6,13 op dh ; pinctrl set 19 op dl     # CH4 = 모드 2, 마스터 OFF
```

배터리 연결 → 무부하 검사 → BW150 **CP · 10.00 W** 설정 → `Cap`·`Ene` **0으로 초기화** → 출력 ON

```bash
pinctrl set 13 op dl                                 # 마스터 ON
python3 ~/ina_check.py 10 PB20000-CP10W
```

**`I_reg ≈ −2.00 A`, `Power ≈ 10.0 W`, `mismatch < 0.02`** 를 확인하고 넘어간다.

---

## 5. 예측 — 어긋나면 측정을 의심한다

r4(PB-20000 CC 2A, 평균 9.829 W)가 직접 대조군이다. CP 10.0 W 는 그보다 1.7% 높다.

| 항목 | 예측 | 근거 |
|---|---|---|
| 전류 | **2.01 ~ 2.02 A 로 거의 일정** | r4 전압이 4.940~4.974 V 로 평탄했다 |
| 지속 시간 | **약 5.2 h** | r4 에너지 52.52 Wh ÷ 10 W |
| 에너지 | **51 ~ 53 Wh** | r4 52.52 Wh · CC↔CP 차이가 없다면 |
| 냉각 꼬리 낙폭 | **+6.0 ~ +6.5 ℃** | r4 +6.234 ℃ (거의 같은 전력) |
| `R_th` | **0.60 ~ 0.65 ℃/W** | r4 0.634 |

> 계획서 §4는 말미 전류를 2.6 A로 봤지만 **PB-20000에는 해당하지 않는다.**
> 그 팩은 출력이 컷오프 직전까지 평탄하다. 2.6 A 는 PB-5000·PB-10000 얘기다.
> 그래도 **컷오프 순간의 수직 강하 때는 순간 전류가 튄다** — `--max-a 3.0` 은 그 여유다.

**이 run 이 답하는 것**: 같은 전력에서 CC 와 CP 가 같은 에너지·같은 발열을 주는가.
차이가 없으면 나머지 CP run 은 안 해도 된다(계획서 §9).

---

## 6. 종료

```bash
pinctrl set 13 op dh          # 마스터 OFF
```

> ⚠️ **로거는 여기서 끄지 않는다. 30분 이상 더 돌린다.**
> 냉각 꼬리가 이번 재분석의 **1차 발열 지표**가 됐다 — 부하를 끊으면 부하로 생긴 열만
> 감쇠하므로 기준선 없이 발열을 뽑을 수 있다. r1은 꼬리가 2분뿐이라 **발열 값을 못 냈다.**
> 20분 미만이면 감쇠가 덜 끝나 신뢰할 수 없다.

30분 뒤:

```bash
pgrep -f "[i]na_log|[m]lx_fast_log|[t]hermal_log" | xargs -r kill
```

배터리 분리 → `pinctrl set 19 op dh`

---

## 7. 회수 · 분석

```powershell
scp <USER>@<IP>:~/PB20000_c1_10W_*.csv "C:\Users\<USER>\Desktop\라즈베리파이5테스트\PB20000_c1_10W_20260825\"
```

```bash
python analyze_run2.py "...\PB20000_c1_10W_20260825" --label-mah 20000 --name "PB-20000 CP 10W (c1)"
```

`compare_runs.py` 의 `RUNS` 목록에 한 줄 추가하면 8 run 과 나란히 비교된다:

```python
("PB20000_c1_10W_20260825", "c1", "PB-20000", "CP", "10W", 20000),
```
