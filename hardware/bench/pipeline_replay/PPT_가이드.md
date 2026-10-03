# PPT 자료 — Kafka · PostgreSQL 파이프라인

**2026-09-03.** 슬라이드에 그대로 넣을 이미지·코드·숫자를 정리했다.
모든 수치는 **가동 중인 DB 에서 직접 뽑은 값**이다.

---

## 이미지 파일

`ppt_assets/` 안에 있다. **PowerPoint → 삽입 → 그림**으로 넣으면 **벡터로 들어가** 확대해도
글자가 깨지지 않는다. (Office 2016 이전 판은 SVG 를 못 읽는다 — 그때는 말해 달라, PNG 로 뽑아 준다.)

| 파일 | 쓸 슬라이드 |
|---|---|
| `04_overview.svg` | 도입 — 전 구간 한 장 |
| `01_kafka_streaming.svg` | ① 스트리밍 |
| `02_kafka_to_postgres.svg` | ② 적재 |
| `03_delivery.svg` | ③ 전달 |
| `05_anomaly_label.svg` | 성과 — 이상탐지 라벨이 실제로 무엇인가 |

다시 만들려면 (DB 가 떠 있어야 한다):

```bash
python make_assets.py
```

---

## 전체 숫자 (슬라이드 어디에 써도 되는 확정값)

```
측정 run           18       (팩 CC 8 · 팩 CP 6 · 18650 CC 3 · 중단 1)
표본               176,533
Kafka 전송         176,533 건 / 29.3 초   =  6,025 건/초
PostgreSQL 적재    176,533 건 / 321.5 초  =    549 건/초   · 중복 0
DB 크기            80 MB   (battery_logs 55 MB · ext 17 MB)
이상탐지 라벨      completed 14 · collapsed 3 · aborted 1
```

---

# 슬라이드 ① 측정 데이터를 Kafka 로 실시간 스트리밍

**이미지**: `01_kafka_streaming.svg`

## 말할 것

측정은 이미 끝나 있다. 18 run · 176,533 표본이 run 별 디렉터리에 1초 간격 CSV 로 남아 있고,
**그것을 Kafka 로 흘려보내는 것이 이 단계**다. 하드웨어를 켜지 않고도 파이프라인 전 구간을
돌릴 수 있다는 게 핵심이다.

`--speed` 로 재생 속도를 정한다. **`--speed 1` 이면 원래 측정 속도 그대로 재생**되므로
대시보드 라이브 패널 시연에 쓰고, `--speed 0` 은 대기 없이 최대 속도라 벌크 적재에 쓴다.

## 붙일 코드 — 메시지 변환

```python
def to_record(row, meta):
    """CSV 한 줄 → Kafka 메시지 한 건."""
    ds_cell, ds_amb = f("ds_cell_c"), f("ds_ambient_c")
    if meta["ds_swapped"]:
        ds_cell, ds_amb = ds_amb, ds_cell      # 원본이 반대로 기록된 run 을 되돌린다

    a = sane_temp(f("mlx5a_obj_c"))            # −40~150℃ 밖이면 결측 처리
    b = sane_temp(f("mlx5b_obj_c"))
    hot = [x for x in (a, b) if x is not None]
    temperature = max(hot) if hot else None    # 평균이 아니라 핫스팟

    return {
        # ── v1 5필드 계약 (7월 설계산출물 그대로) ──
        "timestamp": row["timestamp"],
        "voltage": f("voltage_v"),
        "current": f("current_a"),
        "temperature": round(temperature, 3),
        "soc": f("soc_pct"),
        # ── v2 추가 — v1 컨슈머는 모르는 키를 무시하므로 호환된다 ──
        "run_id": meta["run_id"],
        "elapsed_s": f("elapsed_s"),
        "source": "replay",
        "_ext": {"power_w": ..., "ds_cell_c": ds_cell, "mlx5a_obj_c": a, ...},
    }
```

## 붙일 코드 — 발행

