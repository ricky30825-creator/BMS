khttps://pssenlweb.wixsite.com/pssenl/about# 실측 센서 데이터 파이프라인 구축 가이드

**라즈베리파이 + 실제 센서 → Kafka(AWS EC2) → 내 PC → PostgreSQL**

5~7월 설계산출물(`BMS 데이터 학습 공유.pptx`, `6월_설계산출물_단독본.pptx`, `7월_설계산출물_실전v4형식.pptx`)은 하드웨어 도입 전 **가상 데이터**로 파이프라인 전체(수집→Kafka→PostgreSQL)를 검증한 결과물이었다. `mode1_beginner_guide.md`와 `cellguard_mode1.pdf`에 따라 회로 조립(STEP 1~29)이 끝났다는 전제로, 이 문서는 그 가상 데이터 생성 로직을 **실제 센서 읽기 로직으로 교체**하는 방법을 다룬다.

바뀌는 것과 안 바뀌는 것을 먼저 분명히 해 둔다.

| | 6~7월 설계(가상) | 이 문서(실측) |
|---|---|---|
| 데이터 생성 | `random` 기반 시뮬레이션 | INA226·BQ27441·DS18B20·MLX90614 실측 |
| Kafka 토픽/키/파티셔닝 | `battery-data`, `key='cell_A'` | **동일하게 재사용** |
| Consumer → PostgreSQL | `local_consumer.py`, `battery_logs` | **동일 스키마 재사용** (확장 컬럼은 옵션) |
| 전송 안정성(acks/retries/재연결) | 이미 구현됨 | **동일하게 재사용** |

즉 바뀌는 건 **1단계(수집)의 내부 로직뿐**이고, 2·3단계는 7월 설계산출물 v4를 거의 그대로 쓴다. 이렇게 만든 이유가 바로 7월 설계산출물의 "실 연동 무수정" 원칙(실측·가상 동일 스키마)이다.

전체 파이프라인:

```
[라즈베리파이 5]                [AWS EC2]              [내 PC]
 실제 센서 5종                   Kafka Broker            local consumer.py
 (INA226·BQ27441·                :9092                   → PostgreSQL
  DS18B20 x3·MLX90614 x2)        topic: battery-data      (bms_db.battery_logs)
        │  producer.py                │                        │
        │  JSON 직렬화 ────────────▶  │  ── 구독(subscribe) ──▶│  INSERT + commit
        │  key='cell_A'                                        │  임계치 체크
```

---

## 0. 사전 준비물

| 항목 | 확인 |
|---|---|
| 회로 조립 | `mode1_beginner_guide.md` STEP 29까지 통과 (하드웨어 완성, §7-1 표를 다 채웠음) |
| 라즈베리파이 | `sudo i2cdetect -y 1`에 `40 48 55 5a 5b` 5개가 보임 (STEP 27), `/sys/bus/w1/devices/`에 `28-`x3 (STEP 20) |
| AWS EC2 | Kafka가 이미 설치되어 있음 (5월 진행분). 없다면 Kafka 공식 배포본을 EC2에 다운로드해 압축 해제까지 끝내 둔다 |
| 내 PC | Python 3.9+, PostgreSQL 설치 가능한 관리자 권한 |
| 네트워크 | EC2 보안그룹 인바운드에 **9092/tcp**가 내 PC와 라즈베리파이의 IP에서 열려 있어야 함 |

이 문서가 만든 코드 3벌:

```
bms_realdata_pipeline/
├── pi_producer/
│   ├── sensors.py              # 센서 5종 실측 읽기
│   ├── producer.py             # Kafka producer (라즈베리파이에서 실행)
│   ├── requirements.txt
│   └── battery-producer.service # 상시 실행용 systemd 유닛(선택)
├── pc_consumer/
│   ├── consumer.py             # Kafka consumer + PostgreSQL 적재 (내 PC에서 실행)
│   ├── schema.sql              # battery_logs (+ 옵션 확장 테이블)
│   └── requirements.txt
└── README.md                   # 이 문서
```

