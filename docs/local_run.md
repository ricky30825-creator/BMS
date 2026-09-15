# 로컬 실행 (호스트 PC, Windows 기준)

이 문서는 두 실행 경로를 함께 다룬다.

- **데모 경로**: 기존 `start-local.bat` + `AUTH_MODE=demo DATA_MODE=memory`.
  PostgreSQL이나 Kafka를 만들지 않으며, 화면 회귀 확인용으로 계속 사용할 수
  있다.
- **통합 경로**: `docker-compose.local.yml`의 TimescaleDB, Kafka, migration,
  PostgreSQL 백엔드. 외부 모델 bundle/adapter가 있을 때만 AI profile을
  추가한다.

두 경로의 데이터와 프로세스는 섞지 않는다. 통합 경로에서 PostgreSQL 또는
Kafka가 준비되지 않으면 백엔드는 listen하지 않고, 메모리 데모로 몰래
대체하지 않는다.

## A. 화면 데모 (기존 경로)

최초 1회 `backend\\.env.example`을 `backend\\.env`로 복사하고
`BETTER_AUTH_SECRET`을 32자 이상 무작위 문자열로 채운다. `DATABASE_URL`은
memory 모드에서 접속하지 않지만 비어 있으면 안 된다.

Windows에서는 루트의 `start-local.bat`을 더블클릭한다. 스크립트는 다음을
수행한다.

1. `backend\\.env` 존재를 확인한다.
2. `backend`·`frontend`의 `node_modules`가 없을 때만 `npm install`한다.
3. 프론트엔드를 빌드한다.
4. `backend`의 `npm run start:local`로 단일 오리진 서버를 연다.

브라우저에서 `http://localhost:3005`를 연다. 이 경로는 Kafka·DB에 연결하지
않으며, 프론트엔드 mock/MSW 경로와도 구분된다.

수동 실행이 필요하면 다음을 사용한다.

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix backend run start:local
```

재부팅 후 자동 시작은 설치하지 않는다. 다시 화면을 확인하려면
`start-local.bat`을 사람이 실행한다.

## B. TimescaleDB + Kafka 통합 경로

### 준비

Docker Desktop의 Docker Compose v2와 Git checkout이 필요하다. 루트에서
통합 환경 파일을 만들고, 예시 credential과 LAN 주소를 실제 로컬 값으로
바꾼다.

```powershell
Copy-Item .env.example .env
```

`.env`는 gitignore 대상이다. `POSTGRES_PASSWORD`와
`BETTER_AUTH_SECRET`은 예시 문자열을 그대로 공유하지 않는다.

`docker-compose.local.yml`의 이미지는 다음처럼 버전을 고정한다.

| 구성 | 이미지 | 용도 |
|---|---|---|
| PostgreSQL | `timescale/timescaledb:2.17.2-pg16` | TimescaleDB extension·hypertable |
| Kafka | `apache/kafka:3.9.1` | 단일 노드 KRaft, LAN 한정 PLAINTEXT |
| 백엔드 | `node:22.14.0-bookworm-slim` | `backend/Dockerfile`에서 build/start |
| AI (선택) | `python:3.12.8-slim` | `ai/Dockerfile`, 외부 bundle/adapter 경계 |

이 버전은 이 통합 구성의 의존성이다. 모델 binary, checkpoint, 개인 LAN
주소, 운영 secret은 이미지나 저장소에 넣지 않는다.

### 설정과 listener 구분

Kafka는 한 브로커에 세 개의 advertised listener를 갖는다.

| 클라이언트 | 주소 | Compose 설정 |
|---|---|---|
| Compose 내부 백엔드/AI | `kafka:29092` | `INTERNAL` |
| 호스트 PC 프로세스 | `localhost:9092` | `LOCALHOST` (loopback publish) |
| Raspberry Pi | `<호스트 LAN 이름 또는 IP>:19092` | `LAN` |

`KAFKA_LAN_ADVERTISED_HOST`의 기본값은 문서용
`cellguard-host.example.invalid`이며 실제 주소가 아니다. Raspberry Pi를
연결할 때만 **커밋하지 않는 루트 `.env`**에서 호스트의 LAN DNS 이름 또는
IP로 바꾸고, `edge/.env`의 `EDGE_KAFKA_BROKERS`에도 같은 주소와 `19092`를
넣는다. `LOCALHOST://localhost:9092`는 그대로 두므로 호스트 프로세스와
Raspberry Pi listener를 혼동하지 않는다.

