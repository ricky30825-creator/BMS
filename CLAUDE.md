# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 소개

리튬이온 배터리의 전압·전류·온도·SOC 시계열 데이터를 Kafka 파이프라인으로 수집하고, LSTM-AutoEncoder(현재 상태 진단)와 Informer(미래 상태 예측)를 결합한 이중 모델 AI로 열폭주 전조를 조기 탐지하여 React 반응형 웹 대시보드에서 실시간 관제하는 시스템이다. 임계치 차단(사후 대응)이 아니라 정상패턴 학습 기반 이상탐지(사전 예측)가 핵심 차별점이다.

## 문서 작성 기준

- 기능정의서나 화면 흐름을 와이어프레임 HTML에서 추출할 때는 HTML에 명확히 표시된 화면·버튼·입력·탭·필터·모달·카드·상태값을 우선한다.
- `PLAN.md`와 사용자가 제공한 최신 HTML 와이어프레임이 충돌하면 HTML을 기준으로 `PLAN.md`, `docs/userflow.md`, `docs/admin_userflow.md`, `docs/feature_definition.md`, `docs/admin_feature_definition.md`를 맞춘다.
- HTML만으로 동작이 불명확한 항목은 추정하지 않고 `정의 필요`로 표시한다.

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
  "temp_contact": 36.8,
  "temp_ir_surface": 38.1,
  "temp_points": { "contact": [34.1, 36.8, 35.2], "ir": [38.1, 35.9] },
  "gas_raw": 180,
  "pressure_raw": 420,
  "acoustic_raw": 35
}
```

> `insulation_mohm`(절연저항)은 측정 소자가 확보되지 않아 **스키마에서 제거**했다(2026-07-27). 되살리려면 절연저항 측정 수단부터 정한다.

모드별 온도 필드:
- 모드 1 (외부 셀): `temp_contact` + `temp_ir_surface`
- 모드 2 (보조배터리): `temp_ir_surface`

> **모드 1의 온도는 다점 측정이며 `temp_contact`·`temp_ir_surface`는 그 최댓값이다.** 접촉 3점(DS18B20 ×3, 하단/중앙/단자쪽) + IR 2존(MLX90614 ×2, 중앙/단자쪽). 열폭주는 국부에서 시작하므로 평균을 쓰면 초기 신호가 희석된다. `temp_points`에 개별 지점값을 함께 실어(길이 고정 3·2, 위치 순서, 결측은 `null`) AI가 지점 간 온도차를 특징으로 쓸 수 있게 한다. **불변식**: `temp_contact == max(non-null contact)`, `temp_ir_surface == max(non-null ir)`. 상세는 `docs/hardware/mode1_backend_spec.md` §6-5·§7-4·§9.

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

| 등급 | 이상점수 범위 | UI 표시값 |
|---|---|---|
| 정상 | 0.0 – 0.3 | 0 – 29 |
| 주의 | 0.3 – 0.6 | 30 – 59 |
| 경고 | 0.6 – 0.8 | 60 – 79 |
| 위험 | 0.8 – 1.0 | 80 – 100 |

> 등급은 임계값으로 **계산**한다. 어딘가에 미리 적어둔 등급 라벨을 그대로 쓰지 않는다. v3의 `packBase`가 등급을 데이터에 하드코딩해 PACK-003(33점)이 `정상`으로 표시되는 버그가 여기서 나왔다. 원본 데이터를 그대로 보여주는 곳에서는 환산하지 않은 0.0–1.0을 쓴다.

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

## 회로도 (모드 1만 존재)

정본은 `hardware/mode1/`(KiCad 프로젝트)이고, 조립은 `docs/hardware/mode1_beginner_guide.md`, 에지 데이터 수집은 `docs/hardware/mode1_backend_spec.md`가 계약서다. 모드 2 회로는 아직 없다.

- **회로도는 생성물이다.** KiCad에서 손으로 고치지 말고 `tools/gen_mode1_sch.py`를 고친 뒤 다시 돌린다. 검증은 `kicad-cli sch erc`(위반 0건) + `sch export netlist`로 네트 연결 확인. `kicad-cli`는 `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`에 있다(PATH에 없음).
- **회로도 텍스트에 한글을 넣으려면 `(font (face "Apple SD Gothic Neo") …)`를 명시해야 한다.** 안 붙이면 `kicad-cli` 내보내기에서 한글이 통째로 사라진다. 제목란(`title_block`)은 폰트 지정이 안 먹으므로 ASCII만 쓴다.
- **릴레이는 active-LOW**(`0`=도통, `1`=차단)이고 모든 배터리 경로가 NO 접점을 지나 정전·부팅 중·크래시 시 자동 차단된다. 모드 1 매핑: CH1 충전(GPIO5), CH2 방전(GPIO6), CH3 마스터(GPIO13), CH4 예비(GPIO19). CH1·CH2 동시 도통 금지, 전환 시 50ms 이상 대기.
- **CH3(마스터)을 열면 BQ27441이 꺼져 I2C `0x55`가 버스에서 사라진다.** 정상 동작이므로 릴레이 상태를 조건으로 걸지 않으면 센서 오류 알림이 폭주한다. INA226은 Pi 3.3V로 동작해 셀 전압 감시는 계속된다.
- **셀 −(`CELL_N`)를 시스템 GND에 직결하면 안 된다.** BQ27441의 20mΩ 센스 저항이 단락돼 SOC가 안 나온다. `CELL_N`은 Babysitter `BAT−` 하나에만 간다.
- **100ms로 실제 갱신되는 건 전기량(INA226 35.2ms)과 압력(ADS1115 7.8ms)뿐이다.** DS18B20 750ms(12비트, `therm_bulk_read` 미지원 커널이면 2250ms) / BQ27441 ~1s / MLX90614는 공장 기본값이 **864.9ms**지만 EEPROM 재설정으로 95.2ms가 되어 매 프레임 실측이 된다. 즉 재설정 후 남는 느린 필드는 `temp_contact`와 `soc_pct`뿐이다. `dT_dt`·`d2T_dt2` 특징이 계단 파형이 되므로 `age_ms` 신선도 필드 도입 여부가 미결이다(백엔드 스펙 §13).
- **MLX90614 EEPROM 쓰기에는 PEC 바이트가 필수다.** write word 프레임은 `SA+W | 커맨드 | LSB | MSB | PEC`이고 PEC는 `SA<<1`부터의 **CRC-8(다항식 0x07, 초기값 0)**이다(데이터시트 Figure 7). 빠지거나 틀리면 **에러 없이 조용히 무시**되어 "지우기는 됐는데 쓰기가 안 먹는" 증상이 난다. `smbus2.write_word_data()`는 PEC를 안 붙이므로 `bus.pec = 1`을 켜거나 `i2c_msg.write()`로 직접 프레임을 만든다. 주소 변경(`0x2E`)과 필터 재설정(`0x25`) 양쪽에 적용된다.
- **INA226 `VBUS`는 퓨즈 앞(`CELL_P`)에서 딴다.** 퓨즈 뒤에서 따면 폴리퓨즈 저항(3A급 20~50mΩ)만큼 전압이 깎이고, 하필 과전류로 퓨즈 저항이 치솟는 순간에 가장 크게 왜곡된다. `CELL_P_F`에는 `IN−`만 붙는다.
- **MLX90614는 EEPROM `0x25`를 재설정해야 쓸 만하다.** 출고 상태(IIR 50% + FIR 1024)는 갱신 864.9ms에 **스파이크를 50%로 깎는다** — 열폭주 초기의 급격한 온도 상승이 바로 그 스파이크다. `IIR=100`(감쇠 없음) + `FIR=111`로 바꾸면 **95.2ms**가 된다. 정착시간 = `9.719 + IIRSetting×(FIRSetting+5.26) + IIRSetting×(FIRSetting+12.542)` ms. **비트 3은 절대 건드리지 마라 — 공장 캘리브레이션이 취소된다.** 반드시 read-modify-write.
- **MLX90614 1개로는 공간 피크를 못 낸다.** 서모파일 소자 1개짜리라 데이터시트대로 "FOV 안 모든 물체의 평균"만 나온다. 그래서 **2개를 다른 지점에 겨눠 2픽셀로 만든다** — `0x5A`(셀 중앙) / `0x5B`(단자쪽). 피크가 두 겹이다: 시간축(100ms 창의 최댓값) 위에 공간축(두 존 중 큰 쪽)을 얹는다.
- **INA226의 전류 측정 상한은 션트가 아니라 16비트 Current 레지스터가 정한다.** `Current_LSB=0.0001A`면 션트값과 무관하게 **3.28A**에서 넘치고, 넘치면 부호까지 뒤집혀 조용히 오염된다. `Mask/Enable`(0x06) **bit 2 = OVF**를 매 프레임 확인할 것.
- **BQ27441 `Flags`(0x06)의 비트 번호를 TRM에서 직접 확인해 쓸 것.** TRM이 High/Low 바이트를 각각 `bit7..bit0`으로 적어서 절대 비트로 옮길 때 틀리기 쉽다. **ITPOR = bit 5(`0x0020`)**, FC = bit 9, OT = bit 15이며 **bit 8은 `CHG`(충전 허용)**다. ITPOR을 bit 8로 잘못 잡으면 충전할 때마다 오탐하고 진짜 게이지 리셋은 못 잡는다. `AveragePower`는 `0x18`이지 `0x16`이 아니다.
- **MLX90614·DS18B20 부착 거리와 위치가 값의 정확도를 좌우한다.** IR은 FOV 35°라 스팟 지름 = `0.63 × 거리` — **2cm 이내**여야 18650(지름 1.8cm) 안에 들어온다. 5cm면 배경이 절반 넘게 섞여 실제보다 낮게 읽힌다. 접촉 3점은 하단/중앙/**단자쪽**에 붙이되, 양극 단자 부근이 내부저항·접촉저항 때문에 가장 먼저 뜨거워지므로 반드시 한 점을 거기 둔다.
- **DS18B20 3개는 같은 GPIO4 버스에 병렬로 문다.** 1-Wire는 고유 64비트 ROM 코드를 쓰므로 주소 설정이 필요 없고, 4.7kΩ 풀업도 버스 전체에 하나면 된다. **`Skip ROM + Convert T`로 동시 변환하면 개수가 늘어도 750ms 그대로**다(순차로 하면 2250ms). 커널의 `therm_bulk_read` 지원 여부를 기동 시 확인할 것.
- **ROM 코드는 물리 위치를 알려주지 않는다.** 어느 센서가 셀의 어디에 붙었는지는 조립 시 손으로 하나씩 잡아 확인해 설정 파일에 고정한다. 하드코딩 금지.
- **모드 1 회로에 MQ-2 가스·음향 센서는 없다** → `gas_raw`, `acoustic_raw`는 `null`. 위 센서 표(모드 1·2 전부 적용)와 어긋난 상태이며 어느 쪽이 정본인지 미결이다.

## 디바이스 스피커 음성 안내

라즈베리파이에 스피커를 추가해 현장 음성 안내를 제공한다. 음성은 실시간 합성 TTS가 아니라 사전 생성된 한국어 MP3/WAV 파일을 에지에서 로컬 재생한다. 안내 대상은 보조배터리 물리 연결 감지, 웹 측정 세션 시작/종료, 이상 상태, Fail-Safe 차단, 릴레이 상태, 센서·디바이스 오류, 네트워크·서버 상태 이벤트다. 웹 설정은 전체 공통 정책으로 음성 안내 ON/OFF, 음량, 카테고리별 토글(연결/측정, 이상상태, Fail-Safe/릴레이, 센서/디바이스 오류, 네트워크/서버 상태)을 제공한다.

> 음성 안내는 운영 보조 기능이며, 릴레이/Kill-Switch 판단에는 영향을 주지 않는다.

## 배터리 자산(Battery Asset)과 이력 추적

측정 **장비**(`device_id`, 라즈베리파이)와 측정 **대상**(`battery_id`, 셀/보조배터리)을 분리한다. 보조배터리는 자동 인식이 불가하므로 사용자가 자산으로 등록해두고 재연결 시 목록에서 **수동 선택**해 이전 이력을 잇는다. 배터리에는 `target_mode`가 고정되어 재연결 시 모드 재선택이 불필요하다. 등록 시 배터리 종류(`chemistry`: 리튬이온/리튬폴리머, **필수**)와 직렬 셀 수(`series_count`, 선택)를 함께 받아 전압 임계값 해석·AI 이상탐지 추정의 기준으로 쓴다(임계값은 LSTM-AutoEncoder + Informer 정상패턴 학습으로 추정). `battery_id` 귀속은 에지가 아니라 백엔드 세션 태깅으로 부여한다.

> 웹에서 이 기능의 화면/메뉴 명칭은 **"배터리 자산관리"**다(하위 액션: 새 배터리 등록 / 저장된 배터리 선택, 별도 페이지: 배터리 상세/이력).

> 데이터 모델(`battery_asset`/`measurement_session`)·태깅 흐름·엣지 케이스 상세는 `PLAN.md` 참조.

## 프로토타입 번들 다루기

`설계 산출물/셀가드 프로토타입_v3.html`은 23MB 단일 HTML 번들이다.

- 실제 마크업은 **210번 줄의 JSON 문자열 하나**(약 30만 자 / 2,372줄)에 들어 있다. 반드시 `tools/bundle_io.py`의 `unpack`/`pack`/`backup`으로만 읽고 쓴다.
- **202번 줄은 22MB base64 자산 매니페스트다. 절대 건드리지 않는다.**
- `설계 산출물/`은 `.gitignore` 대상이라 되돌리기가 불가능하다. 편집 전 `backup`을 부른다.
- 마크업은 `{{ 바인딩 }}` 자리표시자를 쓰므로 한국어 문자열로 grep하면 안 나온다. **바인딩 이름으로 찾는다.** 어떤 화면이 무엇을 보여주는지 확인할 때 이 방법이 유일하게 신뢰할 수 있다.
- 브라우저로 확인할 때는 `file://`이 확장에 차단되므로 로컬 HTTP 서버로 띄운다 — `설계 산출물/`에서 `python3 -m http.server 8807 --bind 127.0.0.1`.

