# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 프로젝트 소개

리튬이온 배터리의 전압·전류·온도·SOC 시계열 데이터를 Kafka 파이프라인으로 수집하고, LSTM-AutoEncoder 기반 AI로 열폭주 전조를 조기 탐지하여 React 반응형 웹 대시보드에서 실시간 관제하는 시스템이다. 임계치 차단(사후 대응)이 아니라 정상패턴 학습 기반 이상탐지(사전 예측)가 핵심 차별점이다.

## Codex 작업 원칙

- 이 프로젝트는 Claude를 메인 작업자로, Codex를 보조 작업자로 사용한다.
- Codex는 Claude가 만든 현재 폴더 구조와 문서 체계를 우선 유지한다. 구조 변경, 파일 이동, 대규모 리팩터링은 사용자가 명시적으로 요청한 경우에만 수행한다.
- Codex가 코드, 설정, 산출물, 요구사항을 변경하면 관련 문서를 함께 업데이트한다. 기본 추적 문서는 `PLAN.md`이며, Codex 작업 방식 자체는 `AGENTS.md`에 기록한다.
- 기존 구현 방식과 문서 표현을 먼저 확인한 뒤 그 스타일에 맞춰 최소 범위로 수정한다.
- Claude 전용 지침은 `CLAUDE.md`, Codex 전용 지침은 `AGENTS.md`에 분리해 관리한다. 공통 프로젝트 계획과 변경 이력은 `PLAN.md`에 반영한다.
- 백업 파일은 루트나 작업 산출물 폴더에 남기지 않고 `archive/발표자료_구버전/`에 저장한다. 설계 산출물 백업본도 같은 위치로 이동한다.
- Codex는 작업이 끝나면 변경분을 항상 로컬 git 커밋으로 남긴다. 원격 push는 사용자가 명시적으로 요청한 경우에만 수행한다.
- Claude Code status line은 `.claude/statusline-command.sh`와 `.claude/settings.local.json`에서 관리하며, `모델 | [----------] | 5h/7d 사용률 | git 브랜치 | 프로젝트명` 형식을 유지한다.

## 아키텍처

```
[Edge]              [AWS EC2 (클라우드 서버)]                 [AI]               [Web]
Raspberry Pi        Kafka  → Consumer → PostgreSQL            Google Colab       React
(센서 수집·          battery-raw-       + TimescaleDB          LSTM-AutoEncoder   대시보드
 Kafka 프로듀서)     metrics            (시계열 하이퍼테이블)    (학습·실시간 추론)
   │                battery-anomaly-                                │
   │  TLS/SASL       alerts  ◀───────── 추론결과 발행 ──────────────┘
   └───────────────▶ battery-events            ▲
                     백엔드(REST/WebSocket)     └ raw-metrics 구독 (TLS)
                       │
                       └ WebSocket ─▶ React 대시보드
                       └ 카카오톡 알림

릴레이/Kill-Switch(물리 차단)는 에지(Raspberry Pi)측에서 동작
```

데이터 흐름: 에지(라즈베리파이)가 Raw 값만 **AWS EC2의 Kafka 브로커에 TLS로 직접 발행** → EC2의 Consumer가 TimescaleDB 적재 → **Google Colab의 AI가 Kafka에서 raw-metrics를 구독·추론 후 anomaly-alerts 토픽 발행** → EC2 백엔드가 WebSocket으로 프론트엔드에 푸시

## 레포 구조 (예정)

```
/
├── edge/           # Raspberry Pi 센서 수집 (Python)
│   ├── sensors/    # INA226, BQ27441, DS18B20, MLX90614, ADS1115(가스·압력·음향) 드라이버
│   ├── modes/      # 측정 모드 선택 및 릴레이 인터락
│   └── producer/   # Kafka 프로듀서
├── backend/        # REST API 서버 (Spring Boot 또는 Flask)
│   ├── auth/       # 인증
│   ├── devices/    # 디바이스 관리
│   ├── consumer/   # Kafka Consumer → TimescaleDB 적재
│   ├── relay/      # 릴레이/Kill-Switch 제어 API
│   └── notify/     # 카카오톡 알림 발송
├── ai/             # LSTM-AutoEncoder 이상 탐지 서비스 (Python)
│   ├── train/      # 모델 학습
│   ├── inference/  # 실시간 추론 서버
│   └── features/   # 특징 추출·윈도우링
└── frontend/       # React 반응형 웹 대시보드
    ├── dashboard/  # 실시간 게이지·요약 카드
    ├── charts/     # 추세 차트 (전압/온도/전류)
    ├── events/     # 이벤트 이력·이상 탐지 목록
    ├── settings/   # 임계치·알림 설정
    └── control/    # 릴레이/Kill-Switch 제어
```