LAN 포트는 방화벽에서 필요한 LAN만 허용한다. PostgreSQL `5432`, Kafka
localhost `9092`, 백엔드 `3005`는 Compose 파일에서 loopback에만 bind한다.

### 시작과 확인

백엔드만 올려도 `depends_on` 순서에 따라 TimescaleDB → Kafka/토픽 →
migration → backend가 실행된다. migration과 topic 초기화가 성공하지 않으면
백엔드는 시작하지 않는다.

```powershell
docker compose -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.local.yml up -d --build backend
docker compose -f docker-compose.local.yml ps
curl.exe -fsS http://localhost:3005/health
```

정상 health 응답은 `status: "ok"`, `data: "postgres"`를 포함한다. 토픽 세
개가 실제로 만들어졌는지는 다음으로 확인한다.

```powershell
docker compose -f docker-compose.local.yml exec -T kafka `
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 --list
```

목록에 다음 세 이름이 모두 있어야 한다.

```text
battery-raw-metrics
battery-anomaly-alerts
battery-events
```

### migration 규칙

통합 경로에서 DB를 준비할 때는 `psql -f`로 개별 SQL을 실행하지 않는다.
`migrate` 서비스가 `npm run db:migrate` 하나만 실행한다.

- `backend/migrations/000_*.sql`부터 파일명의 3자리 번호 순으로 적용한다.
- 번호가 빠지거나 규칙과 다른 SQL 파일이 있으면 시작 전에 중단한다.
- 동시에 두 migration runner가 실행되지 않도록 PostgreSQL advisory lock을
  사용한다.
- 각 파일은 별도 transaction으로 적용하고 `schema_migrations`에 기록한다.
- 시작 전에 TimescaleDB extension 가용성을 확인하고, 완료 후
  `telemetry_metric`·`anomaly_score`가 실제 hypertable인지 확인한다.

따라서 plain PostgreSQL 이미지, extension이 없는 서버, extension은 있지만
hypertable 전환이 끝나지 않은 DB는 모두 명시적인 `TIMESCALEDB_REQUIRED`
오류로 닫힌다. 앞선 migration이 일부 적용됐다는 이유로 평범한 테이블에
계속 적재하거나 백엔드를 memory mode로 바꾸지 않는다.

### 선택적 AI profile

외부 bundle과 adapter가 준비된 경우에만 다음을 실행한다.

```powershell
docker compose -f docker-compose.local.yml --profile ai up -d --build ai
docker compose -f docker-compose.local.yml logs -f --tail=200 ai
```

루트 `.env`의 `AI_MODEL_BUNDLE_HOST_PATH`는 `metadata.json`,
`feature_metadata.json`, `scaler.json`, 두 checkpoint가 있는 외부 bundle
디렉터리로 지정한다. `AI_ADAPTER_HOST_PATH`는 bundle의
`python:module:factory` descriptor로 import 가능한 검토된 adapter package
경로다. adapter의 추가 Python 의존성은 외부에서 준비한 이미지/환경에
설치해야 한다. 이 Compose 구성은 모델 artifact나 adapter를 런타임에
내려받지 않는다. 다만 pinned `requirements.txt`로 AI 이미지를 처음 빌드할
때는 Python package index 접근이 필요하다.

bundle 또는 adapter가 없으면 AI 컨테이너는
`AI_MODEL_BUNDLE_*` 또는 `AI_INFERENCE_ADAPTER_*` 오류로 종료한다. 이는
정상적인 fail-closed 동작이다. fake/mock/stub 점수나 memory 데이터로
대체하지 않으며, profile을 켰다는 사실만으로 실 AI 추론을 주장하지 않는다.

### 로그·중지·재시작

```powershell
# 상태와 각 서비스 로그
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs --tail=200 timescaledb kafka migrate backend

# 실시간 로그 (Ctrl+C는 로그 보기만 종료)
docker compose -f docker-compose.local.yml logs -f backend

