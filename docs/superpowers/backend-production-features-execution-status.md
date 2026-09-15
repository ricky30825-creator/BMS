# Backend Production Features Execution Status

이 문서는 구현 사양이 아니라 컨텍스트 복구와 작업 진행 관리용 정본이다. 상태 판단은 이 문서의 서술이 아니라 실제 Git 상태, 코드, 테스트, 메인 부모 검토 결과를 기준으로 한다.

허용 상태: `PENDING`, `IN_PROGRESS`, `REVIEW_REQUIRED`, `COMPLETE`, `EXTERNALLY_BLOCKED`

## 기준선 감사

- 확인 시각: 2026-09-15 (Asia/Seoul)
- 로컬 브랜치/HEAD: `main` / `c51c988f5648a3a2fa20605e0cafe18f4777c667`
- 로컬 `origin/main`: `c51c988f5648a3a2fa20605e0cafe18f4777c667`
- 실제 원격 `refs/heads/main`: `c51c988f5648a3a2fa20605e0cafe18f4777c667` (`git ls-remote` 확인)
- 작업 트리: clean
- migration 기준: `000`~`009`
- 구현 불일치: `GET /api/trends/export.pdf`는 503 스텁, 공지는 `demoNotices`, 관리자 이벤트 추세는 한국어 요일과 고정 0 배열, PostgreSQL Raw Consumer의 Fail-Safe는 `UNSET_THRESHOLDS`를 직접 사용한다.
- 재사용 기반: PostgreSQL `CellGuardStore`, anomaly score 적재, relay interlock/audit/outbox transaction, Kafka outbox worker, `relay.autoCut` WebSocket 경로가 존재한다.
- 범위: 영속 이벤트 기반, 공지 CRUD/조회수/감사/대시보드 연결, 이벤트 추세 집계/UI, 기존 추세 집계 재사용 PDF, 하드웨어 프로필별 Fail-Safe 설정과 synthetic 통합, 계약·상태 문서 동기화.
- 제외/외부 인수: 임의 production 임계값, 실물 센서·Kafka→Pi→relay 인수, 실제 카카오/웹푸시 전송. 근거·장비·provider 자격증명이 없으면 해당 하위 항목만 `EXTERNALLY_BLOCKED`로 둔다.

## Task 0 — 기준선 감사와 기록 파일 생성

- 현재 상태: `COMPLETE`
- 담당 에이전트: 메인 `/root`
- 기준 커밋: `c51c988f5648a3a2fa20605e0cafe18f4777c667`
- 결과 커밋: `34da606`
- 변경 파일: `docs/superpowers/backend-production-features-execution-status.md`
- 구현 결과: AGENTS.md, 관련 정본, 실제 Git/추적 파일, 대상 코드의 기준선 감사 결과 기록
- 부모 검토 결과: 통과 — 정본 관련 절과 현재 route/store/consumer/migration/frontend 연결을 직접 대조하고 범위·제외 항목을 확정함
- 서브에이전트 테스트: 해당 없음
- 부모 독립 테스트: 원격 main/HEAD/status/추적 파일 및 대상 코드 정적 확인
- 실환경 검증 여부: 원격 Git refs 확인 완료; 애플리케이션 실환경 미실행
- 남은 문제 또는 외부 차단 조건: 없음

## Task 1 — 공통 데이터 모델과 계약 확정

