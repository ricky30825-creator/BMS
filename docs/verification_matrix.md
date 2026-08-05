# 검증 매트릭스

이 문서는 작업 범위에 맞는 최소 검증과 중단 조건을 정한다. 모든 명령을 매번 실행하는 것이 아니라, 변경한 계층과 관련된 행을 적용한다.

## 작업 시작 전

| 확인 | 명령·방법 | 통과 기준 |
|---|---|---|
| 기존 변경 보존 | `git status --short --branch` | 작업과 무관한 변경을 확인하고 보존한다 |
| 작업 범위 | [`AGENTS.md`](../AGENTS.md)와 관련 정본 문서 읽기 | 대상 파일·정본·중단 조건이 명확하다 |
| 공백·패치 오류 | `git diff --check` | 출력이 없다 |
| 로컬 문서 링크 | `DOC=AGENTS.md; rg -o '\]\([^)]*\)' "$DOC" | sed -E 's/^\]\((.*)\)$/\1/'` 후 대상 존재 확인 | 깨진 상대 링크가 없다 |

## 문서·계약 변경

| 변경 범위 | 검증 | 통과 기준 | 실패·중단 |
|---|---|---|---|
| Markdown 문서 | `git diff --check`, 상대 링크 대상 확인 | 문법 오류·깨진 링크가 없다 | 정본과 충돌하면 구현하지 말고 정본을 먼저 수정·합의 |
| 제품 계약서 | `python3 tools/contract_lint.py docs/product_contract.md` | `위반 0건` | 금지 어휘·REQ·게이트·불변 위반을 먼저 해결 |
| HTML 번들 | `python3 tools/landing_lint.py <번들 HTML>` | `0건` 또는 `토큰 규칙 통과` | 원본 HTML이 없거나 번들 형식이 다르면 검증 결과를 만들지 않는다 |
| 요구사항 수 변경 | `tools/test_contract_lint.py`와 관련 문서 대조 | EXPECTED/EXCLUDED REQ와 문서가 일치 | 개수 불일치를 무시하고 통과 처리하지 않는다 |

## 백엔드

| 변경 범위 | 명령·방법 | 통과 기준 |
|---|---|---|
| TypeScript·타입 | `npm --prefix backend run typecheck` | 종료 코드 0 |
| 빌드 | `npm --prefix backend run build` | 종료 코드 0, 소스 오류 없음 |
| 런타임 기본 상태 | 환경변수·DB 준비 후 `npm --prefix backend run dev`, `curl http://localhost:3005/health` | `{"status":"ok"}` 응답 |
| 인증·권한 | Better Auth 마이그레이션/세션으로 `/api/auth/*`, `/api/me`, `/api/admin/*` 확인 | 세션 검증과 `ADMIN` 재검증이 서버에서 동작 |
| API 계약 변경 | [`docs/backend_contract.md`](backend_contract.md) 해당 절과 요청/응답·에러 코드 비교 | 계약서의 도메인 불변식·소유권·감사 로그를 만족 |

현재 백엔드에 실제로 존재하는 범위는 인증 골격, `/health`, `/api/me`, 관리자 헬스, 릴레이 확인 스텁이다. Consumer·TimescaleDB·배터리 자산/세션 API는 이 매트릭스의 런타임 검증 대상이지만 아직 실행할 구현이 없다.

