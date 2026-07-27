# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 프로젝트 소개

리튬이온 배터리의 전압·전류·온도·SOC 시계열 데이터를 Kafka 파이프라인으로 수집하고, LSTM-AutoEncoder(현재 상태 진단)와 Informer(미래 상태 예측)를 결합한 이중 모델 AI로 열폭주 전조를 조기 탐지하여 React 반응형 웹 대시보드에서 실시간 관제하는 시스템이다. 임계치 차단(사후 대응)이 아니라 정상패턴 학습 기반 이상탐지(사전 예측)가 핵심 차별점이다.

## Codex 작업 원칙

- 이 프로젝트의 공유 원격 저장소는 `https://github.com/ricky30825-creator/BMS`다.
- 이 프로젝트는 Claude를 메인 작업자로, Codex를 보조 작업자로 사용한다.
- Codex는 Claude가 만든 현재 폴더 구조와 문서 체계를 우선 유지한다. 구조 변경, 파일 이동, 대규모 리팩터링은 사용자가 명시적으로 요청한 경우에만 수행한다.
- Codex가 코드, 설정, 요구사항을 변경하면 관련 문서를 함께 업데이트한다. `PLAN.md`는 `AGENTS.md`에 적기 어려운 전반적인 프로젝트 방향성·요구사항·계획을 담는 문서이며, 발표자료/PPT 등 산출물 편집 로그는 기록하지 않는다. Codex 작업 방식 자체는 `AGENTS.md`에 기록한다.
- 기존 구현 방식과 문서 표현을 먼저 확인한 뒤 그 스타일에 맞춰 최소 범위로 수정한다.
- Claude 전용 지침은 `CLAUDE.md`, Codex 전용 지침은 `AGENTS.md`에 분리해 관리한다. 공통 프로젝트 계획과 변경 이력은 `PLAN.md`에 반영한다.
- 와이어프레임 HTML을 기준으로 기능정의서나 화면 흐름을 정리할 때는 HTML에 명확히 표시된 화면·버튼·입력·탭·필터·모달·카드·상태값을 우선한다. `PLAN.md`와 충돌하면 사용자가 제공한 HTML을 기준으로 `PLAN.md`, `docs/userflow.md`, `docs/admin_userflow.md`, `docs/feature_definition.md`, `docs/admin_feature_definition.md`를 맞춘다. HTML만으로 동작이 불명확한 항목은 `정의 필요`로 표시한다.
- GitHub 공유 레포에는 팀원이 개발·검토에 직접 쓰는 코드, 설정, Markdown 문서, 웹/다이어그램 자산만 남긴다. 발표자료, 설계 산출물 원본, 클로드 보고, 백업 파일, 샘플 PDF/DOCX/PPTX는 로컬 보관 대상으로 보고 레포에 추적하지 않는다.
- 백업본은 항상 아카이브로 이동한다. 특정 산출물 폴더에 `아카이브/`가 있으면 그 안에 두고, 없으면 루트 `archive/`를 사용한다. 백업 파일을 루트나 현재 작업 폴더에 흩어 두지 않는다.
- Codex는 작업이 끝나면 변경분을 항상 로컬 git 커밋으로 남긴다. 원격 push는 사용자가 명시적으로 요청한 경우에만 수행한다.

## 아키텍처

```
[Edge]              [AWS EC2 (클라우드 서버)]                 [AI]                    [Web]
Raspberry Pi        Kafka  → Consumer → PostgreSQL            Google Colab            React
(센서 수집·          battery-raw-       + TimescaleDB          LSTM-AutoEncoder        대시보드
 Kafka 프로듀서)     metrics            (시계열 하이퍼테이블)    + Informer 이중 모델
   │                battery-anomaly-                          (학습·실시간 추론,
   │  TLS/SASL       alerts  ◀───────── 추론결과 발행 ─────────  Score Fusion)
   └───────────────▶ battery-events            ▲                     │
                     백엔드(REST/WebSocket)     └ raw-metrics 구독 (TLS)
                       │
                       └ WebSocket ─▶ React 대시보드
                       └ 카카오톡 알림

릴레이/Kill-Switch(물리 차단)와 스피커 음성 안내는 에지(Raspberry Pi)측에서 동작
```