- 현재 상태: `COMPLETE`
- 담당 에이전트: `/root/task1_contract_fix` (최초 구현 `/root/task1_contract_retry`; 이전 `/root/task1_contract`는 사용량 제한으로 변경 없이 종료)
- 기준 커밋: `34da606`
- 결과 커밋: `f47a154`, 수정 `a59aafd`
- 변경 파일: `PLAN.md`, `docs/backend_contract.md`, `docs/product_contract.md`, `docs/implementation_status.md`, `docs/verification_matrix.md`, `docs/hardware/mode1_backend_spec.md`, `docs/hardware/mode2_powerbank_diagnosis_spec.md`
- 구현 결과: 영속 이벤트 원천·severity·dedupe, 공지 상태/audience/조회 dedupe/발송 의도, 공통 추세/PDF 집계, 프로필별 Fail-Safe 센서·실측 게이트, migration `010`~`012`와 store 확장 범위를 문서에 확정; 압력 0 sentinel과 공지 감사 범위 결함 수정
- 부모 검토 결과: 통과 — 전체 계약 diff와 수정 2건을 코드 현실·사용자 요구·하드웨어 정본에 대조함
- 서브에이전트 테스트: 양 커밋 모두 `git diff --check` 통과, 제품 계약 lint 위반 0건, contract lint 단위 테스트 20건 통과, 상대 링크 대상 확인 통과
- 부모 독립 테스트: 전체 `git diff --check` 통과, 제품 계약 lint 위반 0건, contract lint 단위 테스트 20건 통과, 상대 링크 누락 0건
- 실환경 검증 여부: 문서/정적 계약 검증 완료; 실환경 대상 아님
- 남은 문제 또는 외부 차단 조건: 없음; 첫 에이전트는 사용량 제한으로 변경 없이 종료됐으나 새 구현·수정 에이전트 결과를 부모가 검증함

## Task 2 — 영속 이벤트·알림 기반

- 현재 상태: `COMPLETE`
- 담당 에이전트: `/root/task2_events_fix` (최초 구현 `/root/task2_events`)
- 기준 커밋: `047bbe7`
- 결과 커밋: `a0aacb1`, 수정 `747eea9`
- 변경 파일: `backend/migrations/010_domain_events.sql`, `backend/src/store/{types,contract,memory,postgres}.ts`, `backend/src/store.ts`, `backend/src/anomalyConsumer.ts` 및 관련 테스트
- 구현 결과: domain event 저장/조회/ack/UTC bucket 객체 집계, anomaly 전이 transaction/dedupe, Fail-Safe relay/audit/domain-event/outbox 원자성 기반 구현
- 부모 검토 결과: 통과 — migration/SQL transaction, anomaly replay, Fail-Safe 원자성, 공통 bucket 객체 계약과 경계 테스트를 직접 검토함
- 서브에이전트 테스트: backend typecheck 통과, 수정 후 Vitest 312 passed/1 skipped, `git diff --check` 통과
- 부모 독립 테스트: backend typecheck 통과, 전체 Vitest 312 passed/1 skipped, 전체 `git diff --check` 통과
- 실환경 검증 여부: memory/unit 검증 완료; `TEST_DATABASE_URL` 미설정으로 실 PostgreSQL 계약 테스트 skip
- 남은 문제 또는 외부 차단 조건: 실 PostgreSQL 재시작·동시성 인수는 Task 8 환경 확인 대상

## Task 3 — 공지사항 실제 구현

- 현재 상태: `COMPLETE`
- 담당 에이전트: `/root/task3_notices_fix` (최초 구현 `/root/task3_notices`)
- 기준 커밋: `200856f`
- 결과 커밋: `e765546`, 수정 `64a8ec7`
- 변경 파일: `backend/migrations/011_notices.sql`, backend store/server/tests/docs, frontend hooks/types/admin pages/MSW/E2E
- 구현 결과: 공지 상태/audience CRUD, 24시간 조회 dedupe, 변경 감사, delivery intent 차단 상태, 사용자·관리자 dashboard/API/UI 연결; ARCHIVED 직접 생성과 no-op PATCH 입력 결함 수정
- 부모 검토 결과: 통과 — migration, memory/PostgreSQL transaction, API RBAC/validation, dashboard 재사용, 관리자 UI와 MSW 경계를 직접 검토함
- 서브에이전트 테스트: 수정 후 backend 323 passed/1 skipped, frontend typecheck 및 77 passed, `git diff --check` 통과; 최초 구현에서 양쪽 build와 Chromium Playwright 27 passed
- 부모 독립 테스트: backend typecheck/build 및 Vitest 323 passed/1 skipped, frontend typecheck/build 및 Vitest 77 passed, Playwright 31 passed, 전체 `git diff --check` 통과
- 실환경 검증 여부: memory/API 단위와 MSW 브라우저 검증 완료; 실 PostgreSQL 미검증
- 남은 문제 또는 외부 차단 조건: 외부 발송 하위 항목 `EXTERNALLY_BLOCKED` — Kakao/WebPush provider·자격증명 부재; 실제 PostgreSQL 동시성은 Task 8 환경 확인 대상