## Python 도구

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
```

기준선(2026-08-02) 결과는 **48개 중 1개 실패**다. `tools/test_contract_lint.py:151`이 `EXPECTED_REQS`를 103개로 기대하지만 현재 실제 집합은 110개다. 이 불일치는 기존 테스트 기준선 드리프트로 기록하며, 새 변경의 통과로 간주하지 않는다.

## 하드웨어·회로

| 변경 범위 | 검증 | 통과 기준 |
|---|---|---|
| 모드 1 회로 | `tools/gen_mode1_sch.py` 실행 후 KiCad ERC와 netlist 확인 | 생성 회로와 네트 연결이 일치하고 ERC 위반 0건 |
| 모드 1 센서 | [`docs/hardware/mode1_backend_spec.md` §13](hardware/mode1_backend_spec.md#13-실물로-확인해야-하는-것)의 H1~H9 순서 | 실측값·주소·ROM 위치·프레임·baseline·TFT 전원 호환성을 기록하기 전 구현 확정 금지 |
| 모드 2 진단 | [`docs/hardware/mode2_powerbank_diagnosis_spec.md` §3~§8](hardware/mode2_powerbank_diagnosis_spec.md#8-미결정) | 안전 중단·완충 게이트·기준선·미결정 문턱을 구분 |
| 보유부품 통합형 | [`docs/hardware/mode1_mode2_combined_beginner_guide.md`](hardware/mode1_mode2_combined_beginner_guide.md) | `SOURCE_P` 양극 한 가닥, INA226 ID·CAL·OVF·션트 검산, 0.5A·10초 중단. 서버 `device_id` 프로필=V1에서 quick/capacity 각각 `409 SAFETY_PROFILE_NOT_READY`, Raw의 `gas_raw`·`temp_contact`·`temp_points.contact`·`pressure_raw`·`soc_pct`·`diag_phase`·`load_target_a` 모두 `null`, 릴레이 `1,0,0,0` 요청 거부 증적 |
| 릴레이·Fail-Safe | 무부하·전류 0A·인터락 순서 포함한 벤치 시험 | AI 결과와 무관한 안전 차단, 자동 복구 금지, 감사 이벤트 기록 |

실물 전압·전류·온도 확인 없이 센서 주소, 임계값, 부하 동작을 추정하지 않는다.

## 프론트엔드·시각 검토

- 현재 `frontend/`에는 실행 가능한 전체 React 프로젝트가 없으므로 `npm test`나 `npm run build`를 성공한 것으로 보고하지 않는다.
- 화면 변경은 [`docs/product_contract.md`](product_contract.md), [`docs/backend_contract.md`](backend_contract.md), [`design-system/cellguard/MASTER.md`](../design-system/cellguard/MASTER.md), 최신 권위 HTML을 함께 확인한다.
- 반응형·접근성·WebSocket 재연결은 코드 리뷰만으로 끝내지 않고 실제 브라우저에서 데스크톱·태블릿·모바일 폭을 확인한다.
- `anomaly_score`·등급 경계·원본 데이터 표시는 계약서의 스케일과 불변식에 맞는지 확인한다.

### F21·관리자 상세 브라우저 인수 기준

| 상태 | 통과 기준 |
|---|---|
| 미연결 / 모드 1 | F21은 실행 경로를 열지 않고 각각 연결 필요 / 모드 2 전용을 안내한다 |
| 모드 2 + 기본 `COMBINED_EXISTING_PARTS_V1` | 안전 준비 전·실행 잠금, 빠른/정밀 버튼 우회 불가, `soc_pct`·가스·접촉온도·진단 단계 등 미지원값을 `—`로 표시한다 |
| 숨은 프로토타입 속성 `MODE2_FULL` | 최종 사용자 화면에 프로필 전환기가 없고, PACK-003의 정본 목업값·빠른 확인·정밀 완충/소요시간 확인·진행/즉시 중단·이력이 동작한다. 실제 구현에서는 이 속성이 서버 capability를 우회하지 않는다 |
| 관리자 운영 상태 | NORMAL/WATCH/BLOCKED의 모든 실제 전환에서 사유와 확인을 요구하고, 성공 전에는 목록/상세를 바꾸지 않는다. BLOCKED 해제도 세션/릴레이를 자동 복구하지 않는다 |
| 관리자 메모 | 상태와 별도 native 입력·별도 저장이며, 상태 사유 없이 저장할 수 있고 상세 재진입 후 유지된다 |

## 통합·배포

다음 조건이 모두 준비되기 전에는 E2E 통과를 선언하지 않는다.

- 에지 Raw 발행과 TLS/SASL 인증
- Kafka 토픽·Consumer·TimescaleDB 적재
- `battery_id` 측정 세션 태깅
- AI의 `battery-anomaly-alerts` 발행
- 백엔드 WebSocket과 프론트 화면
- Fail-Safe·이벤트·감사 로그

통합 테스트의 기준 흐름은 `에지 → Kafka → DB → AI → 백엔드 → 대시보드`이며, 이상 시나리오에서는 오탐·미탐·센서 오류·네트워크 단절·릴레이 차단 순서를 별도로 기록한다.
