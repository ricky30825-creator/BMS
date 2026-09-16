# 실제 연결·진단 UI 실행 상태

| 작업 | 상태 | 확인 기준 |
|---|---|---|
| Modal 닫기 제한 | COMPLETE | 일반 Modal 회귀 + 처리 중 dismiss 차단 |
| 대시보드 그래프 일시정지 | COMPLETE | 수신 지속, 표시 고정, 재생 즉시 최신화 |
| 진단 완료·보조 폴링 | COMPLETE | WS 우선, 상세 조회, ABORTED·FAILED 오류 분리, ID 중복 방지 |
| 실제 연결 상태 피드백 | COMPLETE | WAITING 유지, MEASURING 확인 후 이동, 실패·재시도 |
| 단위·E2E·빌드 검증 | COMPLETE | typecheck, Vitest, build, Chromium E2E, diff check |
| 총 책임자 최종 검토 | COMPLETE | diff·목업 제외·문서·커밋 독립 검토 |
| 실제 백엔드·하드웨어 수용 검증 | EXTERNALLY_BLOCKED | MSW·정적 계약까지만 검증; 실장 장비와 MEASURED 진단은 별도 수용 필요 |

## 계약 확인

- 최신 백엔드는 모드 2 소프트웨어 진단을 허용하고 결과 출처를 `SIMULATED | MEASURED`로 구분한다. 이번 작업에는 새 API·마이그레이션·부하 제어를 추가하지 않았다.
- `docs/backend_contract.md`와 실제 서버는 위 정책이 일치한다. `docs/product_contract.md`·기능정의·유저플로우의 과거 안전 프로필 잠금 문구는 별도 정본 정합성 작업이 필요하며, 이번 프론트 변경에서 임의로 안전 정책을 다시 쓰지 않았다.
- 열화 판정(`HEALTHY | CAUTION | SUSPECT_DEGRADED | BASELINE_PENDING`)은 열폭주 이상점수 등급(`NORMAL | CAUTION | WARNING | DANGER`)과 별도 UI 축으로 표시한다.
