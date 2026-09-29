# 데이터 계약 — Kafka / PostgreSQL

**2026-08-31 · 실측 18 run · 176,533 표본**
대시보드팀 · 알고리즘팀이 이 문서만 보고 붙일 수 있도록 쓴다.

---

## 1. Kafka 메시지 (`battery-data`)

7월 설계산출물의 **5필드 계약을 그대로 유지**하고 키만 덧붙였다.
v1 Consumer 는 추가 키를 무시하므로 고칠 필요가 없다.

```json
{
  "timestamp": "2026-08-31T02:52:26.781000",
  "voltage": 4.1413,
  "current": -0.9908,
  "temperature": 28.99,
  "soc": 100.0,

  "run_id": "18650_b1_1A_20260831",
  "elapsed_s": 0.0,
  "source": "replay",

  "_ext": {
    "power_w": 4.1032,
    "ds_cell_c": 29.44, "ds_ambient_c": 28.81,
    "mlx5a_obj_c": 28.99, "mlx5b_obj_c": 28.79,
    "mlx5a_amb_c": 27.53, "mlx5b_amb_c": 27.87,
    "dod_ah": 0.0, "dod_wh": 0.0
  }
}
```

토픽 `battery-data` · 파티션 0 · 키 `cell_A` (v1 그대로).
run 메타데이터는 Kafka 가 아니라 **`runs_manifest.json`** 으로 전달한다.

---

## 2. 값을 읽을 때 반드시 알아야 할 것

### `current` 는 방전이 **음수**다
절대값이 필요하면 `abs(current)`. 부호를 그대로 그리면 그래프가 뒤집힌다.

### `temperature` 는 **평균이 아니라 두 IR 중 큰 값**이다

```
temperature = max(mlx5a_obj_c, mlx5b_obj_c)
```

평균을 쓰면 안 된다. 두 적외선 센서 중 한쪽은 run 마다 겨냥이 빗나가 **실온을 읽는
경우가 있고**, 평균은 그 실온에 끌려 발열 신호를 죽인다. 실제로 한 run 에서 `0x5B`
가 셀을 전혀 보지 못했는데 `max()` 덕분에 데이터가 살아남았다.

**접촉식(`ds_cell_c`)을 대표 온도로 쓰지 말 것.** 케이스에 막혀 IR 핫스팟보다
**14~18℃ 낮게** 읽는다 (한 run 에서 IR 48.8℃ / 접촉 30.5℃).

### `soc` 는 실시간 추정치가 아니다

전류 적산을 **그 run 의 총 전하량으로 정규화**한 값이라 run 이 끝나야 계산된다.

- `soc = 100` 은 **절대 완충이 아니라 그 run 의 시작점**이다.
- run 마다 시작 SOC 가 다르다. `18650_b1` 은 사전에 131 mAh 가 빠진 상태에서
  시작했으므로 실제로는 절대 SOC 94.4% 지점이 100 으로 찍혀 있다.
- **run 을 가로질러 SOC 를 비교하면 안 된다.** run 내부 진행축으로만 쓴다.

> 실시간 SOC 는 아직 없다. 설계상 BQ27441(0x55) 이 담당하기로 돼 있었으나
> **실물 벤치에 그 칩이 없다** (I²C 스캔에 `40 48 5a 5b` 만 잡힌다).
> 다만 18650 기준 용량이 **2,362 mAh** 로 확정됐으므로, 라이브 전환 때
> `SOC = 100 × (1 − ∫I dt ÷ 2362mAh)` 로 실시간 계산이 가능해졌다.

### `delta_c` 는 제공하지 않는다
셀−실온 차분은 실온이 run 도중 움직이면 발열이 그대로여도 값이 줄거나 음수가 된다.
실제로 오독한 적이 있어 폐기했다. 발열 비교는 **부하 차단 후 냉각 곡선**으로 한다.

---

## 3. PostgreSQL

`schema_v2.sql` 을 한 번 실행한다.

| 테이블 | 내용 |
|---|---|
| `runs` | run 18개의 조건·결과. **이상탐지 라벨이 여기 있다** |
| `battery_logs` | 시계열 본체. 5필드 계약 + `run_id`·`elapsed_s`·`source` |
| `battery_logs_ext` | 원본 센서값 (DS ×2, MLX ×2, 전력, 누적) |
| `v_run_summary` | run 별 요약 뷰 |
| `v_collapsed_runs` | 붕괴 run 만 |