---

## 1단계 — 라즈베리파이 + 센서로 실측 데이터 수집

### 1-1. 무엇을 얼마나 읽는가

7월 설계산출물 슬라이드 8의 "가상 데이터 ↔ 실제 센서 매핑"을 그대로 구현한다.

| 스키마 필드 | 실제 센서 | 위치(회로도 기호) | I2C/버스 주소 |
|---|---|---|---|
| `voltage`, `current` | INA226 | U1 | `0x40` |
| `soc` | BQ27441 (Babysitter) | U2 | `0x55` |
| `temperature` | DS18B20 ×3(접촉) + MLX90614 ×2(비접촉) 중 **최댓값** | U5·U7·U8, U3·U9 | 1-Wire(GPIO4), `0x5A`/`0x5B` |
| (옵션) `pressure` | FSR406 + ADS1115 | RV1, U4 | `0x48` |

`temperature`를 5개 센서 중 최댓값으로 잡는 이유는 원본 설계 문서(`mode1_beginner_guide.md` 부록 A)에 있는 논리를 그대로 따른 것이다. 열폭주는 셀 전체가 고르게 아니라 한 지점에서 시작하므로, 여러 지점 중 가장 높은 값을 대표값으로 써야 이상 신호를 놓치지 않는다.

### 1-2. 라즈베리파이 준비

```bash
sudo raspi-config     # Interface Options → I2C, SPI, (1-Wire는 config.txt로 별도 설정) 모두 활성화
```

`/boot/firmware/config.txt` 맨 아래(베이스 가이드 STEP 16과 동일):

```
dtoverlay=w1-gpio,gpiopin=4
gpio=5,6,13,19=op,dh
```

재부팅 후 `pinctrl get 5,6,13,19`로 네 핀이 `op dh`인지 확인한다(릴레이 안전장치, 데이터 수집 자체와는 별개지만 셀이 물려 있는 상태이므로 반드시 확인).

### 1-3. 라이브러리 설치

```bash
cd pi_producer
python3 -m venv venv && source venv/bin/activate   # 가상환경은 선택
pip install -r requirements.txt
```

`requirements.txt`:
```
smbus2>=0.4.3
kafka-python>=2.0.2
```

### 1-4. `sensors.py` — 센서별 실측 함수

핵심만 짚으면 다음과 같다(전체 코드는 `pi_producer/sensors.py`).

**INA226(전압·전류)** — I2C 레지스터 직접 계산이 필요하다. 션트 저항값(베이스 가이드 §2-③에서 실크스크린으로 읽은 값)과 예상 최대 전류로 캘리브레이션 레지스터(`CAL`)를 계산해 한 번 써 준 뒤, Bus Voltage 레지스터(`0x02`, LSB=1.25mV)와 Current 레지스터(`0x04`, LSB=계산값)를 읽는다.

```python
SHUNT_OHMS = 0.01                 # ⚠️ 실물 션트 각인값으로 교체 (R010=0.01, R002=0.002, R100=0.1)
MAX_EXPECTED_CURRENT_A = 3.2
CURRENT_LSB = MAX_EXPECTED_CURRENT_A / 32768.0
INA226_CAL = int(0.00512 / (CURRENT_LSB * SHUNT_OHMS))

def read_ina226(bus):
    bus.write_word_data(0x40, 0x05, _swap16(INA226_CAL))   # 최초 1회 캘리브레이션
    voltage = _swap16(bus.read_word_data(0x40, 0x02)) * 0.00125
    raw_i = _to_signed16(_swap16(bus.read_word_data(0x40, 0x04)))
    current = raw_i * CURRENT_LSB
    return voltage, current
```

INA226은 레지스터가 빅엔디안이라 `smbus2`의 기본 word 읽기 결과를 바이트 스왑(`_swap16`)해야 한다 — 베이스 가이드가 ADS1115·MLX90614 EEPROM을 다룰 때 쓴 것과 같은 패턴이다.

**BQ27441(SOC)** — `StateOfCharge` 레지스터(`0x1C`)를 그대로 읽으면 퍼센트 값이 나온다.