## 기술 스택

| 계층 | 기술 |
|---|---|
| 에지 | Python (Raspberry Pi 5), smbus2 (I2C), w1thermsensor (1-Wire), ADS1115 (아날로그 ADC) |
| 클라우드/인프라 | AWS EC2 (Kafka·PostgreSQL·백엔드 호스팅), TLS/SASL |
| 스트리밍 | Apache Kafka |
| DB | PostgreSQL + TimescaleDB (시계열 하이퍼테이블) |
| 백엔드 | Spring Boot 또는 Python Flask |
| AI | PyTorch 또는 TensorFlow (LSTM-AutoEncoder) — Google Colab에서 학습·추론 |
| 프론트엔드 | React (반응형 웹: 데스크톱/태블릿/모바일) |
| 알림 | Kakao Talk API |
| 센서 | INA226(V·I·W), BQ27441(SOC), DS18B20(접촉 온도), MLX90614(IR 온도), ADS1115 경유 가스(MQ-2)·압력(FSR-402)·음향 |
| 하드웨어 | 릴레이 모듈 (GPIO 제어), 전자부하 테스터(U6214), 충전모듈(TP4056), PD 트리거(ZY12PDN) |

## 웹 디자인 원칙

- 웹 대시보드는 데스크톱/태블릿/모바일 반응형 웹으로 설계한다.
- 데스크톱은 좌측 사이드바와 다중 컬럼 관제 화면으로 정보 밀도를 높이고, 태블릿은 접힘 메뉴와 2컬럼 레이아웃을 기본으로 한다.
- 모바일은 하단 내비게이션과 단일 컬럼 카드 흐름을 사용하며, 긴급 경고·현재 이상점수·알림·Kill-Switch 진입을 우선 노출한다.
- 표 중심 화면은 모바일에서 카드 목록/상세 화면으로 전환하고, 차트·필터·제어 버튼은 터치 조작 가능한 크기를 유지한다.
- 실시간 갱신 중 레이아웃 흔들림을 최소화하고, 다크모드·명도 대비·키보드 탐색·스크린리더 라벨을 고려한다.

## 관리자 기능

- 일반 사용자와 별도로 관리자 역할(RBAC)을 둔다.
- 제공 기능: 사용자/계정 관리(권한 부여·회수, 계정 활성/정지, 비밀번호 초기화), 전체 배터리·디바이스 **통합 관제**, **감사 로그**(제어·접근 이력), **시스템 상태 모니터링**(Kafka·Consumer·DB·AI 헬스), 전역 임계치·공지 관리.
- 상세 요구사항·기능·산출물 목록은 `PLAN.md`와 설계 산출물 PPT(`설계 산출물/설계 산출물_v4_6.29.pptx` 슬라이드 31~35)를 단일 출처로 한다.

## Kafka 토픽 규약

| 토픽 | 발행자 | 용도 |
|---|---|---|
| `battery-raw-metrics` | 에지 (Raspberry Pi) | 센서 Raw 데이터 (100ms 주기) |
| `battery-anomaly-alerts` | AI 추론 서버 (Google Colab) | 이상점수, 파생 온도(칼만 필터, 내부 셀 추정) |
| `battery-events` | 에지/백엔드 | 센서 오류, 인터락 발생, 릴레이 제어 이벤트 |

> Kafka 브로커는 AWS EC2에서 운영하며, 모든 클라이언트(에지·Colab·백엔드)는 TLS/SASL로 접속한다.