## Task 4 — 관리자 이벤트 추세

- 현재 상태: `COMPLETE`
- 담당 에이전트: `/root/task4_event_trend`
- 기준 커밋: `5f9b488`
- 결과 커밋: `5b659f8`
- 변경 파일: backend event trend route/helper/tests, frontend admin page/hooks/types/MSW/tests/E2E/styles, `docs/backend_contract.md`
- 구현 결과: 영속 store 기반 event-trend API, period 검증, 관리자 요약/기간/ISO locale chart, 고정 응답 제거
- 부모 검토 결과: 통과 — store 집계 계약, period 파서, ADMIN RBAC 배선, UTC ISO bucket 응답, 관리자 화면의 클라이언트 표시 변환과 고정 배열 제거를 직접 검토함
- 서브에이전트 테스트: backend typecheck 및 326 passed/1 skipped, frontend typecheck/build 및 79 passed, event-trend Playwright 통과, `git diff --check` 통과
- 부모 독립 테스트: backend typecheck/Vitest 326 passed/1 skipped/build, frontend typecheck/Vitest 79 passed/build, 전체 Playwright 32 passed, `git diff --check` 통과
- 실환경 검증 여부: 브라우저 E2E 완료; `TEST_DATABASE_URL` 부재로 실제 PostgreSQL roundtrip은 Task 8에서 환경 가용 시 재검증
- 남은 문제 또는 외부 차단 조건: 없음 (실제 PostgreSQL 환경 검증은 Task 8 통합 검토 항목)

## Task 5 — 추세 PDF

- 현재 상태: `IN_PROGRESS`
- 담당 에이전트: `/root/task5_pdf`
- 기준 커밋: `c1817f1`
- 결과 커밋: 미정
- 변경 파일: 미정
- 구현 결과: 구현 진행 중
- 부모 검토 결과: 미착수
- 서브에이전트 테스트: 미실행
- 부모 독립 테스트: 미실행
- 실환경 검증 여부: 미실행
- 남은 문제 또는 외부 차단 조건: 한국어 글꼴과 Node/Docker 호환 PDF 도구 비교 및 실제 PDF 파싱·렌더링 검증 필요

## Task 6 — Fail-Safe 설정 및 비실물 통합

- 현재 상태: `PENDING`
- 담당 에이전트: 미배정
- 기준 커밋: 미정
- 결과 커밋: 미정
- 변경 파일: 미정
- 구현 결과: 미착수
- 부모 검토 결과: 미착수
- 서브에이전트 테스트: 미실행
- 부모 독립 테스트: 미실행
- 실환경 검증 여부: 미실행
- 남은 문제 또는 외부 차단 조건: 실측 임계값은 Task 7 범위

## Task 7 — 실물 임계값·릴레이 인수

- 현재 상태: `PENDING`
- 담당 에이전트: 미배정
- 기준 커밋: 미정
- 결과 커밋: 미정
- 변경 파일: 미정
- 구현 결과: 미착수
- 부모 검토 결과: 미착수
- 서브에이전트 테스트: 미실행
- 부모 독립 테스트: 미실행
- 실환경 검증 여부: 미실행
- 남은 문제 또는 외부 차단 조건: 실측 장비·하드웨어 프로필·승인 임계값·실물 릴레이 경로 필요

## Task 8 — 메인 Sol 최종 통합 검토

- 현재 상태: `PENDING`
- 담당 에이전트: 메인 `/root`
- 기준 커밋: 미정
- 결과 커밋: 미정
- 변경 파일: 미정
- 구현 결과: 미착수
- 부모 검토 결과: 미착수
- 서브에이전트 테스트: 해당 없음
- 부모 독립 테스트: 미실행
- 실환경 검증 여부: 미실행
- 남은 문제 또는 외부 차단 조건: Task 1~7 상태와 실행 환경에 따름
