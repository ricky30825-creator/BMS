# AGENTS.md

이 파일은 `/Users/jungjeahwan/Desktop/claude/han` 저장소에서 Codex가 작업할 때 적용하는 최소 운영 지침이다. 상세 사양은 아래 정본 문서를 작업 범위에 맞춰 읽는다. 문서 링크는 자동으로 전부 로드된다는 뜻이 아니므로, 작업 시작 전에 관련 링크를 직접 확인한다.

## 프로젝트 요약

Raspberry Pi가 배터리 전압·전류·온도·SOC 시계열을 Kafka로 보내고, LSTM-AutoEncoder와 Informer가 현재 이상·미래 위험을 분석해 React 관제 화면에 전달하는 배터리 열폭주 조기감지 시스템이다. 릴레이/Kill-Switch는 AI와 독립된 에지 안전계층이다.

## 작업 원칙

- 공유 원격 저장소는 `https://github.com/ricky30825-creator/BMS`다.
- 이 프로젝트는 Claude가 메인 작업자이고 Codex는 보조 작업자다. 현재 폴더 구조·문서 체계를 우선 유지하며, 구조 변경·파일 이동·대규모 리팩터링은 사용자가 명시한 경우에만 한다.
- 기존 구현과 문서 표현을 먼저 확인하고 최소 범위로 수정한다.
- 코드·설정·요구사항을 바꾸면 해당 정본 문서도 함께 갱신한다. `PLAN.md`는 프로젝트 방향·요구사항·계획, `AGENTS.md`는 Codex 운영 규칙, `CLAUDE.md`는 Claude 전용 지침을 담는다.
- 최신 사용자 제공 HTML 와이어프레임과 문서가 충돌하면 HTML에 실제 표시된 화면·버튼·입력·탭·필터·모달·카드·상태값을 우선한다. HTML만으로 동작이 불명확하면 `정의 필요`로 표시한다.
- GitHub 공유 레포에는 개발·검토에 필요한 코드·설정·Markdown·웹/다이어그램 자산만 둔다. 발표자료·원본 산출물·보고서·백업·샘플 문서는 추적하지 않는다.
- 백업본은 해당 산출물 폴더의 `아카이브/` 또는 루트 `archive/`에 둔다.
- 작업이 끝나면 변경분을 항상 로컬 git 커밋으로 남긴다. 원격 push는 사용자가 명시적으로 요청한 경우에만 한다.

## 작업별 정본 문서

| 작업 범위 | 먼저 읽을 문서 |
|---|---|
| 전체 요구사항·아키텍처·데이터 모델·로드맵 | [`PLAN.md`](PLAN.md) |
| 제품 동작·일반/관리자 기능 계약·화면 동작 | [`docs/product_contract.md`](docs/product_contract.md) |
| REST·WebSocket·도메인 불변식 | [`docs/backend_contract.md`](docs/backend_contract.md) |
| 일반 사용자 기능·흐름 | [`docs/feature_definition.md`](docs/feature_definition.md), [`docs/userflow.md`](docs/userflow.md) |
| 관리자 기능·흐름 | [`docs/admin_feature_definition.md`](docs/admin_feature_definition.md), [`docs/admin_userflow.md`](docs/admin_userflow.md) |
| 모드 1 에지 수집·회로·조립 | [`docs/hardware/mode1_backend_spec.md`](docs/hardware/mode1_backend_spec.md), [`docs/hardware/mode1_beginner_guide.md`](docs/hardware/mode1_beginner_guide.md), [`hardware/mode1/README.md`](hardware/mode1/README.md) |
| 모드 2 보조배터리 진단 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](docs/hardware/mode2_powerbank_diagnosis_spec.md) |
| 시각 디자인·반응형·디자인 토큰 | [`design-system/cellguard/MASTER.md`](design-system/cellguard/MASTER.md), [`web/cellguard_mockup_v4.html`](web/cellguard_mockup_v4.html) |
| 백엔드 구현 진입점 | [`backend/README.md`](backend/README.md), [`docs/backend_contract.md`](docs/backend_contract.md) |
| Claude 작업 규칙·정본 문서 지도 | [`CLAUDE.md`](CLAUDE.md) |

특정 기능의 과거 작업 계획·컴포넌트 레시피가 필요할 때만 [`docs/superpowers/`](docs/superpowers/)에서 해당 문서를 찾아 읽는다. 모든 Markdown 파일을 이 파일에 복제하거나 상시 로드하지 않는다.

## 충돌 해소와 핵심 불변식

- 충돌 우선순위는 실제 회로·실물 제약 → 최신 사용자 HTML → 제품/백엔드 계약서 → `PLAN.md` → 기능정의서·유저플로우·기타 참고 문서 순서다.
- 측정 모드는 외부 셀(모드 1)과 보조배터리(모드 2) 두 개뿐이며, 한 번에 배터리 한 개와 활성 측정 세션 하나만 허용한다. 모드 변경 전 이전 릴레이를 먼저 차단한다.
- 에지는 Raw 센서값과 `device_id`만 보내고 `battery_id`는 백엔드 측정 세션 태깅으로 부여한다. 자세한 스키마와 예외는 [`PLAN.md`](PLAN.md) 및 하드웨어 스펙을 따른다.
- LSTM-AutoEncoder·Informer의 AI 판정과 가스·압력·음향 등 독립 안전계층을 섞지 않는다. 안전 조건은 AI 판정과 무관하게 릴레이 차단을 수행할 수 있다.
- 모드별 센서 가용 필드, `soc_pct`, 릴레이 채널, 진단 단계, 산출 불가 값은 요약해서 추정하지 말고 해당 하드웨어 정본 문서를 읽는다. 특히 모드 2는 [`docs/hardware/mode2_powerbank_diagnosis_spec.md`](docs/hardware/mode2_powerbank_diagnosis_spec.md)가 정본이다.

## 완료 검토

변경 전후 `git diff --check`, 관련 링크의 대상 파일 존재 여부, 해당 범위의 테스트·검증 결과를 확인한다. 작업과 무관한 기존 변경은 보존하고 커밋에 섞지 않는다.
