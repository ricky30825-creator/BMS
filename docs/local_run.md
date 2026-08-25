# 로컬 실행 (호스트 PC, Windows)

C8 — `docs/implementation_status.md` 참조. 이 문서는 **오늘 실제로 뜨는 것만** 다룬다.

## 지금 이 절차로 뜨는 것 / 안 뜨는 것

CLAUDE.md의 전체 아키텍처(Kafka, PostgreSQL+TimescaleDB, LSTM-AE+Informer 추론 프로세스)는 아직 이 저장소에 없다.

- **뜨는 것**: 백엔드(`AUTH_MODE=demo DATA_MODE=memory`)가 빌드된 프론트엔드를 같은 포트(`localhost:3005`)에서 서빙. 데이터는 `backend/src/store.ts`에 내장된 데모 배터리·사용자다 — 별도 시드 절차가 없다, 이게 시드다.
- **안 뜨는 것**: Kafka, PostgreSQL(`DATA_MODE=postgres`는 B1이 끝날 때까지 `503`), 추론 프로세스, 라즈베리파이 에지. 이들은 CLAUDE.md 기준 별도 담당자 몫이며 이 문서의 범위가 아니다.

## 사전 준비 (최초 1회)

1. Node.js 설치(LTS 권장).
2. `backend\.env.example`을 `backend\.env`로 복사하고 `BETTER_AUTH_SECRET`을 32자 이상 무작위 문자열로 채운다. `DATABASE_URL`은 `DATA_MODE=memory`에서 실제로 접속하지 않지만 값 자체는 있어야 한다(비워두면 시작 실패) — `.env.example`의 값을 그대로 둬도 된다.
3. `AUTH_MODE`·`DATA_MODE`는 기본값이 각각 `demo`·`memory`라 `.env`에 없어도 되지만, `.env.example`은 명시해둔다.

## 실행

`start-local.bat`을 더블클릭(또는 터미널에서 실행). 이 스크립트가 하는 일:

1. `backend\.env` 존재 확인 — 없으면 안내 메시지를 띄우고 종료.
2. 최초 1회만 `npm install`(backend·frontend 각각, `node_modules`가 없을 때만).
3. `npm run build`로 프론트엔드를 매번 새로 빌드(`frontend/dist`).
4. `npm run start:local`(`tsx src/server.ts`)로 백엔드를 실행 — 백엔드가 `frontend/dist`를 감지해 정적 서빙 + SPA 폴백을 자동으로 켠다(`backend/src/server.ts`, `express.static` + `frontend/dist/index.html`로 SPA 라우트 폴백, `/api/*` 미매칭은 JSON `404`로 응답해 SPA 폴백과 섞이지 않는다).

브라우저에서 `http://localhost:3005`를 열면 데모 계정으로 자동 로그인되어 대시보드까지 진행된다.

## 재부팅 후

**자동 시작은 설치하지 않는다** — Task Scheduler 등록이나 시작프로그램 등록 없이, 사람이 재부팅 후 `start-local.bat`을 다시 실행해야 한다(2026-08-25 결정 — 영구적인 시스템 자동시작 설정을 원하면 별도로 요청).

## 왜 프론트엔드 빌드에 `VITE_DEMO_MODE=true`가 꼭 필요한가

`frontend/.env.production`이 `npm run build` 시 자동으로 이 값을 굽는다. 이게 없으면 데모 로그인이 전혀 동작하지 않는다 — 진짜 Better Auth 인증(C2b)이 아직 구현되지 않았기 때문에, 빌드된 앱이 데모 로그인 경로를 쓸 수 있어야만 로그인 자체가 가능하다. 서버 쪽은 `AUTH_MODE=demo`일 때만 이 경로를 허용하므로(`backend/src/auth/middleware.ts`), 프론트가 이 플래그를 켠다고 실제 프로덕션(`AUTH_MODE=betterauth`) 배포가 뚫리지는 않는다.

## 완료 판정

PC를 재부팅해도 `start-local.bat` 실행 한 번으로 브라우저 `localhost:3005`에서 로그인 → 배터리 연결 → 대시보드까지 동작.

⚠️ 이 `.bat` 스크립트는 macOS 개발 세션에서 작성됐고, 실제 Windows 호스트 PC에서 실행해 확인하지는 못했다. Windows에서 처음 실행할 때 문제가 있으면 알려달라.