```python
def read_bq27441_soc(bus):
    return bus.read_word_data(0x55, 0x1C)
```

⚠️ 셀이 안 물렸거나 릴레이 CH3이 열려 있으면(Kill-Switch 상태) `0x55` 자체가 버스에서 사라진다. 이건 센서 고장이 아니라 베이스 가이드 부록 A "차단됨" 절에 설명된 정상 동작이므로, 코드에서 예외를 잡아 `None`으로 넘기고 경고만 남긴다.

**DS18B20 ×3(접촉온도)** — 1-Wire 디바이스 파일을 직접 읽는다. `w1_slave` 첫 줄이 `YES`로 끝나야 유효, `85000`(=85.0℃)이 나오면 풀업 저항(R2) 또는 전원 문제다(베이스 가이드 STEP 20).

```python
import glob

def read_ds18b20_all():
    result = {}
    for path in glob.glob("/sys/bus/w1/devices/28-*/w1_slave"):
        with open(path) as f:
            lines = f.readlines()
        if not lines[0].strip().endswith("YES"):
            continue
        t = int(lines[1].split("t=")[-1]) / 1000.0
        if t != 85.0:
            result[path.split("/")[-2]] = t
    return result
```

베이스 가이드 STEP 28에서 만든 "고유번호(`28-...`) ↔ 위치(하단/중앙/단자쪽)" 대응표를 `sensors.py`의 `DS18B20_LOCATION_MAP` 딕셔너리에 그대로 옮겨 적으면, 이후 로그와 확장 테이블에서 위치 이름으로 조회할 수 있다.

**MLX90614 ×2(비접촉온도)** — `TOBJ1` 레지스터(`0x07`)를 읽고 공식대로 변환한다. 상위 비트가 에러 플래그다.

```python
def _read_mlx90614(bus, addr):
    raw = bus.read_word_data(addr, 0x07)
    if raw & 0x8000:
        raise IOError("error flag")
    return (raw & 0x7FFF) * 0.02 - 273.15
```

STEP 18에서 두 센서 주소를 `0x5A`(중앙)/`0x5B`(단자쪽)로 분리해 두었으므로 코드에서 둘 다 순서대로 읽으면 된다. STEP 19의 필터 재설정(`IIR=100, FIR=111`)이 안 되어 있으면 값 자체는 나오지만 열폭주 초기 스파이크가 절반으로 깎여 들어오니, 아직 안 했다면 베이스 가이드 STEP 19를 먼저 마친다.

**FSR406 압력(옵션)** — ADS1115 A0 채널을 단발 변환으로 읽는다. 절대 압력이 아니라 STEP 29에서 잰 baseline 대비 상대 상승률로 해석해야 하는 값이라, 기본 5필드 스키마에는 넣지 않고 확장 필드로만 함께 보낸다.

### 1-5. 센서 통합 확인

배선/주소가 맞는지 Kafka 없이 먼저 확인한다.

```bash
python3 sensors.py
```

1초 간격으로 5회, `{"voltage": ..., "current": ..., "soc": ..., "temperature": ..., ...}` 형태가 콘솔에 찍히면 통과다. `None`이 보이는 필드가 있으면 §1-4의 해당 센서 절과 베이스 가이드의 "복귀 지점 표"(§7-3)를 따라간다.

---

## 2단계 — Kafka 브로커 켜고 실측 데이터 전송

### 2-1. EC2에서 Kafka 브로커 켜기

`BMS 데이터 학습 공유.pptx`에서 이미 정리한 절차를 그대로 쓴다(브로커가 이미 떠 있다면 2-1은 건너뛰고 2-2부터).

