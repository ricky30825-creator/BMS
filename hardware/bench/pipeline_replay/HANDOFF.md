# 인계 — Kafka · PostgreSQL 파이프라인

**2026-09-03 작성.** 이 문서 + `CONTRACT.md` 만 읽으면 새 세션에서 그대로 이어받을 수 있다.
배터리 측정 쪽 맥락은 상위 폴더의 `CLAUDE.md` 에 있고, **이 문서는 DB·Kafka 만 다룬다.**

---

## 한 줄 요약

**이미 측정해 둔 18 run · 176,533 표본을 Kafka → PostgreSQL 로 흘려 넣는 데 성공했다.**
로컬 Docker 스택(Kafka KRaft + PostgreSQL)에서 전 구간이 동작하며, 적재 결과가
`CLAUDE.md` 의 기록값과 소수점 3자리까지 일치한다.

---

## 지금 상태

| | |
|---|---|
| Docker 스택 | ✅ **가동 중** (2026-09-03 재기동, kafka·postgres 둘 다 healthy) |
| 적재 완료 | runs 18 · battery_logs 176,533 · battery_logs_ext 176,533 — **볼륨에서 그대로 살아났다** |
| EC2 Kafka | ❌ **`3.38.147.82` 도달 불가** — ping·TCP 9092 둘 다 실패 (2026-09-03 재확인) |
| 네이티브 PostgreSQL(5432) | ✅ **정상 복귀** — PC 재시작으로 해결됐다. 포트 5432 응답 확인 |

### 되살리기

```bash
cd "C:\Users\<USER>\Desktop\라즈베리파이5테스트\pipeline_replay"
docker compose up -d
docker compose ps          # kafka / postgres 둘 다 healthy 여야 한다
```

볼륨이 남아 있으므로 **데이터가 그대로 있다.** 완전히 새로 시작하려면 `docker compose down -v`.

### 접속 정보

```
Kafka        localhost:9092          토픽 battery-data (+ raw-metrics / anomaly-alerts / events)
PostgreSQL   localhost:5433          db battery_ctrl_db / user battery_admin / pw cellguard_dev
```

> **5433 인 이유**: 네이티브 PostgreSQL 18 이 5432 를 쓰고 있다(현재 고장 상태지만 포트는 점유).
> 충돌을 피하려고 컨테이너를 5433 에 띄웠다.

---

## 파일

| 파일 | 용도 |
|---|---|
| `compose.yaml` | Kafka(KRaft) + PostgreSQL. 토픽 4개 자동 생성, 스키마 자동 적용 |
| `schema_v2.sql` | 테이블 3 + 뷰 2. 컨테이너 최초 기동 시 자동 실행된다 |
| `replay_producer.py` | 18 run 을 Kafka 로 재생 |
| `consumer_v2.py` | Kafka → PostgreSQL 적재 |
| `runs_manifest.json` | run 18개 메타데이터 (프로듀서가 자동 생성) |
| **`CONTRACT.md`** | **대시보드팀·알고리즘팀에 넘길 데이터 계약서** |

### 실행 순서

```bash
python replay_producer.py --dry-run                                  # 미리보기
python replay_producer.py --broker localhost:9092 --speed 0          # 전송 (약 30초)
python consumer_v2.py --broker localhost:9092 --from-beginning --idle 25 --batch 2000
```

`--speed 1` 은 실시간 재생이라 대시보드 라이브 시연에 쓴다.
`UNIQUE(run_id, timestamp)` 라 **여러 번 돌려도 중복이 안 쌓인다.**

의존성: `pip install kafka-python-ng psycopg2-binary`

---

## 데이터

**18 run** = 팩 CC 8 + 팩 CP 6 + 18650 CC 3 + 중단 1.
원본은 상위 폴더의 각 run 디렉터리에 있는 `*_soc.csv` (1초 간격, 18열).

`runs.result` 가 **이상탐지 라벨**이다 — `collapsed` 3건이 CP 되먹임 붕괴(양성),
`completed` 14, `aborted` 1.

---

## ⚠️ 반드시 알아야 할 것 다섯 가지

이걸 모르면 데이터를 틀리게 읽는다. 전부 실제로 한 번씩 당한 것들이다.

### 1. `current` 는 방전이 음수다
절대값이 필요하면 `abs(current)`.

### 2. `temperature` 는 평균이 아니라 `max(5a, 5b)` 다
두 IR 중 한쪽은 run 마다 겨냥이 빗나가 **실온을 읽는다.** 평균을 쓰면 신호가 죽는다.
접촉식(`ds_cell_c`)은 IR 보다 **14~18℃ 낮게** 읽으므로 대표 온도로 쓰면 안 된다.

### 3. `soc = 100` 은 완충이 아니라 **그 run 의 시작점**이다
전류 적산을 그 run 총량으로 정규화한 값이라 run 이 끝나야 계산된다.
**run 을 가로질러 SOC 를 비교하면 안 된다.** `18650_b1` 은 사전에 131 mAh 가 빠져 있어
실제로는 절대 SOC 94.4% 지점이 100 으로 찍혀 있다.