## 센서 데이터 JSON 스키마

에지는 Raw 측정값만 전송한다. 칼만 필터링과 내부 셀 온도 추정은 AI 서버에서 수행한다.

에지는 `device_id`(측정 장비=라즈베리파이)만 전송하며, `battery_id`(측정 대상 자산)는 에지가 모른다. battery_id 귀속은 백엔드 세션 태깅으로 적재 시점에 부여한다(아래 "배터리 자산" 참조).

```json
{
  "device_id": "string",
  "mode": 1,
  "timestamp": "ISO8601",
  "voltage_v": 3.82,
  "current_a": 12.7,
  "power_w": 48.5,
  "soc_pct": 81,
  "temp_contact": 34.1,
  "temp_ir_surface": 35.2,
  "temp_ambient": 25.0,
  "insulation_mohm": 2.4,
  "gas_raw": 180,
  "pressure_raw": 420,
  "acoustic_raw": 35
}
```

모드별 온도 필드:
- 모드 1·2 (내장 배터리/외부 셀): `temp_contact` + `temp_ir_surface`
- 모드 3 (보조배터리): `temp_ir_surface` + `temp_ambient`

모드별 추가 센서 필드 (아날로그 → ADS1115 → I2C 수집):
- `gas_raw` (오프가스, MQ-2): **모드 1·2·3 전부**
- `pressure_raw` (스웰링 압력, FSR-402): **모드 1·2**
- `acoustic_raw` (미세 크랙 음향): **모드 1·2**

## AI 모델 핵심 파라미터

- **모델**: LSTM-AutoEncoder
- **윈도우**: 30 time-steps
- **특징**: `V_scaled`, `V_delta`, `V_drop`, `I_smooth`, `dT_dt`, `d2T_dt2`, `Wh_cumsum`
- **이상점수**: 재구성 오차(MSE)
- **상태 등급**:

| 등급 | 이상점수 범위 |
|---|---|
| 정상 | 0.0 – 0.3 |
| 주의 | 0.3 – 0.6 |
| 경고 | 0.6 – 0.8 |
| 위험 | 0.8 – 1.0 |

## 측정 모드

| 모드 | 대상 | 인터락 |
|---|---|---|
| 1 — 내장 배터리 | Raspberry Pi 내장 배터리 | 모드 간 상호배제 (동시 활성 불가) |
| 2 — 외부 셀 | 외부 리튬이온 셀 | 동일 |
| 3 — 보조배터리 | USB 보조배터리 | 동일 |

모드 변경 시 릴레이 채널 매핑이 바뀌며, 인터락 로직이 이전 모드의 릴레이를 반드시 먼저 차단한다.

## 배터리 자산(Battery Asset)과 이력 추적

측정 **장비**(`device_id`, 라즈베리파이)와 측정 **대상**(`battery_id`, 셀/보조배터리)을 분리한다. 보조배터리는 자동 인식이 불가하므로 사용자가 자산으로 등록해두고 재연결 시 목록에서 **수동 선택**해 이전 이력을 잇는다. 배터리에는 `target_mode`가 고정되어 재연결 시 모드 재선택이 불필요하다. 등록 시 배터리 종류(`chemistry`: 리튬이온/리튬폴리머, **필수**)와 직렬 셀 수(`series_count`, 선택)를 함께 받아 전압 임계값 해석·AI 이상탐지 추정의 기준으로 쓴다(임계값은 LSTM 정상패턴 학습으로 추정). `battery_id` 귀속은 에지가 아니라 백엔드 세션 태깅으로 부여한다.

> 웹에서 이 기능의 화면/메뉴 명칭은 **"배터리 자산관리"**다(하위 액션: 새 배터리 등록 / 저장된 배터리 선택, 별도 페이지: 배터리 상세/이력).

> 데이터 모델(`battery_asset`/`measurement_session`)·태깅 흐름·엣지 케이스 상세는 `PLAN.md` 참조.

## 요구사항 추적

상세 요구사항·기능·스펙은 `PLAN.md` 참조. Manyfast 프로젝트 ID: `7241ba62-d21a-4de4-ba45-fe572dd0f4de`