```python
producer = KafkaProducer(
    bootstrap_servers=args.broker,
    value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
    acks="all",        # 모든 복제본이 받을 때까지 확인 — 유실 방지
    retries=5,
    linger_ms=50,      # 50ms 모아서 한 번에 — 건별 전송보다 훨씬 빠르다
)

for row in rows:
    rec = to_record(row, meta)
    if args.speed > 0:                          # 배속 재생
        wait = (rec["elapsed_s"] - prev_el) / args.speed
        if 0 < wait < 30:
            time.sleep(wait)
    producer.send("battery-data", key=b"cell_A", value=rec)
```

## 강조할 세 가지 (질문 나오면 답할 것)

**① `temperature` 는 평균이 아니라 `max(5a, 5b)` 다.**
적외선 센서 두 개 중 한쪽은 run 마다 겨냥이 빗나가 **셀이 아니라 실온을 읽는다.**
평균을 내면 그 실온이 발열 신호를 죽인다. 실제로 한 run 에서 `0x5B` 가 셀을 전혀
보지 못했는데 `max()` 덕분에 데이터가 살아남았다.

**② `0x7FFF` 스턱 리드를 여기서 걸러낸다.**
MLX90614 가 `raw = 0x7FFF` 를 뱉으면 **382.19℃** 로 환산되는데, 에러 플래그는 `0x8000` 이라
`raw & 0x8000` 검사를 **한 비트 차이로 빠져나간다.** 실제로 6건 발견됐고 `max()` 규칙이
하필 그 값을 골라 올렸다. −40~150℃ 필터를 프로듀서·컨슈머·DB `CHECK` 세 겹으로 넣었다.

**③ 5필드 계약을 깨지 않았다.**
7월 설계산출물의 `timestamp/voltage/current/temperature/soc` 를 그대로 두고 키만 덧붙였다.
기존 컨슈머는 **한 줄도 고칠 필요가 없다.**

---

# 슬라이드 ② Kafka → PostgreSQL 적재

**이미지**: `02_kafka_to_postgres.svg`

## 말할 것

구독한 메시지를 세 테이블에 나눠 넣는다. **여러 번 돌려도 중복이 쌓이지 않는 것**이
이 단계의 설계 목표였다. 시연 때마다 리플레이를 다시 돌릴 텐데, 그때마다 행이 쌓이면
용량 적분이 배로 부풀려져 분석이 통째로 무너진다.

## 붙일 코드 — 멱등 적재

```sql
INSERT INTO battery_logs
  (run_id, timestamp, elapsed_s, voltage, current, temperature, soc, source)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (run_id, timestamp) DO NOTHING     -- 같은 표본은 두 번 안 들어간다
RETURNING log_id;                              -- 확장 테이블을 이어 붙이려고 받는다
```

```python
cur.execute(LOG_INSERT, (...))
got = cur.fetchone()
if got is None:            # 이미 있는 (run_id, timestamp) — 중복이므로 건너뛴다
    skipped += 1
    continue
cur.execute(EXT_INSERT, (got[0], power_w, ds_cell_c, ...))

pending += 1
if pending >= args.batch:  # 500건 묶어 커밋 — 건별 commit 은 17만 건에 몇 시간 걸린다
    conn.commit()
    pending = 0
```

## 실행 순서 (시연용)

```bash
python replay_producer.py --broker localhost:9092 --speed 0
python consumer_v2.py --broker localhost:9092 --from-beginning --idle 25 --batch 2000
```

## 강조할 세 가지

**① `runs` 테이블을 먼저 채운다.**
`battery_logs.run_id` 가 `runs` 를 외래키로 참조하므로, 부모 행이 없으면 시계열이
**통째로 막힌다.** 그래서 컨슈머는 스트림을 읽기 전에 `runs_manifest.json` 18건을 먼저 upsert 한다.

**② 멱등성은 실제로 검증했다.**
같은 데이터를 두 번째로 흘렸을 때 **신규 0건 · 건너뜀 149건**이 나왔다.
`UNIQUE(run_id, timestamp)` 가 DB 차원에서 막아 준다.