데이터 흐름: 에지(라즈베리파이)가 Raw 값만 **AWS EC2의 Kafka 브로커에 TLS로 직접 발행** → EC2의 Consumer가 TimescaleDB 적재 → **Google Colab의 AI(LSTM-AutoEncoder + Informer)가 Kafka에서 raw-metrics를 구독·추론 후 두 모델의 점수를 Score Fusion으로 결합해 anomaly-alerts 토픽 발행** → EC2 백엔드가 WebSocket으로 프론트엔드에 푸시. 에지는 보조배터리 연결, 측정 시작/종료, 이상·오류·릴레이 이벤트를 사전 생성된 로컬 음성파일로 안내한다.

## 레포 구조 (예정)

```
/
├── edge/           # Raspberry Pi 센서 수집 (Python)
│   ├── sensors/    # INA226, BQ27441, DS18B20, MLX90614, ADS1115(가스·압력·음향) 드라이버
│   ├── modes/      # 측정 모드 선택 및 릴레이 인터락
│   └── producer/   # Kafka 프로듀서
├── backend/        # REST API 서버 (Node.js + TypeScript + Express)
│   ├── auth/       # Better Auth 세션 인증/RBAC
│   ├── devices/    # 디바이스 관리
│   ├── consumer/   # Kafka Consumer → TimescaleDB 적재
│   ├── relay/      # 릴레이/Kill-Switch 제어 API
│   └── notify/     # 카카오톡 알림 발송
├── ai/             # LSTM-AutoEncoder + Informer 이중 모델 이상 탐지 서비스 (Python)
│   ├── train/      # 모델 학습 (LSTM-AutoEncoder, Informer 개별 학습)
│   ├── inference/  # 실시간 추론 서버 (AE/Informer 점수 계산 + Score Fusion)
│   └── features/   # 특징 추출·윈도우링
└── frontend/       # React 반응형 웹 대시보드
    ├── dashboard/  # 실시간 게이지·요약 카드
    ├── charts/     # 추세 차트 (전압/온도/전류)
    ├── events/     # 이벤트 이력·이상 탐지 목록
    ├── settings/   # 알림 설정
    └── control/    # 릴레이/Kill-Switch 제어
```

## 기술 스택

| 계층 | 기술 |
|---|---|
| 에지 | Python (Raspberry Pi 5), smbus2 (I2C), w1thermsensor (1-Wire), ADS1115 (아날로그 ADC) |
| 클라우드/인프라 | AWS EC2 (Kafka·PostgreSQL·백엔드 호스팅), TLS/SASL |
| 스트리밍 | Apache Kafka |
| DB | PostgreSQL + TimescaleDB (시계열 하이퍼테이블) |
| 백엔드 | Node.js + TypeScript + Express + Better Auth |
| AI | PyTorch 또는 TensorFlow (LSTM-AutoEncoder + Informer 이중 모델, Score Fusion) — Google Colab에서 학습·추론 |
| 프론트엔드 | React (반응형 웹: 데스크톱/태블릿/모바일) |
| 알림 | Kakao Talk API |
| 센서 | INA226(V·I·W), BQ27441(SOC — SparkFun Battery Babysitter 탑재), DS18B20(접촉 온도), MLX90614(IR 온도), ADS1115 경유 가스(MQ-2)·압력(FSR 406)·음향 |
| 하드웨어 | 릴레이 모듈 (GPIO 제어), 스피커 모듈(로컬 음성 안내), 전자부하 테스터(ATORCH BW150), 충방전모듈(SZH-MIN002), PD 트리거(ZY12PDN), 0.96" OLED(SPI) |

## 웹 디자인 원칙

- 웹 대시보드는 데스크톱/태블릿/모바일 반응형 웹으로 설계한다.
- 데스크톱은 좌측 사이드바와 다중 컬럼 관제 화면으로 정보 밀도를 높이고, 태블릿은 접힘 메뉴와 2컬럼 레이아웃을 기본으로 한다.
- 모바일은 하단 내비게이션과 단일 컬럼 카드 흐름을 사용하며, 긴급 경고·현재 이상점수·알림·Kill-Switch 진입을 우선 노출한다.
- 표 중심 화면은 모바일에서 카드 목록/상세 화면으로 전환하고, 차트·필터·제어 버튼은 터치 조작 가능한 크기를 유지한다.
- 실시간 갱신 중 레이아웃 흔들림을 최소화하고, 다크모드·명도 대비·키보드 탐색·스크린리더 라벨을 고려한다.