## 디자인 무관 제품 계약서

기능·유저플로우의 디자인 무관 정본은 `docs/product_contract.md`다. **새 디자인 작업은 이 문서를 입력으로 삼는다.**

- 기능 영역 19개(F5는 결번 — `devices`는 도달 불가 고아 라우트), 과업 16개(T0~T15), 게이트·불변 표시로 안전 규칙을 고정한다.
- 형태 어휘(모달·카드·버튼·사이드바 등)를 쓰지 않는다. 화면 개수·경계, 정보를 담는 그릇, 목록 탐색 방식, 이동 수단 구조는 전부 자유다.
- `tools/contract_lint.py`가 어휘·영역·REQ 인용·게이트 표시를 기계 검증한다. 계약서를 고치면 반드시 다시 돌린다.
- 범위 밖 REQ 5건(030·031·069·071·135)은 본문에서 인용하면 위반이다. 부록 B에서만 언급한다.
- v3와 계약서가 어긋나면 v3가 틀린 것이다. v3 자체의 수정 목록은 `docs/backend_contract.md` §12에 25건으로 정리돼 있다.

## 새 디자인 (계약서 기반)

계약서를 입력으로 만든 디자인의 정본은 `design-system/cellguard/MASTER.md`, 목업은 `web/cellguard_mockup_v4.html`(자립형 단일 HTML)이다.