**③ 배치 커밋이 성능의 전부였다.**
건별 commit 은 매번 디스크 동기화를 일으킨다. 500건 묶음으로 바꿔 **549 건/초**가 나왔고,
전체 적재가 321.5초에 끝난다.

---

# 슬라이드 ③ PostgreSQL 정리 → 타 팀 전달

**이미지**: `03_delivery.svg`

## 말할 것

테이블만 넘기면 상대가 값을 틀리게 읽는다. **스키마와 함께 데이터 계약서(`CONTRACT.md`)를
넘기는 것**이 이 단계의 산출물이다. 계약서에 적힌 함정들은 전부 우리가 실제로 한 번씩 당한 것들이다.

## 붙일 코드 — 스키마 핵심

```sql
CREATE TABLE runs (
  run_id       TEXT PRIMARY KEY,
  battery      TEXT NOT NULL,        -- PB-20000 / PB-10000 / PB-5000 / BAT01..03
  mode         TEXT NOT NULL,        -- CC / CP
  setpoint     TEXT NOT NULL,        -- '1A', '10W' …
  duration_h   REAL,                 -- 첫~마지막 표본 간격 (기록 공백 포함)
  loaded_h     REAL,                 -- 실제로 부하가 걸린 시간 (공백 제외)
  energy_wh    REAL,
  result       TEXT NOT NULL         -- completed / collapsed / aborted  ← 이상탐지 라벨
);

CREATE TABLE battery_logs (
  log_id      BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  timestamp   TIMESTAMPTZ NOT NULL,
  elapsed_s   REAL NOT NULL,
  voltage     REAL NOT NULL,
  current     REAL NOT NULL,                    -- 방전 = 음수
  temperature REAL CHECK (temperature BETWEEN -40 AND 150),
  soc         REAL,
  source      TEXT NOT NULL DEFAULT 'replay',   -- replay / live
  CONSTRAINT uq_run_ts UNIQUE (run_id, timestamp)
);
```

## 붙일 코드 — 넘겨줄 질의

```sql
-- 대시보드: run 목록 (선택 드롭다운)
SELECT run_id, battery, mode, setpoint, result, duration_h, energy_wh
FROM runs ORDER BY started_at DESC;

-- 대시보드: 한 run 의 시계열
SELECT elapsed_s, voltage, abs(current) AS current_a, temperature, soc
FROM battery_logs
WHERE run_id = $1                -- run 경계를 반드시 건다
ORDER BY elapsed_s;

-- AI팀: 붕괴 run 만
SELECT * FROM v_collapsed_runs;
```

## 계약서에 적어 넘긴 함정 다섯 가지

| # | 함정 | 안 지키면 |
|---|---|---|
| 1 | `current` 는 방전이 **음수** | 그래프가 뒤집힌다 |
| 2 | `temperature` 는 **`max(5a,5b)`**, 평균 아님 | 빗나간 센서가 발열 신호를 죽인다 |
| 3 | `soc=100` 은 완충이 아니라 **그 run 의 시작점** | run 간 SOC 비교가 무의미해진다 |
| 4 | `duration_h` 말고 **`loaded_h`** | 기록 공백 포함 — `r3b` 는 3.35h vs 실제 1.49h |
| 5 | **`run_id` 없이 조회 금지** | 18 run 이 한 테이블에 섞여 나온다 |

> 4번은 실제 사고 사례가 있다. 기록 공백을 평균으로 메웠더니 한 run 의 에너지가
> **7.18 → 16.14 Wh 로 2.2배** 부풀려져 3종 중 최고 성능처럼 보였다.

---

# 슬라이드 ④ 성과 — 이상탐지 라벨이 실제로 무엇인가

**이미지**: `05_anomaly_label.svg`

## 말할 것

파이프라인이 실어 나른 것이 **무엇에 쓰이는지** 보여주는 슬라이드다.
`runs.result` 가 AI팀의 라벨이고, `collapsed` 3건이 양성이다.

