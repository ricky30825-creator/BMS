# CellGuard — 리튬이온 배터리 열폭주 조기감지 시스템

라즈베리파이가 배터리의 전압·전류·온도·SOC를 100ms로 수집해 Kafka로 흘리고,
LSTM-AutoEncoder(현재 진단)와 Informer(미래 예측)가 이상을 탐지해 React 대시보드로
관제한다. 임계치 차단(사후)이 아니라 **정상패턴 학습 기반 이상탐지(사전)**가 핵심이며,
위험 시 라즈베리파이가 릴레이로 물리 차단한다.

> `AGENTS.md`와 `CLAUDE.md`는 **AI 코딩 에이전트용 지침 파일**이다. 사람이 읽어도 되지만
> (내용은 정확하다) 신입 개발자를 위한 안내서는 아니다. 사람은 이 문서에서 시작한다.

---

## ⚠️ 지금 실제로 도는 것 / 안 도는 것

코드·계약·로컬 통합 구성이 함께 들어 있지만, 외부 모델과 실물 에지는
저장소 밖 의존성이다. 실행 경로를 섞지 않도록 아래 상태를 먼저 확인한다.

| | 상태 |
|---|---|
| 백엔드(Express) + 프론트(React) | ✅ 돈다. 단일 포트 `localhost:3005` |
| 데이터 | ⚠️ **인메모리 데모 데이터**(`backend/src/store/memory.ts`). 별도 시드 절차가 없다 — 이게 시드다 |
| PostgreSQL + TimescaleDB | ✅ `backend/src/store/postgres.ts` + `migrations/000..009`; Compose 통합 경로는 `docker-compose.local.yml` |
| Kafka | ✅ KafkaJS raw/anomaly/outbox 경계 + Compose KRaft broker/topic 초기화 구성; 실 broker roundtrip은 별도 인수 |
| 추론 프로세스(LSTM-AE·Informer) | ⚠️ `ai/`에 계약·번들 검증·offset lifecycle 경계만 있다. 실제 artifact·외부 adapter가 없어 실추론은 `EXTERNALLY_BLOCKED` (`docs/ai_inference.md`) |
| 라즈베리파이 에지 | ❌ 실물 미연결. 진단 계측값은 시뮬레이터가 만든다(`dataSource: "SIMULATED"`) |

---

## 시작하기 — 두 갈래

### A. 화면만 띄워 보고 싶다 (DB 불필요)

```bash
cp backend/.env.example backend/.env
# BETTER_AUTH_SECRET을 32자 이상 무작위 문자열로 채운다
```

Windows 호스트 PC면 루트의 **`start-local.bat`을 더블클릭**하면 끝이다(의존성 설치 →
프론트 빌드 → 백엔드 실행까지 한다). 그 외 환경이면 수동으로:

```bash
npm --prefix backend install && npm --prefix frontend install
npm --prefix frontend run build
npm --prefix backend run start:local
```

`http://localhost:3005` → 데모 계정으로 자동 로그인된다. 자세한 내용과 재부팅 후 절차는
[`docs/local_run.md`](docs/local_run.md).

### B. PostgreSQL + Kafka 통합 경로를 붙인다

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.local.yml up -d --build backend
curl.exe -fsS http://localhost:3005/health
```

Compose가 TimescaleDB → Kafka/3개 토픽 → `npm run db:migrate` → PostgreSQL
백엔드 순으로 올린다. 자세한 start/stop/log/restart/recovery와 LAN listener
설정은 [`docs/local_run.md`](docs/local_run.md)를 따른다.

`DATA_MODE=postgres`는 실제 PostgreSQL provider만 사용한다. migration 또는
TimescaleDB extension/hypertable 확인이 실패하면 listen하지 않으며 memory
데이터로 대체하지 않는다.

`005_timescale.sql`은 TimescaleDB가 필수다. plain PostgreSQL, extension 누락,
hypertable 전환 누락은 `TIMESCALEDB_REQUIRED`로 명시적으로 중단된다.

---

## 역할별 시작점

| 역할 | 먼저 읽을 것 | 그다음 |
|---|---|---|
| **DB·인프라** | [`docs/handover/infra-implementations.md`](docs/handover/infra-implementations.md) — 1부 PostgreSQL 스토어, 2부 Kafka | [`backend/README.md`](backend/README.md), 구현 대상 인터페이스 `backend/src/store/contract.ts`(80줄), 스키마 `backend/migrations/` |
| **백엔드** | [`docs/backend_contract.md`](docs/backend_contract.md) — REST·WebSocket 정본 | `backend/src/`, [`docs/product_contract.md`](docs/product_contract.md) |
| **프론트엔드** | `frontend/` — **화면·동작의 최종본이다** | [`docs/product_contract.md`](docs/product_contract.md)(기능·유저플로우), [`design-system/cellguard/MASTER.md`](design-system/cellguard/MASTER.md)(토큰·반응형) |
| **에지 (라즈베리파이)** | [`docs/hardware/mode1_beginner_guide.md`](docs/hardware/mode1_beginner_guide.md) | [`docs/hardware/mode1_backend_spec.md`](docs/hardware/mode1_backend_spec.md), `edge/`, `hardware/` |
| **AI·모델** | [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](docs/hardware/mode2_powerbank_diagnosis_spec.md) §9 — 열폭주 스크리닝 피처·판정 설계 | `CLAUDE.md`의 「이상점수와 등급」절 |
| **기획·요구사항** | [`PLAN.md`](PLAN.md) | [`docs/verification_matrix.md`](docs/verification_matrix.md) |

---

## 저장소 구조

```
backend/     Express + TypeScript. REST·WebSocket·진단 러너·인메모리 스토어
frontend/    React. 화면·동작의 정본
edge/        라즈베리파이 수집 코드
ai/          로컬 AI 추론 계약·bundle 검증·Kafka lifecycle 경계
hardware/    KiCad 회로도 (생성물 — tools/gen_*.py로 만든다, 손으로 고치지 않는다)
docs/        정본 문서. handover/ 아래가 인계 명세
design-system/  디자인 토큰·마스터 문서
tools/       회로도 생성기, 계약서 린터
scripts/     운영 스크립트
```

## 개발 명령

```bash
# 백엔드
cd backend && npm test && npm run typecheck

# 프론트엔드
cd frontend && npm test && npm run typecheck && npm run e2e

# 계약서 린터 (docs/product_contract.md를 고쳤으면 반드시)
python3 tools/contract_lint.py docs/product_contract.md
```

## 문서를 고칠 때

`CLAUDE.md`에 **정본 문서 지도**와 **충돌 해소 순서**가 있다. 요약하면:

> 회로·실물 제약 > `frontend/` 구현 > 계약서 > `PLAN.md` > 기능정의서·유저플로우

구현과 계약서가 어긋나면 **계약서를 현실에 맞춰 고친다** — 반대가 아니다.
동작이 어느 쪽으로도 불명확하면 추정하지 말고 `정의 필요`로 표시한다.

## Git

- 원격: `https://github.com/ricky30825-creator/BMS`
- 발표자료·원본 산출물·백업은 추적하지 않는다(`.gitignore`). 저장소에는 코드·설정·
  Markdown·웹/다이어그램 자산만 둔다.
- **폴더를 통째로 복사해 넘기지 말 것** — 워킹 폴더는 1.6GB지만 추적 파일은 239개뿐이다.
  나머지는 `설계 산출물/`(587MB)과 `node_modules`(367MB)다. `git clone`으로 넘긴다.