- **제1원칙 — 녹·황·주황·적은 등급 표시 전용이다.** 배경·테두리·기본 버튼 등 크롬에 쓰면 상태 판독이 무너진다. 주요 동작은 파랑(`--primary`), 파괴적 동작은 등급 배지와 같은 화면에서 채움 대신 외곽선.
- 등급은 언제나 **색 + 도형 + 라벨 + 숫자** 네 겹으로 표시한다. `주의`(#A16207)와 `경고`(#C2410C)가 인접색이라 색만으로는 구분되지 않는다. 목업의 `badge()` 함수 하나가 이 네 겹을 만든다 — 등급을 직접 그리지 말고 이 함수를 쓴다.
- 모든 측정값·시각·ID에 `class="num"`(등폭 + `tabular-nums`)을 붙인다. 실시간 갱신 중 폭이 흔들리지 않게 하는 장치다.
- 목업 확인은 로컬 HTTP 서버로 — `web/`에서 `python3 -m http.server 8811 --bind 127.0.0.1`.
- `search.py --design-system`의 자동 매칭은 이 제품에서 신뢰할 수 없다. 배경·CTA에 상태색을, 타이포에 Cinzel(럭셔리용)을 배정했다. 개별 도메인 조회(`--domain style/color/product`)로 `Data-Dense Dashboard`·`Real-Time Monitoring`·`Status Page`를 직접 골라야 맞는다. `--persist --force`는 손으로 고친 MASTER.md를 덮어쓴다.

## 요구사항 추적

상세 요구사항·기능·스펙은 `PLAN.md` 참조. Manyfast 프로젝트 ID: `7241ba62-d21a-4de4-ba45-fe572dd0f4de`

## API 계약

프론트↔백엔드 인터페이스(REST·WebSocket)의 정본은 `docs/backend_contract.md`다. 엔드포인트·페이로드·에러코드·enum을 여기서 확정하며, 아래 규약은 반드시 지킨다.

- **이상점수는 API에서 0.0–1.0 실수로 주고받는다.** v3 프로토타입 UI의 0–100 정수는 표시용이며, 프론트가 `round(score*100)`으로 변환한다.
- **등급 임계치는 시스템 고정값(0.3/0.6/0.8)이다.** 임계치 설정 기능은 제거되었으니 `/api/settings/thresholds` 같은 엔드포인트를 만들지 않는다. 그래도 응답에 `grade`를 서버가 계산해 동봉한다 — 판정 로직을 한 곳에만 두기 위해서다.
- **v3의 3등급 판정(`≥70 위험 / ≥40 주의`)과 게이지 범례(`정상 0–39/주의 40–69/위험 70+`)는 버그다.** 4등급(0.3/0.6/0.8)이 유일한 정본이니 v3를 보고 따라 구현하지 말 것. v3 안에서도 관리자 운영 로그는 `위험 임계 80`을 쓴다.
- **배터리 미연결 게이트**: 연결된 배터리가 없는 일반 사용자는 `배터리 자산관리`를 제외한 8개 메뉴가 전부 잠긴다(v3 실측). 서버도 `409 NO_ACTIVE_SESSION`으로 재검증한다.
- `devices`(디바이스 상태) 라우트는 v3에 마크업만 있고 전환 코드가 없는 고아 라우트다. `REQ-WEB-030/031`은 구현 대상이 아니다.
- **셀 단위 데이터는 전부 범위 밖이다.** 히트맵도, 이벤트·알림의 `cellIndex`도 만들지 않는다. 프론트에 노출하는 온도는 `temp_contact`·`temp_ir_surface` 두 값뿐이며, 이벤트명에서 `· 셀 N`을 뺀다. (에지가 함께 싣는 `temp_points`는 **셀 1개 표면의 여러 지점**이라 여기서 말하는 '셀 단위'가 아니다 — AI 특징용이고 프론트에 노출하지 않는다.)
- **기능정의서(`docs/feature_definition.md`)는 v3 기준(커밋 `9bb6d8e`)이며 점수 스케일·4등급·게이지 범례 버그를 이미 담고 있다.** 다만 일부 기능의 **화면 위치**가 v3와 어긋난다: REQ-WEB-026(최근 이벤트)은 대시보드가 아니라 이상 탐지 화면, REQ-WEB-051(정렬)은 이벤트가 아니라 배터리 관리 화면, REQ-WEB-054/055(CSV·PDF)는 이벤트가 아니라 추세 화면, REQ-WEB-037의 제조사/모델 입력은 등록 폼에 없음. 충돌 시 v3 HTML이 우선한다.

- **서버는 사용자에게 보일 문구를 만들지 않는다.** 한/영 토글이 있으므로 code+params만 내려주고 문장은 프론트 사전이 조립한다. 예외는 사용자가 입력한 자유 텍스트(공지 본문, 메모, 제어 사유)뿐이다.
- **계정 제재와 안전 감시는 분리한다.** 계정을 정지해도 측정 세션·데이터 적재·Fail-Safe는 계속 돈다(웹 로그인만 차단). 배터리 `BLOCKED`만 세션을 끊고, 그것도 릴레이는 건드리지 않는다.
- **릴레이 자동 복구는 없다.** 한 번 차단되면 재인증·사유 입력으로 수동 복구만 가능하다.
- 사용자당 진단기는 **1대 고정**이다. `deviceId`를 API로 받지 않고 서버가 자동 선택한다.

미결정 항목은 `docs/backend_contract.md` §9에 모아 두었다. 33건 중 30건이 닫혔고, 열린 것은 지표 임계값(Q27)·문구 코드 목록(Q34)·세션 타임아웃 분수(Q35)뿐이다. 새로 결정되면 표에서 확정으로 옮기고 본문에 반영한다.
