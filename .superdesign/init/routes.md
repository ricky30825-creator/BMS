# Route and screen map

The mockup is a client-rendered single HTML document without a URL router. `state.screen` selects a renderer from `V`, and `data-go` actions change screens.

## General-user destinations

| Screen id | Korean destination | Contract |
|---|---|---|
| `monitor` | 실시간 관제 | F4 |
| `assets` | 배터리 자산관리 | F6 |
| `anomaly` | 이상 탐지 | F8 |
| `trend` | 추세 | F9 |
| `events` | 이벤트 이력 | F10 |
| `alerts` | 알림 센터 | F11 |
| `notices` | 공지사항 | F13 |
| `relay` | 릴레이 제어 | T7 entry |
| `settings` | 설정 | F14 |

## F4 action routing

- 측정 대상 변경 -> `assets`
- 릴레이 차단 -> `relay`; reason and re-authentication required before server-confirmed state change
- 이상 근거 확인 -> `anomaly`
- 추세 전체 보기 -> `trend`
- 공지 전체 보기 -> `notices`
- 전압/전류/온도/SOC selector stays in `monitor`

## Gate

When no battery is connected, every destination except asset management is locked. The locked view explains both the cause and how to unlock it.
