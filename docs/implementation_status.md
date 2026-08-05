# 구현 상태 및 문서 지도

> 기준일: 2026-08-05

이 문서는 설계 문서의 요구사항과 현재 저장소에 실제로 존재하는 구현을 구분하기 위한 실행용 지도다. 요구사항의 정본이 아니며, 상세 계약은 아래 링크의 원본 문서를 따른다.

## 읽는 법

- **구현됨**: 저장소에서 실행 가능한 코드나 검증 가능한 산출물을 확인할 수 있다.
- **부분 구현**: 골격·스텁·단일 화면만 있고 전체 계약은 아직 구현되지 않았다.
- **문서만 있음**: 설계·계약은 있지만 실행 코드나 실물 검증 결과가 없다.
- **미착수**: 계획에는 있으나 현재 저장소에서 구현을 확인할 수 없다.

## 현재 저장소 상태

| 영역 | 현재 확인되는 것 | 상태 |
|---|---|---|
| 요구사항·제품 계약 | [`PLAN.md`](../PLAN.md), [`docs/product_contract.md`](product_contract.md), 기능정의서·유저플로우 | 구현 기준 문서 있음 |
| 백엔드 인증 골격 | `backend/src/auth.ts`, 세션 미들웨어, 감사 로그, DB 연결, Better Auth `/api/auth/*` | 부분 구현 |
| 백엔드 현재 라우트 | `/health`, `/api/me`, `/api/admin/health`, 릴레이 확인 스텁 | 부분 구현 |
| 백엔드 전체 API·Consumer·TimescaleDB | 계약서는 있으나 배터리 자산, 측정 세션, Kafka Consumer, 시계열 적재 구현은 없음 | 미착수 |
| 에지 소프트웨어 | 하드웨어 계약서는 있으나 `edge/` 디렉터리와 센서·릴레이·Kafka 프로듀서 구현은 없음 | 미착수 |
| AI 소프트웨어 | 모델 설계는 있으나 `ai/` 디렉터리, Colab 노트북, 학습·추론·Kafka 연동 구현은 없음 | 미착수 |
| 프론트엔드 | [`frontend/dashboard/RealtimeDashboard.jsx`](../frontend/dashboard/RealtimeDashboard.jsx) 단일 대시보드 컴포넌트 | 부분 구현 |
| 프론트엔드 실행 기반 | `frontend/package.json`, 라우팅, 스타일 시스템, 전체 화면 구현은 없음 | 미착수 |
| 모드 1 하드웨어 | KiCad 회로 파일, [`docs/hardware/mode1_backend_spec.md`](hardware/mode1_backend_spec.md), 조립 안내서 | 문서·설계 있음, 실물 검증 전 |
| 모드 2 하드웨어 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](hardware/mode2_powerbank_diagnosis_spec.md) | 설계 계약 있음, 구현 전 |
| 디자인·목업 | [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](../web/cellguard_mockup_v4.html) | 참고 산출물 있음 |
| 자동 검증 도구 | `tools/contract_lint.py`, `landing_lint.py`, `bundle_io.py` 및 단위 테스트 | 부분 구현 |

### 2026-08-05 계약 동기화 주의

v3 프로토타입과 정본 문서에는 모드 1/2, 대표 온도 최댓값, signed 전류, 모드 2 상대 SOC, 서버 Fail-Safe 자동 차단, 서버 자동 승인 릴레이, 100ms Raw CSV, WS 재연결·중복 방지 규약이 반영됐다. 이는 **화면·계약 동기화 결과이지 백엔드 구현 완료를 뜻하지 않는다.** 해당 REST/WS, export job, Fail-Safe 판정·승인·감사 원자 처리는 현재 구현 상태상 미착수 또는 스텁이다.

`backend/dist/`는 TypeScript 빌드 산출물이며 소스 구현의 근거로 세지 않는다. `PLAN.md`의 예정 폴더 구조도 실제 디렉터리 존재를 의미하지 않는다.

## PLAN 로드맵과 실제 상태