```bash
# EC2 SSH 접속 후, Kafka 설치 폴더에서
cd kafka_2.13-<version>

# 1) advertised.listeners 설정 — 외부(라즈베리파이·내 PC)에서 접속하려면 필수
nano config/server.properties
#   #advertised.listeners=PLAINTEXT://your.host.name:9092 를 찾아
#   advertised.listeners=PLAINTEXT://<EC2_퍼블릭IP>:9092  로 주석 해제 + IP 채움
#   Ctrl+O(저장) → Ctrl+X(종료)

# 2) 브로커를 백그라운드(데몬)로 실행 — SSH 세션을 닫아도 계속 살아있게
bin/kafka-server-start.sh -daemon config/server.properties
```

포어그라운드(`-daemon` 없이) 실행은 SSH 창을 닫거나 노트북이 잠들면 EC2 안의 Kafka도 같이 죽는다. 실전에서는 반드시 `-daemon`을 쓴다(단, EC2가 계속 떠 있으므로 과금이 계속 발생한다는 점을 인지한다).

### 2-2. 토픽 확인/생성

토픽이 이미 있으면(6월에 만든 `battery-data`) 그대로 쓴다. 없다면:

```bash
bin/kafka-topics.sh --create \
  --topic battery-data \
  --bootstrap-server <EC2_퍼블릭IP>:9092 \
  --partitions 1 \
  --replication-factor 1
```

상태 확인:

```bash
bin/kafka-topics.sh --describe \
  --topic battery-data \
  --bootstrap-server <EC2_퍼블릭IP>:9092
```

`Partition: 0`, `Leader: 1`, `Replicas: 1`, `Isr: 1`이 보이면 정상이다. 리텐션(보관 기간)을 바꾸고 싶으면:

```bash
bin/kafka-configs.sh --bootstrap-server <EC2_퍼블릭IP>:9092 \
  --entity-type topics --entity-name battery-data \
  --alter --add-config retention.ms=3600000   # 1시간
```

### 2-3. 라즈베리파이에서 producer 실행

`pi_producer/producer.py`의 핵심 로직(전체는 파일 참고):

```python
BOOTSTRAP_SERVERS = "<EC2_퍼블릭IP>:9092"
TOPIC = "battery-data"

producer = KafkaProducer(
    bootstrap_servers=BOOTSTRAP_SERVERS,
    acks="all",      # 브로커 저장 확인까지 기다림 — 무손실 전송
    retries=5,
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

with SMBus(1) as bus:
    while True:
        record = build_record(bus)     # sensors.read_all_sensors() 결과를 5필드로 조립
        producer.send("battery-data", key=b"cell_A", value=record)
        time.sleep(5)
```

`build_record()`는 센서 하나가 일시적으로 실패(`None`)해도 파이프라인이 멈추지 않도록, 직전에 성공했던 값으로 대체하는 옵션(`REUSE_LAST_GOOD_VALUE`)을 갖고 있다. 필요 없으면 꺼서 `None`을 그대로 보내고 DB/Consumer 쪽에서 결측으로 처리해도 된다.

실행:

```bash
cd pi_producer
python3 sensors.py        # 먼저 센서값 자체를 확인 (1-5)
# EC2 IP, SHUNT_OHMS, DS18B20_LOCATION_MAP을 다 채웠다면
python3 producer.py
```

`전송 완료 partition=0 offset=... V=... I=... T=... SOC=...` 로그가 5초 간격으로 찍히면 정상이다.

**상시 실행이 필요하면(SSH 세션을 닫아도 계속 돌게)** `battery-producer.service`를 systemd에 등록한다.

```bash
sudo cp battery-producer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now battery-producer
journalctl -u battery-producer -f     # 로그 확인
```

### 2-4. (선택) 콘솔로 중간 확인

producer/consumer 코드를 만들기 전에 눈으로 먼저 확인하고 싶다면 Kafka 콘솔 도구를 쓴다(`BMS 데이터 학습 공유.pptx` 슬라이드 9~10과 동일).

```bash
# 컨슈머만 먼저 띄워 두고
bin/kafka-console-consumer.sh --topic battery-data \
  --bootstrap-server <EC2_퍼블릭IP>:9092 \
  --property print.key=true --property key.separator=:

# producer.py를 실행하면 이 창에 cell_A:{...json...} 형태로 실시간으로 찍힌다
```