`UNIQUE(run_id, timestamp)` 라 **리플레이를 여러 번 돌려도 중복이 쌓이지 않는다.**

### run 경계를 반드시 지킬 것

`battery_logs` 를 `run_id` 없이 통으로 조회하면 서로 다른 배터리·조건·시각의
데이터가 섞인다. **모든 시계열 조회에 `WHERE run_id = ...` 를 건다.**

한 run 안에도 기록 공백이 있을 수 있다(접촉 불량으로 5.5분 끊긴 run 이 있다).
공백을 평균으로 메우면 에너지가 부풀려진다 — 실제로 한 run 이 그 때문에
**7.18 → 16.14 Wh 로 2.2배** 부풀려져 3종 중 최고 성능처럼 보인 적이 있다.
`elapsed_s` 간격이 벌어진 구간은 **보간하지 말고 끊어서** 그린다.

---

## 4. 이상탐지 라벨 (알고리즘팀)

`runs.result` 가 라벨이다.

| result | 개수 | 의미 |
|---|---|---|
| `completed` | 14 | 정상 종료 |
| `collapsed` | 3 | **CP 되먹임 붕괴 — 양성 라벨** |
| `aborted` | 1 | 시험 중단 (학습에서 제외 권장) |

### 붕괴가 무엇인가

정전력(CP) 방전에서 전류가 포트 정격에 닿으면 팩이 전류 제한에 들어가 전압을
낮추고, CP 부하는 `I = P/V` 를 지키려 전류를 더 요구한다 → 되먹임이 발산해 수직 붕괴.

**고갈이 아니다.** 붕괴 후에도 팩에 80~90% 가 남아 있었다.

> ⛔ **2026-09-03 정정 — 「전압 절벽」은 DB 에 없다.**
> 구판은 정상 종료를 「한 샘플에 절벽」, 붕괴를 「가속하는 무릎」으로 갈랐는데,
> **그 절벽은 0.1초 INA 원본에만 있고 이 DB 에는 실려 있지 않다.**
> `ina_log.py --stop-v 3.0` 이 3.0 V 에서 기록을 멈추기 때문이다. 실제로 DB 의
> **모든 run 최저 전압이 2.9988 V** 이고, CP run 의 마지막 전압은 3.4~4.9 V 다.
>
> | run | result | 마지막 전압 |
> |---|---|---|
> | `PB20000_c1` | completed | 4.920 V |
> | `PB10000_c6` | completed | 3.949 V |
> | `PB10000_c2` | collapsed | 3.871 V |
> | `PB5000_c3` | collapsed | 3.449 V |
>
> **종료 직전 파형만으로 라벨을 재현하려 하지 말 것.** 끝 부분이 잘려 있어
> 완주 run 과 붕괴 run 의 마지막 십수 초가 서로 비슷하게 보인다.

### 라벨과 상관있는 것 — 전류가 포트 정격에 얼마나 닿는가

CP 부하는 `I = P/V` 를 지키므로 전압이 처질수록 전류를 더 끌어간다. 이 전류가
팩의 포트 정격에 닿는 정도가 붕괴와 이어진다. **DB 값으로 직접 확인된다:**

| run | result | 시작 전류 | 최대 전류 | 정격 대비 최대 | Wh |
|---|---|---|---|---|---|
| `PB20000_c1` | completed | 2.062 A | 2.072 A | **54%** | 52.15 |
| `PB10000_c6` | completed | 1.796 A | 2.328 A | **97%** | 28.27 |
| `PB5000_c7` | completed | 1.857 A | 2.315 A | **110%** | 6.59 |
| `PB20000_c8` | collapsed | 2.924 A | 3.818 A | **100%** | 39.24 |
| `PB10000_c2` | collapsed | 2.189 A | 2.628 A | **109%** | 5.76 |
| `PB5000_c3` | collapsed | 2.093 A | 2.927 A | **139%** | 0.43 |

포트 정격: PB-20000 3.83 A · PB-10000 2.40 A · PB-5000 2.10 A.