### 4. `duration_h` 가 아니라 `loaded_h` 를 볼 것
`duration_h` 는 첫~마지막 표본 간격이라 **기록 공백이 포함**된다.
`PB5000_r3b` 는 3.351 h 로 찍히지만 실제 방전은 **1.490 h** 다.
그래프에서 `elapsed_s` 간격이 벌어진 구간은 **보간하지 말고 끊어서** 그린다.

### 5. `0x7FFF` 스턱 리드 — 이번에 잡은 버그
MLX90614 가 `raw = 0x7FFF` 를 뱉으면 **382.19℃** 가 나오는데, 에러 플래그는 `0x8000` 이라
`raw & 0x8000` 검사를 **한 비트 차이로 빠져나간다.** `PB20000_c4` 에서 6건 발견됐고
`max(5a,5b)` 규칙이 그걸 골라 올렸다.

**대응 완료** — 프로듀서·컨슈머 양쪽 필터(−40~150℃) + DB `CHECK` 제약 3개.
로거 3개(`mlx_fast_log.py` · `thermal_log_bulk.py` · `tempguard.py`)에도 `mlx_sane()` 을 넣었다.

> `tempguard` 가 제일 중요했다 — 382℃ 하나면 IR 60℃ 문턱을 넘겨 **CH3(마스터)를 연다.**

---

## 남은 일

| # | 할 일 | 비고 |
|---|---|---|
| 1 | **대시보드팀 백엔드·프론트 연동** | `CONTRACT.md` 를 먼저 건넬 것 |
| 2 | **EC2 Kafka 복구** | 콘솔에서 인스턴스 상태·퍼블릭 IP 확인. 중지 후 재시작했다면 IP 가 바뀌었다 |
| 3 | 로거 3개를 파이로 배포 | `방전분석_공용/deploy_pi.ps1 -IP <주소>` — 파이가 켜지면 |
| ~~4~~ | ~~네이티브 PostgreSQL(5432) 복구~~ | ✅ **닫힘 (2026-09-03)** — PC 재시작 후 `postgresql-x64-18` 이 Running, 5432 응답 정상 |
| 5 | 라이브 전환 | `sensors.py` 를 검증된 읽기 코드로 교체. 1초 주기 권장 (0.1초 원본은 CSV 로 별도 보관) |

### EC2 로 옮길 때

**같은 `compose.yaml` 을 EC2 에 그대로 올리면 된다.** 바꿀 것은 한 곳뿐:

```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:19092,PLAINTEXT_HOST://<EC2_퍼블릭IP>:9092
```

그리고 스크립트는 `--broker <EC2_IP>:9092` 로 부르면 된다.

> **PPT 는 안 고쳐도 된다.** 아키텍처 슬라이드(EC2·TLS/SASL)는 운영 환경이고,
> 로컬 Docker 는 개발·검증 환경이다. 검증 슬라이드에 그 구분만 한 줄 적으면 정직하다.

---

## 겪은 함정 (다시 만나면 시간 아낄 것)

| 증상 | 원인 | 해결 |
|---|---|---|
| Kafka 컨테이너가 즉시 종료, `advertised.listeners cannot use 0.0.0.0` | 리스너 이름을 `BROKER`/`EXTERNAL` 로 지었더니 이미지가 기본값을 섞음 | `PLAINTEXT`/`PLAINTEXT_HOST` 표준 이름 + 빈 호스트(`://:9092`) 표기 |
| 프로듀서가 연결됐다 바로 끊김 | 컨테이너 내부/호스트 광고 주소를 하나로 합침 | 리스너 2개로 분리 (`kafka:19092` / `localhost:9092`) |
| `import zipfile` 이 실패 | 스크래치패드의 `struct.py` 가 표준 모듈을 가림 | 임시 스크립트에 표준 모듈 이름을 쓰지 말 것 |
| `psql` 한글 깨짐 | 로그·출력이 cp949 | `$env:PGCLIENTENCODING="UTF8"`, 파이썬은 `PYTHONIOENCODING=utf-8` |
| `--runs` 로 한 run 만 돌렸더니 매니페스트가 그 하나로 줄었다 | 프로듀서가 매니페스트를 **매번 통째로 덮어썼다.** 그 상태로 컨슈머를 돌리면 `runs` 행이 1개뿐이라 나머지 17 run 이 FK 에 걸려 전부 막힌다 | **해결 완료 (2026-09-03)** — `replay_producer.py` 가 기존 매니페스트를 읽어 **run_id 기준으로 병합**한다. 필터를 걸어도 나머지 run 이 보존된다 |

---

## 검증된 것

- 전송 176,533건 / 29.3초 · 적재 176,533건 / 321.5초 · **건너뜀 0**
- DB 값이 `CLAUDE.md` 기록과 일치: r2 30.816 / r3 7.702 / r3b 7.176 / r6 6.324 **완전 일치**,
  c1·c8·c6·c7·r4·r9 는 0.005 이내
- `loaded_h` 가 `CLAUDE.md` 의 실방전 시간과 일치 (r3b 1.490 vs 1.491)
- 온도 최댓값 382.19 → **48.75℃** (= `PB10000_r5` 실측 최고값)로 정상화