---

## 3단계 — Kafka → 내 PC → PostgreSQL

### 3-1. 내 PC에 PostgreSQL 설치

OS별 설치(하나만 해당하는 것을 따라간다):

```bash
# Windows: https://www.postgresql.org/download/windows/ 에서 설치 프로그램 실행
#          (설치 중 지정한 관리자 비밀번호를 기억해 둔다)

# macOS
brew install postgresql@15
brew services start postgresql@15

# Ubuntu/Debian
sudo apt update && sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

DB와 계정 생성:

```sql
-- psql 접속 후
CREATE DATABASE bms_db;
CREATE USER bms_user WITH PASSWORD '원하는비밀번호';
GRANT ALL PRIVILEGES ON DATABASE bms_db TO bms_user;
```

테이블 생성 — `pc_consumer/schema.sql`을 그대로 적용:

```bash
psql -U bms_user -d bms_db -f pc_consumer/schema.sql
```

`schema.sql`은 7월 설계산출물 v4의 스키마를 그대로 쓴다.

```sql
CREATE TABLE IF NOT EXISTS battery_logs (
  log_id      BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMP NOT NULL,
  voltage     REAL NOT NULL,
  current     REAL NOT NULL,
  temperature REAL,
  soc         REAL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ts ON battery_logs (timestamp DESC);
```

알고리즘팀·대시보드팀이 이 5필드 스키마를 계약(contract)으로 보고 있으므로 컬럼을 함부로 바꾸지 않는다. 접촉/비접촉 온도 5점, 압력값을 버리지 않고 같이 남기고 싶다면 `schema.sql`에 옵션으로 넣어 둔 `battery_logs_ext` 테이블(로그 1건당 1행, `log_id`로 연결)을 추가로 만든다.

### 3-2. 라이브러리 설치

```bash
cd pc_consumer
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

```
kafka-python>=2.0.2
psycopg2-binary>=2.9.9
```

### 3-3. `consumer.py` — 구독 + 적재

핵심 로직(전체는 파일 참고):

```python
consumer = KafkaConsumer(
    "battery-data",
    bootstrap_servers=["<EC2_퍼블릭IP>:9092"],
    value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    auto_offset_reset="latest",
    group_id="battery-loader",
)

for msg in consumer:
    rec = msg.value
    try:
        cur.execute(INSERT_SQL, rec)   # 파라미터 바인딩 — SQL 인젝션 방지
        conn.commit()                  # 건별 커밋 — 장애 시에도 무손실
        for a in check_thresholds(rec):
            log.warning(a)
    except psycopg2.OperationalError:
        conn = connect_db(); cur = conn.cursor()   # 지수 백오프 재연결
```

7월 설계산출물 대비 추가한 부분은 두 가지다.

첫째, `check_thresholds()`를 실제로 구현했다. 7월 슬라이드 4의 안전 임계치 표(온도 주의 45℃/위험 60℃, 전압 3.0V 미만 또는 4.25V 초과, SOC 15% 이하)를 그대로 함수로 옮긴 것이라, 여기서 나오는 경고 로그가 대시보드팀의 신호등·Kill-Switch, AI팀의 이상탐지 입력으로 그대로 연결된다.

둘째, DB 재연결을 지수 백오프(1초→2초→4초→...→최대 30초)로 바꿔 짧은 순단과 긴 장애 모두에 대응하게 했다.

실행 전 환경변수(또는 `consumer.py` 상단 기본값)를 채운다.

```bash
export KAFKA_BOOTSTRAP="<EC2_퍼블릭IP>:9092"
export PG_HOST=localhost PG_DB=bms_db PG_USER=bms_user PG_PASSWORD="원하는비밀번호"
python3 consumer.py
```

`적재 완료 log_id=... key=cell_A value={...}` 로그가 5초 간격으로 찍히면 파이프라인 전체(수집→Kafka→PostgreSQL)가 실측 데이터로 연결된 것이다.

### 3-4. 적재 확인

```sql
SELECT * FROM battery_logs ORDER BY log_id DESC LIMIT 20;
```

`voltage`·`current`·`soc`가 더 이상 랜덤이 아니라 실제 셀 상태(충전/방전에 따라 변하는 값)와 일치하는지 확인한다. Grafana를 붙여 실시간 모니터링을 계속 쓰고 싶다면 데이터소스만 `bms_db`로 바꾸면 되고 7월 설계산출물의 패널 구성(전압·전류·온도·SOC 4패널)을 그대로 재사용할 수 있다.

---

## 4. 전체 실행 순서 요약

1. 라즈베리파이: `sensors.py` 단독 실행 → 5개 필드 값이 정상 범위로 나오는지 확인
2. EC2: Kafka 브로커가 떠 있는지 확인 (`bin/kafka-topics.sh --describe ...`), 안 떠 있으면 §2-1
3. 라즈베리파이: `producer.py` 실행 (또는 systemd 등록)
4. 내 PC: PostgreSQL에 `schema.sql` 적용
5. 내 PC: `consumer.py` 실행
6. `SELECT * FROM battery_logs ORDER BY log_id DESC LIMIT 5;`로 실측값이 계속 쌓이는지 확인

## 5. 트러블슈팅

| 증상 | 원인/확인할 곳 |
|---|---|
| `sensors.py`에서 `voltage`/`current`가 계속 `None` | `i2cdetect -y 1`에 `40`이 없음 → 베이스 가이드 STEP 2, SDA/SCL 확인 |
| `soc`가 계속 `None` | `i2cdetect`에 `55`가 없음 → 셀 미장착이거나 릴레이 CH3 열림(정상일 수 있음), 베이스 가이드 부록 A "차단됨" |
| `temperature`가 `None` 또는 비정상적으로 낮음 | DS18B20: `/sys/bus/w1/devices/`가 비어 있으면 풀업(R2) 누락 → STEP 7. MLX90614: `i2cdetect`에 `5a`/`5b` 확인 → STEP 4·18 |
| producer가 `전송 실패` 반복 | EC2 보안그룹에 9092 인바운드 확인, `advertised.listeners`가 실제 접근 가능한 IP인지 확인 |
| consumer가 뜨는데 DB에 안 쌓임 | `PG_PASSWORD` 등 접속정보 확인, `schema.sql`을 실제로 적용했는지(`\dt`로 테이블 존재 확인) |
| consumer 재시작할 때마다 예전 데이터가 다시 들어옴 | `group_id`를 그대로 뒀는지 확인 — Kafka가 컨슈머 그룹별 offset을 기억하므로 재시작해도 중복 없이 이어서 읽는 것이 정상 동작. 완전히 처음부터 다시 읽고 싶다면 `auto_offset_reset="earliest"`로 바꾸고 새 `group_id`를 쓴다 |
| `85.0`℃로 고정된 DS18B20 값 | 4.7kΩ 풀업(R2) 미장착 또는 전원 부족 — STEP 7, STEP 20 |

## 6. 다음 단계 제안

- **다중 셀 확장**: 6월 설계산출물의 "향후 계획"대로 셀이 늘어나면 `key=b"cell_B"`처럼 셀별 키를 나누고 파티션을 그만큼 늘린다. 파티션을 늘린 뒤에도 기존 키의 일관성을 지키려면 커스텀 파티셔너가 필요하다(`BMS 데이터 학습 공유.pptx` 슬라이드 11 참고).
- **Consumer 이중화**: 지금은 단일 consumer다. `group_id`를 공유하는 consumer를 하나 더 띄우면 Kafka가 자동으로 파티션을 나눠 부하분산·장애 대비가 된다(파티션 수만큼만 병렬화된다는 점은 유의).
- **확장 스키마 활용**: `battery_logs_ext`를 켜면(`consumer.py`의 `ENABLE_EXT_TABLE = True`) 접촉/비접촉 온도 5점과 압력값이 모두 남으므로, 나중에 "어느 지점이 먼저 뜨거워졌는가" 같은 분석이 가능해진다.