> ⚠️ **단일 문턱으로는 안 갈린다.** `c7`(완주)이 110% 까지 갔고 `c8`(붕괴)은 100% 에서
> 무너졌다 — 두 부류가 겹친다. 양성 표본이 3개뿐이라 **문턱을 학습으로 정하지 말고
> 판별식의 후보 특징으로만 쓸 것.**
>
> 상위 `CLAUDE.md` 의 「시작 전류가 정격의 85% 이하면 완주」 규칙은 **이 DB 데이터로는
> 성립하지 않는다** — `c8` 은 76% 에서 시작해 붕괴했고 `c7` 은 88% 에서 시작해 완주했다.

### 가장 확실한 신호는 「전달 에너지」다

붕괴는 고갈이 아니므로 **같은 팩이 낼 수 있는 양보다 훨씬 적게 내놓고 끝난다.**

```
PB-10000 :  c6 완주 28.27 Wh   vs   c2 붕괴 5.76 Wh   →  20% 만 내고 멈췄다
```

`runs.energy_wh` 를 같은 `battery` 의 최댓값과 비교하면 라벨과 거의 일치한다.
다만 이것은 **run 이 끝나야 알 수 있는 값**이라 실시간 탐지에는 못 쓴다.
실시간으로 쓰려면 위의 전류/정격 비를 봐야 한다.

**CC 모드에서는 붕괴가 일어나지 않는다.** 전류가 고정이라 되먹임이 없다.
CP 고유의 실패 모드다.

---

## 5. 실행 순서

```bash
# 0) 스키마 (최초 1회)
psql -U battery_admin -d battery_ctrl_db -f schema_v2.sql

# 1) 무엇이 실릴지 확인
python replay_producer.py --dry-run

# 2) Consumer 를 먼저 띄운다
python consumer_v2.py --broker <EC2_IP>:9092 --from-beginning --idle 60

# 3) 리플레이 — 60배속이면 전체가 수십 분
python replay_producer.py --broker <EC2_IP>:9092 --speed 60

#    빠르게 벌크 적재만 하려면
python replay_producer.py --broker <EC2_IP>:9092 --speed 0 --every 5
```

`--speed 1` 은 실시간 재생이라 대시보드 라이브 동작 시연에 쓴다.
`--every 5` 는 5행마다 1건만 보내 데이터량을 1/5 로 줄인다.

---

## 6. 대시보드용 질의 예시

```sql
-- run 목록 (선택 드롭다운)
SELECT run_id, battery, mode, setpoint, result, duration_h, energy_wh
FROM runs ORDER BY started_at DESC;

-- 한 run 의 시계열 (그래프)
SELECT elapsed_s, voltage, abs(current) AS current_a, temperature, soc
FROM battery_logs WHERE run_id = $1 ORDER BY elapsed_s;

-- 최근 30초 라이브 (실시간 패널)
SELECT * FROM battery_logs
WHERE source = 'live' AND timestamp > now() - interval '30 seconds'
ORDER BY timestamp;

-- 붕괴 직전 60초 (이상탐지 검증)
SELECT l.elapsed_s, l.voltage, abs(l.current) AS i
FROM battery_logs l JOIN runs r USING (run_id)
WHERE r.result = 'collapsed'
  AND l.elapsed_s > r.duration_h * 3600 - 60
ORDER BY r.run_id, l.elapsed_s;
```

---

## 7. 알려진 한계

| 항목 | 상태 |
|---|---|
| 실시간 `soc` | 없음 — BQ27441 미장착. 쿨롱카운팅으로 대체 예정 |
| `pressure` / 가스 / 음향 | ADS1115 는 달려 있으나 **이번 축에서 미사용** |
| 샘플 주기 | 리플레이는 1초. 원본 INA226 은 0.1초지만 스트림에는 싣지 않는다 |
| 부하 인가 직후 과도(R0/R1) | 0.1초 원본 CSV 에만 있다. DB 로는 안 온다 |
| **종료 시점의 전압 절벽** | **DB 에 없다.** 로거가 3.0 V 에서 멈춰 그 아래가 안 실렸다 (§4 참조) |
| `energy_wh` 의 계기 차 | DB 는 1초 `_soc.csv` 적분값이다. `CLAUDE.md` 의 표는 0.1초 INA 원본 기준이라 **최대 6% 차이**가 난다 (`c2`: DB 5.757 vs 문서 6.104). 한 자료 안에서는 일관되므로 **섞어 인용하지 말 것** |
| DS 두 채널 | 2026-08-26 15:44 이전 12개 run 은 원본이 반대였다. **적재 시 되돌렸으므로 DB 는 정방향**이다 (`runs.ds_swapped` 로 식별 가능) |