## 관리자 기능

- 일반 사용자와 별도로 관리자 역할(RBAC)을 둔다.
- 인증은 Better Auth 세션 쿠키와 서버 세션 검증을 기준으로 구현하며, `/api/auth/*`는 Better Auth 핸들러가 담당한다.
- 제공 기능: 사용자/계정 조회, 계정 활성/정지, 비밀번호 재설정, 전체 배터리·디바이스 **통합 관제**, 배터리 운영 상태·관리자 메모, 공지사항 관리, **감사 로그**(제어·접근 이력), **시스템 상태 모니터링**(Kafka·Consumer·DB·AI 헬스).
- 상세 요구사항·기능 목록은 `PLAN.md`, `docs/feature_definition.md`, `docs/admin_feature_definition.md`, `docs/userflow.md`, `docs/admin_userflow.md`를 기준으로 하되, 사용자가 제공한 최신 HTML 와이어프레임과 충돌하면 HTML을 우선한다.

## Kafka 토픽 규약

| 토픽 | 발행자 | 용도 |
|---|---|---|
| `battery-raw-metrics` | 에지 (Raspberry Pi) | 센서 Raw 데이터 (100ms 주기) |
| `battery-anomaly-alerts` | AI 추론 서버 (Google Colab) | 최종 이상점수(Score Fusion) 및 AE/Informer 개별 점수, 파생 온도(칼만 필터, 내부 셀 추정) |
| `battery-events` | 에지/백엔드 | 센서 오류, 인터락 발생, 릴레이 제어 이벤트, 음성 안내 대상 이벤트 |

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
  "gas_raw": 180,
  "pressure_raw": 420,
  "acoustic_raw": 35
}
```

> `insulation_mohm`(절연저항)은 측정 소자가 확보되지 않아 **스키마에서 제거**했다(2026-07-27). 되살리려면 절연저항 측정 수단부터 정한다.

모드별 온도 필드:
- 모드 1 (외부 셀): `temp_contact` + `temp_ir_surface`
- 모드 2 (보조배터리): `temp_ir_surface`

> 온도는 IR 표면온도(및 모드 1의 접촉온도)만 측정한다. 주변/외부 온도(`temp_ambient`)는 측정하지 않는다.

모드별 추가 센서 필드 (아날로그 → ADS1115 → I2C 수집) — **사후 대응(임계 탐지 → 즉시 릴레이 차단) 안전계층**:
- `gas_raw` (오프가스, MQ-2): **모드 1·2 전부**
- `pressure_raw` (스웰링 압력, FSR 406): **모드 1**
- `acoustic_raw` (표면 진동·파열음): **모드 1**

> 가스·압력·음향은 AI 예측 입력 특징이 아니다. 가스 검출은 이미 열폭주가 시작된 신호이므로, 각 센서가 임계값을 초과하면 AI 판정과 무관하게 즉시 릴레이를 차단하는 독립 안전계층으로 동작한다.

## AI 모델 핵심 파라미터

이중 모델 구조 — LSTM-AutoEncoder(현재 상태 진단)와 Informer(미래 상태 예측)가 동일 Sequence 입력을 공유하고, 두 모델의 점수를 Score Fusion(가중합)으로 결합해 최종 이상점수를 산출한다. 2개 측정 모드(외부 셀/보조배터리) 공통 아키텍처다.

- **모델 구성**:
  - **LSTM-AutoEncoder** (현재 상태 진단): Encoder → Latent Space → Decoder로 현재 센서 패턴을 복원
  - **Informer** (미래 상태 예측): Encoder(ProbSparse Attention) → Decoder(Generative Decoder)로 미래 센서 변화 흐름을 예측
- **전처리**: 정규화 + Sliding Window로 일정 길이의 Sequence 데이터 생성 → 두 모델에 동시 입력
- **윈도우**: 30 time-steps
- **특징**: `V_scaled`, `V_delta`, `V_drop`, `I_smooth`, `dT_dt`, `d2T_dt2`, `Wh_cumsum` (전압·전류·온도·SOC 원시값을 전처리해 산출, 두 모델 공통 입력)
- **AE Score**: 입력값과 LSTM-AutoEncoder 복원값의 차이 = Reconstruction Error(재구성 오차, MSE) 기반 현재 이상점수
- **Informer Score**: Informer의 미래 예측값과 실제값의 차이 = Prediction Error(예측 오차) 기반 미래 위험점수
- **Score Fusion(최종 이상점수)**: `Final Score = α × AE Score + β × Informer Score` (가중합, α·β는 고정값이 아니라 테스트하며 튜닝해 결정)
- **판정**: 최종 이상점수가 기준값 이하면 정상(대시보드 반입 가능 표시), 초과하면 위험(대시보드 경고·사용자 알림 발생), 위험등급이 높으면 Relay Kill-Switch로 전원 차단
- **상태 등급** (최종 이상점수 Final Score 기준):

| 등급 | 이상점수 범위 |
|---|---|
| 정상 | 0.0 – 0.3 |
| 주의 | 0.3 – 0.6 |
| 경고 | 0.6 – 0.8 |
| 위험 | 0.8 – 1.0 |

## 측정 모드

| 모드 | 대상 | 인터락 |
|---|---|---|
| 1 — 외부 셀 | 외부 리튬이온(18650)·리튬폴리머 셀 | 모드 간 상호배제 (동시 활성 불가) |
| 2 — 보조배터리 | USB 보조배터리 | 동일 |

모드 변경 시 릴레이 채널 매핑이 바뀌며, 인터락 로직이 이전 모드의 릴레이를 반드시 먼저 차단한다.

> **2모드로 확정(2026-07-27)**. 기존 `모드 1 — 라즈베리파이 내장 배터리`는 해당 배터리를 확보하지 않아 삭제했고, 구 모드 2·3이 각각 신 모드 1·2로 내려왔다. 기존 문서의 `모드 3` 표기는 전부 `모드 2`를 뜻한다.

> **한 번에 배터리 1개만 측정한다.** BQ27441(0x55)은 I2C 주소가 하드웨어 고정이라 같은 버스에 2개를 물릴 수 없고, SOC 없이는 측정 세션이 성립하지 않는다. 다중 배터리 동시 측정은 범위 밖이다(멀티플렉서 미사용).
>
> **단 MLX90614는 주소가 고정이 아니다.** 데이터시트상 SMBus 주소는 EEPROM `0x0E`에 있고 고객이 쓸 수 있다(*"SMBus address (LSB only) | 0x0E | Write access: Yes"*, Figure 36 "Use of multiple MLX90614 devices in SMBus network"). 한 버스에 최대 127개까지 붙는다. 이건 다중 **배터리**가 아니라 **한 셀의 여러 지점**을 동시에 재는 데 쓴다 — MLX90614는 소자 1개짜리라 FOV 안 평균만 내므로, 여러 개를 다른 지점에 겨눠야 공간 피크가 나온다.

## 확정 부품과 하드웨어 제약

부품은 2026-07-27자 구매 승인 목록으로 확정됐다. 전체 목록·수량은 `PLAN.md` §센서·기자재 구성 참조. 코드에 영향을 주는 제약만 여기 적는다.

- **ATORCH BW150은 데이터 경로가 아니다.** 방전 부하 + INA226 검증용 기준기로만 쓴다. 시리얼(`0xFF 0x55` 프레임, 9600 8N1, CH340G)로 값을 읽을 수는 있으나 **주기가 1초**라 100ms 스트림에 못 섞이고, **USB 절연이 없어** 측정 회로와 GND가 묶인다. 추출한 값은 Kafka가 아니라 오프라인 검증용 CSV로만 남긴다.
- **MQ-2 AOUT은 5V까지 올라간다.** ADS1115를 3.3V로 구동하면 입력 정격을 넘으므로 분압이 필요하고, ADS1115를 5V로 구동하면 I2C 라인이 5V가 되어 라즈베리파이 GPIO가 위험하다(이 모듈엔 레벨 시프터가 없다).
- **MQ-2 히터는 상시 발열**(약 150mA@5V)이라 DS18B20·MLX90614와 떨어뜨려 배치한다. 붙여 두면 온도 측정이 오염된다.
- **BQ27441은 배터리마다 재설정이 필요하다.** Design Capacity와 화학 프로파일을 셀에 맞춰 써 넣어야 SOC가 맞는다. 18650(2550mAh)과 리튬폴리머(1000mAh)를 번갈아 물리면 그때마다 다시 써야 한다.
- **OLED(CN0219)는 SPI다.** 핀이 `GND VCC D0 D1 RES DC CS`인 7핀 버전이라 I2C가 아니다.
- **FSR 406은 분압저항이 있어야 읽힌다.** 저항성 소자라 고정저항(10kΩ 등) 없이는 ADC로 값이 안 나온다.
- 라즈베리파이 5에는 3.5mm 오디오 잭이 없다. 음성 안내용 스피커는 USB 또는 I2S DAC로 붙인다.

**미해결**
- 모드 2(보조배터리)의 `soc_pct` 출처 — `정의 필요`. Battery Babysitter는 셀 직결 보드라 완제품 보조배터리에 부착할 수 없다.
- 가스·압력·음향 센서의 동시 부착 개수와 ADS1115 채널 배분 — `정의 필요`.
- 음향 센서 모델 미확정. **미세 크랙의 음향 방출(AE)은 100kHz~1MHz 대역**이라 일반 사운드 센서(20Hz~20kHz)로는 못 잡는다. 피에조로 벤트 파열음·표면 진동을 잡는 수준이므로 `acoustic_raw`의 정의를 그에 맞춰 적었다.

## 디바이스 스피커 음성 안내

라즈베리파이에 스피커를 추가해 현장 음성 안내를 제공한다. 음성은 실시간 합성 TTS가 아니라 사전 생성된 한국어 MP3/WAV 파일을 에지에서 로컬 재생한다. 안내 대상은 보조배터리 물리 연결 감지, 웹 측정 세션 시작/종료, 이상 상태, Fail-Safe 차단, 릴레이 상태, 센서·디바이스 오류, 네트워크·서버 상태 이벤트다. 웹 설정은 전체 공통 정책으로 음성 안내 ON/OFF, 음량, 카테고리별 토글(연결/측정, 이상상태, Fail-Safe/릴레이, 센서/디바이스 오류, 네트워크/서버 상태)을 제공한다.

> 음성 안내는 운영 보조 기능이며, 릴레이/Kill-Switch 판단에는 영향을 주지 않는다.

## 배터리 자산(Battery Asset)과 이력 추적

측정 **장비**(`device_id`, 라즈베리파이)와 측정 **대상**(`battery_id`, 셀/보조배터리)을 분리한다. 보조배터리는 자동 인식이 불가하므로 사용자가 자산으로 등록해두고 재연결 시 목록에서 **수동 선택**해 이전 이력을 잇는다. 배터리에는 `target_mode`가 고정되어 재연결 시 모드 재선택이 불필요하다. 등록 시 배터리 종류(`chemistry`: 리튬이온/리튬폴리머, **필수**)와 직렬 셀 수(`series_count`, 선택)를 함께 받아 전압 임계값 해석·AI 이상탐지 추정의 기준으로 쓴다(임계값은 LSTM-AutoEncoder + Informer 정상패턴 학습으로 추정). `battery_id` 귀속은 에지가 아니라 백엔드 세션 태깅으로 부여한다.

> 웹에서 이 기능의 화면/메뉴 명칭은 **"배터리 자산관리"**다(하위 액션: 새 배터리 등록 / 저장된 배터리 선택, 별도 페이지: 배터리 상세/이력).

> 데이터 모델(`battery_asset`/`measurement_session`)·태깅 흐름·엣지 케이스 상세는 `PLAN.md` 참조.

## 요구사항 추적

상세 요구사항·기능·스펙은 `PLAN.md` 참조. Manyfast 프로젝트 ID: `7241ba62-d21a-4de4-ba45-fe572dd0f4de`