# 백엔드만 재시작
docker compose -f docker-compose.local.yml restart backend

# LAN advertised host를 바꾼 뒤 Kafka와 의존 프로세스를 재생성
docker compose -f docker-compose.local.yml up -d --force-recreate kafka kafka-init backend

# 컨테이너 중지 (named volume은 보존)
docker compose -f docker-compose.local.yml stop

# 중지된 컨테이너 다시 시작
docker compose -f docker-compose.local.yml start
```

`docker compose ... down`은 컨테이너와 네트워크를 제거하지만 named volume은
기본적으로 남긴다. DB 데이터를 버릴 의도가 없다면 `down -v`를 실행하지
않는다.

### 장애 복구 순서

1. `docker compose ... ps`에서 `unhealthy` 또는 `exited (1)` 서비스를 찾고
   해당 서비스 로그를 확인한다.
2. `timescaledb`가 unhealthy면 plain PostgreSQL 이미지로 교체하지 말고,
   TimescaleDB 이미지와 extension 가용성 로그를 확인한다.
3. migration 실패는 원인을 고친 뒤 아래 명령으로 같은 deterministic runner를
   재실행한다. 실패한 파일은 transaction rollback되며 성공으로 기록되지
   않는다.

   ```powershell
   docker compose -f docker-compose.local.yml run --rm migrate
   ```

4. 토픽 초기화가 실패하면 Kafka health를 확인하고 `kafka-init`을 다시
   실행한다.

   ```powershell
   docker compose -f docker-compose.local.yml run --rm kafka-init
   ```

5. 백엔드가 `TIMESCALEDB_REQUIRED`로 종료하면 DB에서 extension과 hypertable을
   직접 확인한다(기본 credential을 바꿨다면 명령의 사용자/DB도 바꾼다).

   ```powershell
   docker compose -f docker-compose.local.yml exec -T timescaledb `
     psql -U cellguard -d cellguard -c `
     "select extname, extversion from pg_extension where extname = 'timescaledb';"
   docker compose -f docker-compose.local.yml exec -T timescaledb `
     psql -U cellguard -d cellguard -c `
     "select hypertable_schema, hypertable_name from timescaledb_information.hypertables;"
   ```

6. Kafka 재시작 뒤에는 backend 로그에서 producer/consumer 재연결과 outbox
   retry를 확인한다. DB transaction과 Kafka offset은 원자적이지 않으므로
   replay가 가능하지만, raw/anomaly/outbox/edge 각 구현의 명시된 멱등성
   경계를 벗어나 수동으로 offset을 건너뛰지 않는다.

### Raspberry Pi edge 연결

Edge command consumer는 GPIO를 사용하는 별도 Pi 프로세스라 Compose에 넣지
않는다. Pi에서 `edge/.env.example`을 복사한 뒤 `EDGE_KAFKA_BROKERS`를
호스트 LAN 주소로 바꾸고, `kafka-python==2.0.2`와 실제 `RPi.GPIO`를 준비한
후 `python -m edge.commands.runtime`을 실행한다. `EDGE_IDEMPOTENCY_DB`는
반드시 Pi의 durable 경로로 둔다. GPIO, manual gate, relay 접점, Pi 재부팅은
실물 인수 항목이며 이 문서의 Docker health만으로 통과를 선언하지 않는다.

## 검증 범위와 현재 차단

다음은 구성에 대한 정적 확인 항목이다.

```bash
node --check backend/scripts/migrate.mjs
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix backend test
python3 -m unittest discover -s ai/tests -p 'test_*.py'
python3 -m unittest discover -s edge/commands -p 'test_*.py'
python3 -m py_compile ai/*.py edge/commands/*.py
```

Docker/Podman, `psql`, `kafka-topics` CLI가 없는 환경에서는 Compose를 실제
기동하거나 `localhost:3005` health, migration, 세 토픽 생성, Kafka roundtrip,
Timescale hypertable 적재, AI bundle/adapter 추론, Raspberry Pi GPIO를
검증할 수 없다. 이런 항목은 정적 구성 검증 결과와 섞어 완료로 보고하지
않는다.