같은 팩(PB-10000)·같은 충전 상태에서 **전력만 10% 다른 두 run** 을 나란히 놓았다.

| run | 전력 | 결과 | 에너지 |
|---|---|---|---|
| `c2` | 10.20 W | **34분 붕괴** | 5.76 Wh |
| `c6` | 9.22 W | 3.07h 완주 | **28.27 Wh** |

**전력을 10% 낮췄더니 에너지가 4.9배 나왔다.**

## 메커니즘 (오른쪽 그림)

```
① 전류가 포트 정격에 닿는다
② 팩이 전류 제한에 들어가며 출력 전압을 낮춘다
③ CP 부하는 P = V·I 를 지키려 전류를 더 요구한다  (I = P/V)
④ 더 깊은 제한 → 전압 더 하락 → ② 로
⑤ 되먹임이 발산해 붕괴
```

**고갈이 아니다.** c2 는 c6 이 낸 28.27 Wh 중 5.76 Wh 만 내고 멈췄다 — **80% 가 팩에 남았다.**
**CC 모드에서는 일어나지 않는다.** 전류가 고정이라 되먹임이 없다. **CP 고유의 실패 모드**이고,
그래서 이상탐지 라벨로 값어치가 있다.

## ⚠️ 발표에서 넘어서면 안 되는 선

질문이 나올 수 있으니 미리 알고 있을 것.

- **"단일 문턱으로 붕괴를 예측할 수 있나?"** → **아직 아니다.** `c7`(완주)이 정격의 110% 까지
  갔고 `c8`(붕괴)은 100% 에서 무너졌다 — 두 부류가 겹친다. **양성 표본이 3개뿐**이라
  문턱을 정할 단계가 아니다. 후보 특징까지가 정직한 선이다.
- **"종료 파형으로 구분되나?"** → **이 DB 로는 안 된다.** 로거가 3.0 V 에서 기록을 멈춰
  **전압이 0 으로 떨어지는 절벽이 데이터에 없다.** DB 의 최저 전압은 2.9988 V 다.
- **"열 관련 정량값은?"** → 적외선 겨냥이 run 마다 달라 **최대 3.4배까지 벌어진다.**
  표면에 무광 검정테이프로 겨냥을 고정하기 전까지 열 수치는 주장하지 않는 게 맞다.
  **전기 데이터는 영향받지 않는다** — 에너지 재현성 7.1%.

---

# 라이브 시연 (하고 싶다면)

대시보드가 아직 없어도 **Kafka 로 실시간으로 흘러 들어가는 것**은 보여줄 수 있다.

```bash
# 터미널 1 — 컨슈머를 먼저 띄운다
python consumer_v2.py --broker localhost:9092 --idle 0

# 터미널 2 — 실제 측정 속도로 재생
python replay_producer.py --broker localhost:9092 --speed 1 --runs PB5000_c3_10W_20260826
```

`PB5000_c3` 는 **2.5분짜리 붕괴 run** 이라 시연 길이로 딱 맞고,
초당 한 줄씩 전압이 떨어지며 전류가 오르는 것이 그대로 보인다.

```bash
# 터미널 3 — 적재되는 것을 실시간으로 확인
docker exec cellguard-postgres psql -U battery_admin -d battery_ctrl_db \
  -c "SELECT count(*), max(elapsed_s) FROM battery_logs WHERE run_id='PB5000_c3_10W_20260826';"
```

---

# 아키텍처 슬라이드에 한 줄 적을 것

기존 아키텍처 슬라이드는 **EC2 + TLS/SASL** 로 그려져 있다. 지금 검증한 것은
**로컬 Docker 스택**이다. 슬라이드를 고칠 필요는 없고, 검증 슬라이드에 이 구분만 한 줄 적으면 된다.

> 아키텍처 슬라이드는 **운영 환경**, 이번 검증은 **개발·검증 환경(로컬 Docker)** 이다.
> `compose.yaml` 은 동일하며 EC2 로 옮길 때 바꾸는 것은 광고 주소 한 줄뿐이다.