| 단계 | PLAN 기준 | 현재 판단 |
|---|---|---|
| Phase 1 인프라·백엔드 기반 | 백엔드 초기화·인증 골격만 완료 | 부분 구현. EC2, Kafka, PostgreSQL/TimescaleDB는 미착수 |
| Phase 2 에지 수집 | 센서·100ms 폴링·릴레이·음성·프로듀서 | 미착수 |
| Phase 3 스트리밍 | Consumer·세션 태깅·적재·오프셋 | 미착수 |
| Phase 4 AI | 데이터셋·특징·AE·Informer·추론 | 미착수 |
| Phase 5 웹 | React 초기화·라우팅·화면·관리자 | 단일 컴포넌트만 있음 |
| Phase 6 알림·차단 | 카카오·Fail-Safe·음성 설정 | 미착수 또는 스텁 |
| Phase 7 통합·배포 | E2E·시나리오·운영 모니터링 | 미착수 |

세부 체크리스트는 [`PLAN.md` §8 개발 로드맵](../PLAN.md#8-개발-로드맵)을 기준으로 갱신한다.

## 정본 문서 지도

- 전체 요구사항·데이터 모델·로드맵: [`PLAN.md`](../PLAN.md)
- 제품 동작·기능 계약: [`docs/product_contract.md`](product_contract.md)
- REST·WebSocket·도메인 불변식: [`docs/backend_contract.md`](backend_contract.md)
- 일반/관리자 기능과 흐름: [`docs/feature_definition.md`](feature_definition.md), [`docs/admin_feature_definition.md`](admin_feature_definition.md), [`docs/userflow.md`](userflow.md), [`docs/admin_userflow.md`](admin_userflow.md)
- 모드 1 수집·회로·조립: [`docs/hardware/mode1_backend_spec.md`](hardware/mode1_backend_spec.md), [`docs/hardware/mode1_beginner_guide.md`](hardware/mode1_beginner_guide.md), [`hardware/mode1/README.md`](../hardware/mode1/README.md)
- 모드 2 진단: [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](hardware/mode2_powerbank_diagnosis_spec.md)
- 디자인·목업: [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](../web/cellguard_mockup_v4.html)

## 현재 확인된 결정·미결정 게이트

1. 최신 화면 정본은 `설계 산출물/셀가드 프로토타입_v3.html`이다. F21 안전 잠금·숨은 `MODE2_FULL` 검토 상태와 관리자 상태/메모 분리 저장 화면까지 반영됐지만, 실제 REST·안전 제어 구현 완료를 뜻하지 않는다.
2. 모드 1은 [`docs/hardware/mode1_backend_spec.md` §13](hardware/mode1_backend_spec.md#13-실물로-확인해야-하는-것)의 H1~H8을 실물로 확인하기 전 센서 해석을 확정하지 않는다.
3. 모드 2의 표면온도·상승률·부스트 효율·컷오프 복귀 등은 [`docs/hardware/mode2_powerbank_diagnosis_spec.md` §8](hardware/mode2_powerbank_diagnosis_spec.md#8-미결정)의 미결정 항목을 임의로 채우지 않는다.
4. 백엔드 계약의 `[정의 필요]` 항목은 [`docs/backend_contract.md` §9](backend_contract.md#9-미결정-항목)를 확인하고, 값을 추정해 API나 UI에 하드코딩하지 않는다.
5. AI 구현에는 아직 데이터셋 위치·라벨 규칙·체크포인트 형식·특징 버전·추론 메시지 계약·Colab↔AWS 인증 절차가 없다. 이 정보 없이 모델 학습이나 실시간 추론 코드를 시작하지 않는다.

## 권장 다음 순서

1. 최신 HTML의 저장 위치와 권위 기준을 확정한다.
2. 백엔드의 `battery_asset`·`measurement_session`과 Kafka/DB 경계를 구현한다.
3. 에지 수집 계약을 코드로 옮기고 모드 1 실물 게이트를 닫는다.
4. AI 입출력 계약과 Colab 실행 절차를 확정한 뒤 모델 구현을 시작한다.
5. 프론트엔드 실행 기반을 만든 후 계약서·WebSocket에 연결한다.
6. 마지막에 에지→Kafka→DB→AI→대시보드 통합 검증을 수행한다.
