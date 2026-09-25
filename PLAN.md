# AI 배터리 열폭주 조기감지 관제 시스템 — PLAN.md

> 프로젝트 ID: 7241ba62-d21a-4de4-ba45-fe572dd0f4de  
> 최종 업데이트: 2026-08-06

---

## 1. 프로젝트 개요

### 목표
리튬이온 배터리(셀/보조배터리)의 **전압·전류·온도·SOC** 실측 시계열 데이터를 수집·저장·분석하여 열폭주 전조 및 이상징후를 조기에 탐지하고, 웹 대시보드에서 실시간 상태/경고를 통합 관제하는 시스템 구축.

### 배경
- 항공기 기내 보조배터리 발화 및 전기차 화재 등 리튬이온 배터리 안전 이슈 증가
- 기존 보호회로(임계치 기반 차단)는 사후 대응 위주 → 열폭주 전조 사전 예측 불가
- 센서 데이터가 분산되어 실시간 통합 분석·시각화·알림 연결 불가

### 핵심 차별성
| 기존 방식 | 본 시스템 |
|---|---|
| 임계치 초과 시 차단 (사후) | 정상패턴 학습 기반 AI로 전조 조기 탐지 (사전) |
| 데이터 유실 가능 | Kafka 파이프라인으로 유실 최소화 |
| 소프트웨어 탐지만 | 릴레이 인터락 + AI 탐지 결합 (Fail-Safe) |
| 단일 모드 | 2가지 측정 모드 확장 구조 |

### 타겟 사용자
1. **연구/개발자** — 배터리 실험, 진단 알고리즘 개발
2. **현장 운영자/관리자** — 장비 상태 모니터링 및 알림 수신
3. **프로젝트 팀 내부 개발자** — 임베디드·데이터·AI·웹 담당

### 협업 및 문서 운영 원칙

- Claude를 메인 작업자로, Codex를 보조 작업자로 사용한다.
- Codex는 Claude가 구성한 현재 폴더 구조와 문서 체계를 우선 유지하며, 불필요한 구조 변경을 하지 않는다.
- 코드, 설정, 요구사항 변경 시 관련 문서를 함께 갱신한다. 프로젝트 계획과 추적은 이 `PLAN.md`를 기준으로 한다.
- Claude 전용 지침은 `CLAUDE.md`, Codex 전용 지침은 `AGENTS.md`에 분리해 관리한다.
- 공유 원격 저장소는 `https://github.com/ricky30825-creator/BMS`로 관리한다.
- GitHub 공유 레포에는 팀 개발에 필요한 코드, 설정, Markdown 기준 문서, 웹/다이어그램 자산만 추적한다. 발표자료, 설계 산출물 원본, 클로드 보고, 백업 파일, 샘플 PDF/DOCX/PPTX는 로컬 보관 대상으로 보고 레포에서 제외한다.

---

## 2. 기술 아키텍처

```
[에지 계층]                  [호스트 PC 1대 — 전부 로컬]
Raspberry Pi 5              Apache Kafka → Consumer → PostgreSQL + TimescaleDB
INA226·BQ27441              (토픽 3개)                      (시계열 하이퍼테이블)
DS18B20·MLX90614              battery-raw-metrics                    │
ADS1115          LAN          battery-anomaly-alerts ◀─ alerts 발행 ─┤
└가스·압력·음향  ──────────▶   battery-events                        │
   │              PLAINTEXT                          [추론 프로세스] │
   │                                              LSTM-AE + Informer │
   ↓ 릴레이/Kill-Switch                            이중 모델(Score    │
   + 스피커 음성 안내                               Fusion), 체크포인트 │
   (에지측 물리 차단·현장 안내)                       로드·raw 구독 ────┘
                             백엔드(REST/WebSocket)
                               └─▶ React 대시보드 (localhost) / 카카오톡 알림
```

> **전 구성이 호스트 PC 1대에서 로컬로 돈다(2026-08-25 확정). AWS EC2는 쓰지 않는다.** 에지만 같은 LAN의 별도 장비이며 PLAINTEXT로 브로커에 직접 붙는다.
>
> **Google Colab은 학습 전용이고 실시간 경로에 없다.** 로컬 Kafka는 NAT 뒤라 Colab이 인바운드로 접속할 수 없다. Colab에서 학습한 체크포인트를 내려받아 호스트 PC의 추론 프로세스가 로드하고, 그 프로세스가 `battery-raw-metrics`를 구독해 추론한 뒤 `battery-anomaly-alerts`를 발행한다. **이 문서에 남아 있는 "Colab ↔ Kafka 연동" 서술은 폐기된 설계다.**

### 기술 스택 요약

| 계층 | 기술 | 비고 |
|---|---|---|
| 에지 | Raspberry Pi | I2C/1-Wire 센서 수집 |
| 센서 | INA226, BQ27441(Battery Babysitter 탑재), DS18B20, MLX90614, ADS1115 + 가스(MQ-2)·압력(FSR 406)·음향 | 전압·전류·온도·SOC + 오프가스·스웰링·음향 |
| 호스트/인프라 | 로컬 PC 1대 | Kafka·DB·추론·백엔드·웹을 모두 호스팅. 클라우드 없음 |
| 스트리밍 | Apache Kafka | 토픽 3개 (raw/alerts/events) — 호스트 PC에서 로컬 운영, LAN 한정 PLAINTEXT. `advertised.listeners`는 호스트 LAN IP |
| DB | PostgreSQL + TimescaleDB | 시계열 하이퍼테이블 (로컬) |
| AI | LSTM-AutoEncoder + Informer (이중 모델) | AE 재구성 오차 + Informer 예측 오차를 Score Fusion(가중합)으로 결합한 최종 이상점수 — **학습은 Google Colab, 실시간 추론은 호스트 PC의 로컬 프로세스** |
| 백엔드 | Node.js + TypeScript + Express + Better Auth | REST API, WebSocket, 세션 기반 인증/RBAC |
| 프론트엔드 | React | 반응형 웹 대시보드(데스크톱/태블릿/모바일) |
| 알림 | Kakao Talk API | SNS 알림 |
| 하드웨어 | 릴레이 모듈, 스피커 | Kill-Switch 물리 차단, 에지 로컬 음성 안내 |

### Kafka 토픽 설계

| 토픽 | 용도 |
|---|---|
| `battery-raw-metrics` | 에지 센서 Raw 데이터 |
| `battery-anomaly-alerts` | AI 추론 결과 (최종 이상점수·AE/Informer 개별 점수, 파생 온도) |
| `battery-events` | 에지·백엔드 공유 이벤트 토픽. 현재 wire contract가 고정하는 백엔드 outbound command/event 4종 외의 에지 센서 오류·`DIAG_*` payload는 해당 담당 범위에서 정의한다 |

### 측정 모드

| 모드 | 설명 | 온도 수집 | 가스 | 압력·음향 |
|---|---|---|---|---|
| 모드 1 | 외부 셀 (리튬이온 18650 / 리튬폴리머) | 접촉식(temp_contact) + IR 표면(temp_ir_surface) + 실온(temp_ambient, MLX90614 #2) | ✕ | 압력 ○ · 음향 ✕ |
| 모드 2 | 외부 보조배터리 | IR 표면(temp_ir_surface) + 실온(temp_ambient, DS18B20 1개) | ○ | 압력·음향 ✕ |

> AI 서버 전처리: 칼만 필터(temp_ir_filtered), 내부 셀 추정(temp_cell_estimated)
> 가스 센서는 모드 2만, 압력 센서는 모드 1만 적용한다. 음향 센서는 도입하지 않고 스키마 필드만 유지한다.

> **2모드로 확정(2026-07-27)**: 기존 `모드 1 — 라즈베리파이 내장 배터리`는 해당 배터리를 확보하지 않아 삭제했다. 구 모드 2·3이 각각 신 모드 1·2로 내려왔으므로, 이 문서 이전 판본의 `모드 3`은 전부 신 `모드 2`를 가리킨다.

> **한 번에 배터리 1개만 측정한다.** BQ27441(0x55)은 I2C 주소가 하드웨어 고정이라 같은 버스에 2개를 물릴 수 없고, SOC 없이는 측정 세션이 성립하지 않는다. 다중 배터리 동시 측정은 범위 밖이다(멀티플렉서 TCA9548A 미도입).
>
> **단 MLX90614는 주소가 고정이 아니다.** 데이터시트상 SMBus 주소는 EEPROM `0x0E`에 있고 고객이 쓸 수 있다(*"SMBus address (LSB only) | 0x0E | Write access: Yes"*, Figure 36 "Use of multiple MLX90614 devices in SMBus network"). 한 버스에 최대 127개까지 붙는다. 이건 다중 **배터리**가 아니라 **한 셀의 여러 지점**을 동시에 재는 데 쓴다 — MLX90614는 소자 1개짜리라 FOV 안 평균만 내므로, 여러 개를 다른 지점에 겨눠야 공간 피크가 나온다.

### 센서·기자재 구성 (확정)

> 출처: `사용 기자재 정리`(2026-06-24 확정). 에지는 Raw 측정값만 전송하는 철학은 유지하며, 아날로그 센서는 ADS1115를 거쳐 I2C로 수집한다.

**측정 센서/모듈**

| 부품 (구매 확정) | 수량 | 역할 | Raw 필드 | 연결 | 적용 모드 |
|---|---|---|---|---|---|
| INA226 [VLT-VCM029] | 3 | 전압·전류·전력 측정 | `voltage_v`, `current_a`, `power_w` | I2C 0x40 | 1·2 |
| BQ27441 (SparkFun Battery Babysitter [PRT-13777]) | 2 | Fuel Gauge (SOC) + 충전기(BQ24075) | `soc_pct` | I2C 0x55 | **1** |
| DS18B20 방수형 [SEN050007] | 3 | 모드 1: 접촉식 표면 온도 3점. 모드 2: 1개가 실온 | `temp_contact` / 모드 2 `temp_ambient` | 1-Wire | 1·2 |
| MLX90614 [SEN0206] | 2 | 비접촉 IR 표면 온도 (구 'IR 카메라' 대체). **MLX90614-DCC, FOV 35°**. 모드 1에서 #2(`0x5B`)는 실온(2026-09-25) | `temp_ir_surface` / 모드 1 #2 `temp_ambient` | I2C 0x5A (EEPROM `0x0E`로 변경 가능) | 1·2 |
| ADS1115 [VLT-AD004] | 1 | 16비트 4ch ADC — 아날로그 센서 → I2C 브리지 | — | I2C 0x48 | 1·2 |
| 가스 센서 (MQ-2) [SZH-SSBH-026] | 3 | 오프가스(가연성가스·연기·H₂ 등) 누출 감지 → 열폭주 조기경보 | `gas_raw` | ADS1115 `A0` (분압 경유) | **2만** |
| 압력 센서 (FSR 406) [30-73258] | 3 | 스웰링(부풀음) 압력/스트레인 변형률 | `pressure_raw` | ADS1115 `A0` | **1만** |
| ~~음향 센서~~ (**도입 안 함**) | — | — | `acoustic_raw` = `null` 고정 | — | — |

- **가스·압력은 사후 대응(임계 탐지 → 즉시 릴레이 차단) 안전계층**이며 AI 예측 입력 특징이 아니다. 각 센서가 임계값을 초과하면 AI 판정과 무관하게 즉시 릴레이를 차단한다.
- **✅ 모드별 아날로그 센서 배분 확정 (2026-07-28)** — 모드마다 **1개씩만** 붙으므로 **ADS1115 1개(A0만 사용)로 충분하다. 추가 구매 불필요.**
  - **모드 1 = 압력 단독.** 가스를 안 다는 이유는 **MQ-2 히터가 상시 150mA@5V로 발열**해 같은 셀에 붙은 온도 센서 4개(DS18B20 ×3 + MLX90614 #1)와 실온 센서(MLX90614 #2)를 오염시키기 때문이다. 모드 1의 핵심은 다점 온도라 온도를 택했다. **모드 1의 사후 대응 계층은 압력 하나뿐**이므로 차단 로직에서 가스·음향이 있다고 가정하면 안 된다.
  - **모드 2 = 가스 단독.** 보조배터리는 외장 케이스에 가려 압력 센서를 못 붙인다.
  - **음향은 도입하지 않는다.** 진짜 조기신호인 미세 크랙의 음향방출(AE)은 **100kHz~1MHz**라 ADS1115(860SPS)로 원리적으로 못 잡고, 피에조로 잡히는 벤트 파열음은 가스·압력·온도가 이미 먼저 울린다. `acoustic_raw` **필드는 스키마에 남겨** 나중에 전용 AE 센서를 붙일 여지만 둔다.
- **압력 임계는 baseline 대비 상대 상승률이다.** FSR은 예압에 따라 baseline이 매번 달라져 절대 카운트가 무의미하다. baseline은 **세션마다** 시작 10초 중앙값으로 새로 잡는다. 구체 상승률 임계는 실측 후 확정(`mode1_backend_spec.md` §13 H8).
- **아날로그→I2C**: MQ 계열·FSR 406은 아날로그 출력이라 ADS1115(16비트 ADC)를 거쳐 수집한다. **MQ-2 AOUT은 5V까지 올라가므로 모드 2 회로에는 분압저항이 필수다.**
- **동시 측정은 배터리 1개**다 — BQ27441(0x55) 주소가 하드웨어 고정이기 때문이다. 표의 주소는 **출고 기본값**이며, MLX90614(0x5A)만 EEPROM `0x0E`로 바꿀 수 있다.
- **모드 1 회로에서 온도는 다점 측정이다(2026-07-28).** 여분으로 잡아 뒀던 DS18B20 3개와 MLX90614 2개를 **예비품이 아니라 전부 투입**한다. 열폭주는 국부에서 시작하는데 MLX90614는 소자 1개짜리라 시야각 안의 평균만 내므로, 센서 1개로는 한 귀퉁이의 과열이 희석돼 사라진다.
  - DS18B20 ×3 → 셀 하단·중앙·**단자쪽**. 같은 1-Wire 버스에 병렬(고유 ROM 코드라 주소 설정 불필요), 동시 변환으로 750ms 유지.
  - MLX90614 #1 → 셀 중앙(`0x5A`). 셀에서 2cm 이내 부착(FOV 35°, 스팟 지름 = 0.63 × 거리).
  - MLX90614 #2(`0x5B`) → **실온**(2026-09-25 변경, 예전에는 셀 단자쪽). 셀·BW150·Pi에서 10cm 이상 떨어뜨리고 Ta(센서 자체 온도)를 `temp_ambient`로 싣는다. 단자쪽 국부 과열은 DS18B20 단자쪽 점이 맡는다.
  - `temp_contact`·`temp_ir_surface`는 각 그룹의 **최댓값**이며, 개별 지점값은 `temp_points`로 함께 발행한다. 실온은 `temp_points`에 넣지 않는다.
  - **발열값 = 표면온도 − 실온**이 온도 판단의 기준이다. 실온이 움직이면 표면온도만으로는 발열을 읽을 수 없다(실측 중 실온 2.25°C 드리프트로 「발열 멈춤」 오독 사례, 2026-09-24).
  - **예비품이 남지 않는다.** 고장 시 교체품이 없다.

**측정 대상 배터리**: KC인증 18650 리튬이온 3.7V 2550mAh [ZM18650-2600-KC01] ×3, KC인증 리튬폴리머 3.7V 1000mAh [TW102050] ×2.

**보조·실험 장비(BOM)**: 4채널 5V 릴레이 모듈(SZH-RLBG-012) ×1, 전자부하 테스터(ATORCH BW150 WiFi Standard) ×1, USB-C 충방전모듈(SZH-MIN002) ×2, PD USB-C 트리거(ZY12PDN) ×3, **3.5" TFT SPI 480×320 V1.0(ILI9488) ×1** — 2026-08-05에 0.96" OLED SPI(CN0219)를 대체, 실리콘 절연 배선 0.75SQ 적/흑 각 1M, 점퍼 F/F 40P ×5.

**미확보 — 조립 전 확보 필요**: 음향 센서, 스피커(라즈베리파이 5는 3.5mm 잭이 없어 USB 또는 I2S DAC), FSR 분압용 고정저항(10kΩ 등), **18650 홀더 ×3 — 반드시 보호회로 셀용(전체 68~70mm 수용). 65mm용은 안 들어간다**(셀 직접 납땜은 열손상 위험), JST 2.0 피그테일(리튬폴리머 셀 리드 ↔ 회로 — **필요 여부 미정**, 셀 선 끝이 플러그인지 맨 선인지 사진 확인 후 결정. 규격·방향은 `docs/hardware/mode1_beginner_guide.md` §1-2), 캡톤 테이프·서멀 패드(접촉 온도 센서 고정·열전도), **FSR용 실리콘 고무 패드 2~3mm(곡면 선접촉 방지)**, 외장 케이스, C타입 어댑터(5V 3A+).

**하드웨어 제약 (2026-07-27 확정)**
- **ATORCH BW150은 데이터 경로가 아니다.** 방전 부하 + INA226 검증용 기준기로만 쓴다. 시리얼(`0xFF 0x55` 프레임, 9600 8N1, CH340G)로 전압·전류·전력·Ah·Wh·온도를 읽을 수 있고 CC 설정·부하 ON/OFF 제어도 되지만, **주기가 1초**라 100ms 스트림에 못 섞이고 **USB 절연이 없어** 측정 회로와 GND가 묶인다. 추출값은 Kafka가 아니라 오프라인 검증용 CSV로만 남긴다. 사양은 입력 <36V·150W, 동봉 케이블 10A, 별도 전원 필요. BW150 자체가 검증된 오픈소스 구현체는 없고 같은 패밀리인 DL24P가 검증 기준이므로 **실물 확인이 필요하다**.
- **MQ-2 AOUT은 5V까지 올라간다.** ADS1115를 3.3V로 구동하면 입력 정격 초과라 분압이 필요하고, 5V로 구동하면 I2C 라인이 5V가 되어 라즈베리파이 GPIO가 위험하다(모듈에 레벨 시프터 없음).
- **MQ-2 히터는 상시 발열**(약 150mA@5V)이라 DS18B20·MLX90614와 이격 배치한다. 최초 번인도 24~48시간 필요하다.
- **BQ27441은 배터리마다 재설정이 필요하다.** Design Capacity·화학 프로파일을 셀에 맞춰 기록해야 SOC가 맞으며, 18650(2550mAh)과 리튬폴리머(1000mAh)를 번갈아 물리면 그때마다 다시 써야 한다.
- **현장 표시 화면은 3.5" TFT SPI 480×320 V1.0(ILI9488) 14핀**(`VCC GND CS RESET DC/RS SDI(MOSI) SCK LED SDO(MISO) T_CLK T_CS T_DIN T_DO T_IRQ`)이다. **터치 미사용이라 `T_*` 5핀과 `SDO`는 미결선**이고, `LED`(백라이트)는 3.3V 직결(상시 점등). GPIO 배선은 구 OLED와 1:1로 같다. **ILI9488은 SPI에서 RGB565가 안 되고 픽셀당 3바이트(RGB666)**라 전체 화면 갱신이 460KB다 — 100ms 계측 루프에 올리지 말고 부분 갱신·별도 스레드로 처리한다.
- **FSR 406은 분압저항 없이는 읽히지 않는다.**
- **모드 1 회로에 직렬 퓨즈가 없다(2026-07-28).** 과전류 보호는 셀에 붙은 보호회로(PCM)에만 의존한다. 셀에 보호회로가 실제로 있는지는 **조립 전 실물 확인이 필수**이며 아직 미확인이다(아래 `정의 필요`).

**✅ 2026-07-28에 닫힌 항목**: 모드 2 `soc_pct` 출처(INA226 적산 상대 SOC), 가스·압력·음향의 ADS1115 채널 배분(모드마다 A0 1개, 1개로 충분), 음향 센서 모델(도입 안 함·필드만 유지), 열화상 배열 도입 여부(도입 안 함). 백엔드 스펙 §13의 결정 9건도 전부 확정됐다.

**✅ 실물 확인으로 닫힘 (2026-07-28)**
- **구매한 셀에 보호회로(PCM)가 있다.** 모드 1 회로에 퓨즈가 없는 상태의 유일한 과전류 보호이므로, 퓨즈를 뺀 결정의 전제가 성립한다. **파생 제약**: ① 전체 68~70mm라 **65mm용 홀더 불가 — 보호회로 셀용으로 구매** ② 센서 축방향 기준은 전체 길이가 아니라 **금속 캔 몸통 `L`(≈65mm)** ③ **니켈 탭이 옆구리를 타고 올라가** 수축튜브 아래 숨어 있으니 그 면을 피해 부착 ④ PCM 차단 시 전압 0 + `0x55` 소실은 **센서 오류가 아니다.**
- **Battery Babysitter 실물 실크스크린.** 가이드 부록 B-3의 `확인 필요` 제거. ⚠️ **2026-07-31 정정 — 회로도 네트 이름이 보드에 그대로 인쇄돼 있다는 건 사실이 아니다.** `GND_IN`·`SYS+`·`SYS−`·`BAT+`·`BAT−`는 보드에 없는 글자이며 각각 `VIN −` / `VOUT +` / `VOUT −` / JST `+` / JST `−`다. 대응표는 가이드 STEP 3.

**✅ 공식 회로도(v10) + BQ24075 데이터시트로 닫힘 (2026-07-31)**
- **BQ27441 센스 저항 = `R11` 0.01Ω(10 mΩ), 배터리 `+` 쪽 하이사이드**(`BATTERY_IN`↔`V_BATT`). 배터리 `−`는 보드 `GND`에 직결이다. → **§13 H5의 "센스 저항 역산" 부분 닫힘**, `voltage_v` 20mΩ 보정식 **폐기**, `CELL_N`↔GND 도통 검사 기준 **반전**(이어지는 게 정상).
- **온보드 스위치 2개.** `S1` 슬라이드 = `SYSOFF`(active-high, HIGH=OFF) → `OFF`면 `SYS+` 출력 0. `S2` DIP = `EN1`/`EN2`(10k `OUT` 풀업) → **출고 기본 `1,1` = Standby = 충전 안 함**. 우리 설정 `EN2=1, EN1=0`.
- **충전 전류는 온보드 저항 고정.** `R5`=590Ω → `I_CHG ≈ 1.5A`, `R7`=1.1kΩ → `I_INMAX ≈ 1.5A`. 2550mAh 18650에 **0.59C**라 셀 데이터시트 확인 필요(낮추려면 `SJ3` 컷 + `R4`).

**미해결 — 전원을 넣어 봐야 닫힌다**
- 실측 항목 8건이 `docs/hardware/mode1_backend_spec.md` §13(H1~H8)에 있다 — 션트 실측값, `therm_bulk_read` 지원, Pi 5 `gpio=` 동작, MLX90614 정착시간, BQ27441 센스 저항, DS18B20 ROM↔위치, BW150 프레임, 압력 baseline·임계. **조립 단계에서 하나씩 지운다.**

### 배터리 자산(Battery Asset)과 이력 추적

측정 **장비**(`device_id`, 라즈베리파이)와 측정 **대상**(`battery_id`, 셀/보조배터리)을 분리한다. 같은 보조배터리를 분리했다가 다시 연결해도 이전 측정 이력을 이어 볼 수 있게 하기 위함이다.

**식별 방식 — 수동 선택**
일반 USB 보조배터리는 고유 식별값(시리얼 등)을 제공하지 않아 **자동 인식이 불가**하다. 따라서 사용자가 배터리를 자산으로 등록해두고, 재연결 시 목록에서 직접 고른다. 매칭 키는 시스템이 발급한 UUID(`battery_id`)이며, 사용자가 입력하는 이름/용량은 사람이 알아보기 위한 메타데이터일 뿐이다(이름 중복 허용).

**배터리 자산 모델 (`battery_asset`)**

| 필드 | 설명 |
|---|---|
| `battery_id` | PK, 시스템 발급 UUID (매칭 키) |
| `owner_id` | 등록 계정 (소유자 범위) |
| `name` | 필수, 사용자 입력 (사람용 라벨, 중복 허용) |
| `target_mode` | 1/2 — **이 배터리의 측정 모드 고정** |
| `chemistry` | **필수**, `li_ion`(리튬이온) / `li_po`(리튬폴리머) — 셀당 전압 기준·전압 임계값 해석 |
| `series_count` | 선택, 직렬 셀 수(S) — 팩 전압 범위 = `series_count` × 셀당 전압 |
| `capacity_mah` / `capacity_wh` | **`target_mode`=2면 필수**, 모드 1이면 선택 — 모드 2의 `soc_pct`와 절대 SOH가 이 값을 분모로 쓴다(2026-07-28) |
| `rated_output_current_a` | **필수(모드 2)** — 보조배터리 겉면의 광고 정격 출력 전류. 모드 2 빠른 진단의 **스펙 도달률** 산출에 쓴다. |
| `baseline_wh` | 시스템 산출 — 이 자산의 **첫 정밀 용량 테스트**에서 뽑아낸 Wh. 이후 상대 SOH의 분모다. 부분 결과는 후보로 쓰지 않는다(2026-07-28) |
| `manufacturer` / `model` / `memo` | 선택 |
| `created_at` / `last_measured_at` | 메타 |

- **`target_mode` 고정**: 배터리에 모드를 묶어, 재연결 시 모드를 다시 고를 필요 없이 자동 적용된다(잘못된 모드 측정 방지). 유저 플로우에서 "측정 모드 선택" 단계는 "배터리 자산관리"에 흡수된다.
- **✅ 모드 2의 `soc_pct` 출처 확정 (2026-07-28)**: 완제품 보조배터리는 셀에 접근할 수 없어 Battery Babysitter(BQ27441)를 못 붙인다. 대신 **INA226 적산으로 상대 SOC**를 낸다 — 측정 시작 시점을 100%로 보고 방전 Wh를 적산해 감산하며, 분모는 등록 시 입력한 `capacity_wh`(없으면 `capacity_mah` × 공칭전압)다. 그래서 **모드 2 배터리는 용량 입력이 필수**다.
  - **절대 SOC가 아니다.** 시작 시점이 만충이 아니었으면 통째로 어긋난다. AI가 쓰는 건 SOC의 **변화 추이**이고, 대시보드에는 상대값임을 표시한다.
  - USB 출력단에서 재므로 내부 셀 기준이 아니라 **출력 Wh 기준**이다. 승압 변환 손실만큼 실제 셀 소모보다 작게 잡힌다.
  - 측정 세션이 끊겼다 이어지면 적산 기준점도 끊긴다. **세션 단위로만 유효하다.**
- **종류·직렬 셀 수**: 등록 시 `chemistry`(리튬이온/리튬폴리머)는 필수, `series_count`(직렬 셀 수 S)는 선택으로 받는다. 보조배터리 BMS 대상이라 대중적인 리튬이온·리튬폴리머 2종만 둔다. 두 값은 LSTM-AutoEncoder + Informer 이상탐지의 입력 컨텍스트이자 전압 임계값 해석 기준이며, 임계값 자체는 정상패턴 학습으로 추정한다(셀당 전압×셀 수 공식의 자동계산이 아니라 AI 추정).

**측정 세션과 백엔드 태깅 (`measurement_session`)**

| 필드 | 설명 |
|---|---|
| `session_id` | PK |
| `device_id` / `battery_id` / `mode` | 측정 장비·대상·모드 |
| `started_at` / `ended_at` | 세션 구간 (`ended_at=null`이면 active) |

1. 사용자가 웹에서 배터리 선택 후 "측정 시작" → 백엔드가 `measurement_session` 생성.
2. 에지는 변함없이 `device_id`+Raw만 Kafka 발행(기존 "에지는 Raw만" 철학 유지, 에지 스키마·Kafka 무변경).
3. Consumer 적재 시 해당 `device_id`의 **active 세션**을 조회해 `battery_id`로 태깅.
4. AI 추론 결과(`battery-anomaly-alerts`) wire payload는 `device_id`만 권위값으로 받고, Consumer가 같은 활성 세션 조회로 `session_id`·`battery_id`를 DB 적재 시 태깅 → 배터리별 이상 이력 누적.
5. "측정 종료" 시 `ended_at` 기록.

- **active 세션 단일성**: 한 `device_id`에 active 세션은 항상 1개(모드 인터락과 동일한 상호배제, S-LWVJRY에 포함).
- **세션 미시작 데이터**: 배터리 선택 없이 들어온 데이터는 `battery_id=null`(미배정)로 적재하고 "미배정 데이터" 경고 이벤트를 남긴다(데이터는 버리지 않음).
- **DB 배치**: `battery_asset`·`measurement_session`은 PostgreSQL(비시계열), 시계열 하이퍼테이블은 `battery_id` FK로 참조(S-NFEETD).

---

## 3. 요구사항

| ID | 이름 | 중요도 | 기능 수 |
|---|---|---|---|
| R-HBLCDS | 사용자 인증 | Medium | 3 |
| R-YZNPSL | 배터리 데이터 수집 및 디바이스 연동 | **High** | 3 |
| R-EOCOME | 스트리밍 파이프라인 및 데이터베이스 적재 | **High** | 3 |
| R-PKCMPP | 시계열 AI 이상징후 탐지 및 위험도 산출 | **High** | 3 |
| R-GTAZLF | 웹 대시보드 관제 및 알림/차단 | **High** | 5 |

---

## 4. 기능 목록 (17개)

### 인증 (R-HBLCDS)
- **F-SDSVND** — 일반 회원가입/로그인
- **F-TFJKKF** — 소셜 로그인(SSO)
- **F-HUYIXC** — 계정 찾기 및 비밀번호 재설정

> 인증은 Better Auth를 백엔드 `/api/auth/*`에 마운트해 구현한다. 로그인 유지는 JWT 직접 발급이 아니라 Better Auth 세션 쿠키와 서버 세션 검증을 기준으로 하며, 일반 사용자와 관리자는 `USER`/`ADMIN` RBAC로 분리한다.

### 배터리 데이터 수집 (R-YZNPSL)
- **F-IZUROQ** — 센서 데이터 수집(I2C/1-Wire/아날로그) — INA226, BQ27441, DS18B20, MLX90614, ADS1115 경유 가스(MQ-2)·압력(FSR 406)·음향
- **F-QLXYRG** — 배터리 자산관리(등록/선택) 및 측정 모드 인터락 — 배터리에 `target_mode` 고정, 재연결 시 수동 선택으로 이력 연속
- **F-CQGCQU** — 수집 데이터 표준화 및 오류 이벤트

### 스트리밍 파이프라인 (R-EOCOME)
- **F-SPSXYT** — Kafka 토픽 설계 및 프로듀서 발행
- **F-KWIVVH** — Consumer 적재 및 재처리(오프셋)
- **F-DZEIOV** — 시계열 DB 스키마/인덱스(TimescaleDB)

### AI 이상 탐지 (R-PKCMPP)
- **F-MAPLGA** — 학습 데이터 준비 및 모델 학습 (LSTM-AutoEncoder + Informer 이중 모델)
- **F-VTQMVE** — 실시간 추론 및 이상점수 계산 (AE Score + Informer Score → Score Fusion)
- **F-EKKSKT** — 이상 이벤트 저장

### 웹 대시보드 & 관제 (R-GTAZLF)
- **F-MGZLEL** — 실시간 상태 대시보드(게이지/요약, 반응형 레이아웃)
- **F-XEVQAR** — 추세 차트 및 이력 조회
- **F-LZWTMZ** — SNS 알림(카카오톡 등)
- **F-BLCZSQ** — 릴레이/Kill-Switch 제어
- **F-VOICEA** — 디바이스 스피커 음성 안내 및 웹 설정

### 웹 대시보드 확장 결정 (2026-06-30)

웹서버(백엔드+대시보드)의 산출물·요구사항·기능을 상세화하면서 확정한 추가 결정사항이다. 상세 기능과 흐름은 `docs/feature_definition.md`, `docs/admin_feature_definition.md`, `docs/userflow.md`, `docs/admin_userflow.md`를 기준으로 한다.

- **명칭 통일**: "배터리 선택/등록" 페이지·기능을 **"배터리 자산관리"**로 통일한다(자산 모델 `battery_asset`과 일관). "새 배터리 등록"·"저장된 배터리 선택"은 자산관리 화면의 하위 액션으로 유지, "배터리 상세/이력"은 별도 페이지로 유지.
- **반응형 웹**: 대시보드를 데스크톱/태블릿/모바일 **반응형 웹**으로 제공한다. 데스크톱은 사이드바+다중 컬럼 관제 화면, 태블릿은 2컬럼 중심, 모바일은 하단 내비게이션+단일 컬럼 카드/차트로 재배치한다(브레이크포인트 대응, 터치 조작, 다크모드·접근성 포함).
- **유저/관리자 기능 분리**: 일반 사용자 기능과 관리자 기능을 화면·라우팅·권한 기준으로 분리한다. 일반 사용자 흐름은 `docs/userflow.md`, 관리자 전용 흐름은 `docs/admin_userflow.md`를 기준 문서로 관리한다.
- **관리자 기능 MVP(신규)**: 일반 사용자 권한과 별도로 단일 `ADMIN` 역할을 둔다. 초기 운영 MVP 범위는 HTML 프로토타입을 우선 기준으로 사용자/계정 조회 및 정지·해제, 비밀번호 재설정, 전체 배터리 조회, 배터리 운영 상태(`NORMAL`/`WATCH`/`BLOCKED`)와 관리자 메모, 배터리 통계, 디바이스 상태, 공지사항 관리, 감사 로그로 둔다. 관리자 권한 세분화, 데이터 삭제, 릴레이/Kill-Switch 원격 제어는 MVP 이후로 미룬다.
- **운영·복원력 보강**: MVP에서는 WebSocket cursor/sequence/eventId 기반 재개·하트비트·멱등성, 단순 헬스체크, 감사 로깅을 우선한다. Raw CSV는 100ms 원본이며 1시간 이하는 스트리밍, 초과 범위는 비동기 export job으로 제공한다. 추세 화면의 집계 PDF 다운로드는 이번 생산 기능 범위이며, 인앱 알림 고도화는 후속 기능으로 둔다.
- **요구사항 정의서 사용자 관점 정비(2026-06-30)**: 웹 요구사항 정의서를 기능정의서형 문구에서 사용자·운영자 기대 중심 문구로 수정했다. 기존 SRS-WEB ID, 중요도, 비고 체계는 유지하고, HTML에서 확인되는 기능을 "사용자가 원하는 기능/운영자가 필요한 관리 기능" 관점으로 재서술했다.
- **요구사항 상세설명 간결화(2026-06-30)**: 요구사항 상세설명 문구에서 "~싶다/원한다" 형태를 제거하고, "이메일로 안전하게 로그인."처럼 짧은 요구 동작 중심 문구로 정리했다.
- **요구사항명 간결화(2026-06-30)**: 요구사항명을 "이메일 로그인", "소셜 로그인", "배터리 등록"처럼 짧은 명사형 이름으로 정리했다.
- **요구사항 표 형식 통일(2026-06-30)**: 요구사항 표를 5열 형식으로 통일하고, 현재 확인 가능한 요구사항 행을 `SRS-WEB-001~060`으로 연속 재번호화했다.
- **요구사항 표 빈칸 보완(2026-06-30)**: 요구사항 표의 빈 ID, 중요도, 비고 칸을 현재 보이는 행 기준으로 보완했고, 내부 중복 항목을 정리했다.
- **일반 사용자 유저 플로우 갱신(2026-06-30)**: `docs/userflow.md`를 HTML 프로토타입 기준으로 재정리했다. 랜딩/인증, 디바이스·배터리, 배터리 연결 확인, 실시간 관제, XAI, SOH/RUL, 알림 Ack, SOP, 위험 제어 승인, 추세/이벤트/내보내기 흐름을 일반 사용자 여정에 반영했다.
- **HTML 프로토타입 기능정의서 작성(2026-07-03, 정본 경로 갱신 2026-08-06, **정본 교체 2026-08-28**)**: 기능정의서 2종은 당시 `설계 산출물/셀가드 프로토타입_v3.html`에 표시된 화면·버튼·입력·탭·필터·모달·카드·상태값을 기준으로 작성됐다. **그러나 화면·동작의 정본은 이제 `frontend/` 구현이다** — v3와 어긋나면 `frontend/`가 맞다. 사용자 흐름은 `docs/userflow.md`, 관리자 흐름은 `docs/admin_userflow.md`가 따른다. 프로필 사진 변경은 제거됐고, 남은 제품 결정은 랜딩 메뉴 목적지와 데모 영상 동작이다.
- **웹서버 기준값 변경 기능 제거(2026-07-07)**: 웹서버/대시보드 범위에서 사용자가 직접 기준값을 변경하는 화면, UI, API 산출물 항목을 제외했다. 남는 `임계값 초과` 표현은 이벤트/Fail-Safe 상태 설명으로만 사용하며, 설정 기능으로 추적하지 않는다.
- **GitHub 공유 레포 정리(2026-07-10)**: 원격 저장소를 `https://github.com/ricky30825-creator/BMS`로 정리하고, 발표자료·설계 산출물 원본·클로드 보고·백업·샘플 PDF/DOCX/PPTX를 레포 추적 대상에서 제외했다. 이후 공유 기준 문서는 `PLAN.md`와 `docs/*.md`, 화면 참고 산출물은 `web/*.html`과 `assets/*.svg`를 우선한다.
- **AI 알고리즘 이중 모델 업데이트(2026-07-09)**: AI 아키텍처를 단일 LSTM-AutoEncoder에서 **LSTM-AutoEncoder(현재 상태 진단) + Informer(미래 상태 예측) 이중 모델**로 갱신했다. 두 모델은 정규화·Sliding Window로 생성한 동일 Sequence를 공유 입력으로 받고, AE Score(재구성 오차)와 Informer Score(예측 오차)를 Score Fusion(`Final Score = α × AE Score + β × Informer Score`)으로 결합해 최종 이상점수를 산출한다. 상태 등급 4단계(정상/주의/경고/위험, 0.0–1.0 구간)는 이 최종 이상점수 기준으로 유지하며, 아키텍처는 측정 모드 공통 적용이다(2026-07-27 2모드로 축소: 외부 셀/보조배터리). 입력 특징 목록(V_scaled 등 파생 특징)은 기존과 동일하다. Score Fusion 가중치 α·β는 고정값이 아니라 테스트를 통해 튜닝하며 찾아간다. `CLAUDE.md`, `AGENTS.md`, `PLAN.md`를 함께 갱신했다.
- **디바이스 스피커 음성 안내 추가(2026-07-10)**: 라즈베리파이에 스피커를 추가해 현장 음성 안내를 제공한다. 음성은 실시간 합성 TTS가 아니라 사전 생성된 한국어 MP3/WAV 파일을 에지에서 로컬 재생하는 방식으로 둔다. 안내 대상은 보조배터리 물리 연결 감지, 웹 측정 세션 시작/종료, 이상 상태, Fail-Safe 차단, 릴레이 상태, 센서·디바이스 오류, 네트워크·서버 상태 이벤트다. 웹 설정에는 전체 공통 정책으로 음성 안내 ON/OFF, 음량, 카테고리별 토글(연결/측정, 이상상태, Fail-Safe/릴레이, 센서/디바이스 오류, 네트워크/서버 상태)을 제공한다. 음성 안내는 운영 보조 기능이며 릴레이/Kill-Switch 판단에는 영향을 주지 않는다.

> 위 확장은 R-GTAZLF(웹 대시보드 관제) 범위의 설계 상세화이며, Manyfast 등록 요구사항/기능/스펙 카운트(아래 10절)는 기존 체계를 유지한다.

### 관리자 MVP 상세 범위 (초기 운영용)

관리자 MVP의 목적은 발표용 화면보다 한 단계 높은 초기 운영 콘솔이다. 관리자는 전체 사용자, 배터리, 디바이스, 이상 상태를 한곳에서 확인하고, 계정 정지/해제, 비밀번호 재설정, 배터리 운영 상태 표시, 공지사항 게시 관리를 수행한다. 데이터 삭제, 위험 제어처럼 안전장치가 필요한 기능은 제외한다.

**관리자 대시보드**
- 전체 유저 수, 전체 배터리 수, 활성 측정 세션 수, 위험/경고 상태 배터리 수, 오프라인 디바이스 수를 요약 카드로 제공한다.
- 최근 7일 신규 유저·배터리 수, 최근 24시간 이상 이벤트 수, 최근 24시간 데이터 수신 중단 디바이스 수를 보여준다.
- 배터리 상태별·측정 모드별 분포와 최근 7일 이상 이벤트 추이를 제공한다.
- 최근 위험 배터리 5개, 최근 오프라인 디바이스 5개, 최근 관리자 조작 로그 5개를 빠른 목록으로 제공한다.

**유저 계정 관리**
- 유저 목록에서 이름, 이메일, 권한, 상태, 등록 배터리 수, 최근 접속일, 가입일을 조회한다.
- 이름/이메일 검색, 상태(전체/활성/정지), 권한(전체/일반/관리자) 필터를 제공한다.
- 유저 상세에서 기본 정보, 등록 배터리, 최근 측정 세션, 최근 이상 이벤트, 최근 관리자 조작 이력을 확인한다.
- 관리자는 계정을 활성/정지 상태로 변경할 수 있고, 상태 변경 사유는 필수로 입력한다.
- 유저 수정 모달에서 관리자가 새 비밀번호를 직접 지정하지 않는다. 재설정 링크 이메일 발송만 요청하며 사용자가 직접 변경한다.
- 계정 삭제, 이메일 변경, 관리자 권한 부여/회수 화면은 MVP 제외다.

**배터리 관리**
- 전체 배터리 목록에서 배터리 이름, 소유자, 제조사/모델, 용량, 측정 모드, 화학 타입, 최근 측정일, 최근 위험 상태, 관리자 운영 상태를 조회한다.
- 배터리 이름, 소유자, 측정 모드, 상태, 최근 측정 여부 기준으로 검색/필터링한다.
- 배터리 상세에서 기본 정보, 소유자, 최근 측정 세션, 최근 센서 요약값, 최근 이상 이벤트, 관리자 운영 상태/메모를 확인한다.
- 관리자 운영 상태는 `NORMAL`(정상 운영), `WATCH`(주시 대상), `BLOCKED`(운영상 사용 제한)로 둔다.
- 현재와 다른 모든 관리자 운영 상태 변경은 사유·확인을 필수로 하고 감사 로그에 기록한다. 관리자 메모는 상태와 별도 저장하며 독립 감사 기록을 남긴다.
- 배터리 삭제, 소유자 변경, 센서 데이터 수정, 측정 이력 삭제, AI 판정값 수정은 MVP 제외다.

**배터리 통계**
- 전체 등록 배터리 수, 측정 이력이 있는 배터리 수, 최근 7일/30일 등록 배터리 수를 제공한다.
- 측정 모드별, 화학 타입별, 제조사별, 관리자 운영 상태별 분포를 제공한다.
- 정상/경고/위험 상태 배터리 수, 최근 24시간/7일 이상 이벤트 수, 이상 이벤트가 가장 많은 배터리 Top 5를 제공한다.
- 고급 분석 리포트와 관리자 통계 전용 PDF는 MVP 제외다. F9의 추세 집계 PDF와 100ms Raw CSV는 각각의 일반 사용자 내보내기 계약에 포함한다.

**디바이스 상태 모니터링**
- 디바이스 ID, 온라인 상태, 최근 데이터 수신 시각, 현재 측정 세션, 연결 배터리, 최근 이벤트를 조회한다.
- 최근 1분 이내 수신은 `ONLINE`, 1~5분 수신 없음은 `DELAYED`, 5분 이상 수신 없음은 `OFFLINE`으로 표시한다.
- `device.last_seen_at`은 edge `measured_at`이 아닌, 신규 `(device_id, measured_at)` telemetry row를 커밋하는 transaction 안에서 PostgreSQL `clock_timestamp()`로 기록한 서버 수신 시각이다. 자연키 duplicate replay는 `status`를 `ONLINE`으로 되돌리거나 이 값을 갱신하지 않는다.
- Kafka, Consumer, DB, AI 추론 상태는 정상/비정상/확인불가 수준의 단순 헬스 카드로 제공한다.
- Kafka lag, 처리량, 모델 드리프트 등 상세 운영 지표는 MVP 제외다.

**감사 로그**
- 관리자 로그인, 유저 계정 정지/해제, 배터리 운영 상태 변경, 배터리 관리자 메모 변경, 관리자 페이지 접근 실패를 기록한다.
- 로그에는 시간, 관리자, 행위, 대상 타입, 대상 ID, 변경 전 값, 변경 후 값, 사유를 남긴다.
- 기간, 관리자, 행위 타입, 대상 타입 기준 조회를 제공한다.
- 감사 로그는 수정/삭제할 수 없고, 민감 정보는 저장하지 않는다.

**공지사항 관리**
- HTML 프로토타입 기준으로 관리자는 공지사항 목록에서 카테고리, 제목, 상태, 관리 동작을 확인한다.
- 새 공지 작성과 기존 공지 수정 모달에서 카테고리, 공개 범위, 제목, 내용을 입력한다.
- 공지는 임시 저장하거나 게시할 수 있으며, 게시와 동시에 웹푸시·카카오 알림 발송 여부를 선택할 수 있다.
- 게시 알림은 DB의 `notice_delivery_intent` 기록과 실제 provider 발송을 분리한다. provider·자격증명이 없으면 발송 성공으로 처리하지 않고 외부 차단 상태로 남긴다.
- 공지 보관/삭제는 확인 모달을 거쳐 처리한다.

**관리자 데이터 모델/API**
- `users`: `role`(`USER`/`ADMIN`), `status`(`ACTIVE`/`SUSPENDED`), `suspended_reason`, `suspended_at`
- `battery_asset`: `admin_status`(`NORMAL`/`WATCH`/`BLOCKED`), `admin_memo`, `admin_status_updated_at`, `admin_status_updated_by`, `admin_memo_updated_at`, `admin_memo_updated_by`
- `device`: `device_id`, `display_name`, `last_seen_at`, `status`(`ONLINE`/`DELAYED`/`OFFLINE`/`UNKNOWN`), `hardware_profile`(`MODE2_FULL`/`COMBINED_EXISTING_PARTS_V1`; 서버 배포 메타데이터, Raw에는 미포함)
- `audit_log`: `log_id`, `actor_id`, `action`, `target_type`, `target_id`, `before_value`, `after_value`, `reason`, `created_at`
- `domain_event`: `event_id`, `event_type`, `severity`, `source`, `device_id`, `battery_id`, `session_id`, `occurred_at`, `score`, `params`, `acknowledged_at`, `acknowledged_by`, `dedupe_key`
- `notice`·`notice_view`·`notice_delivery_intent`: 공지 본문/상태·대상, 사용자별 24시간 조회 dedupe, 외부 발송 의도와 실제 provider 상태
- 관리자 API: `GET /api/admin/users`, `GET /api/admin/users/{userId}`, `PATCH /api/admin/users/{userId}`, `POST /api/admin/users/{userId}/suspend`, `POST /api/admin/users/{userId}/restore`, `POST /api/admin/users/{userId}/password-reset`, `GET /api/admin/batteries`, `GET /api/admin/batteries/{batteryId}`, `PATCH /api/admin/batteries/{batteryId}/ops-status`, `PATCH /api/admin/batteries/{batteryId}/memo`, `GET /api/admin/stats/summary`, `GET /api/admin/stats/batteries`, `GET /api/admin/stats/anomalies`, `GET /api/admin/devices`, `GET /api/admin/devices/{deviceId}`, `GET /api/admin/system-health`, `GET /api/admin/notices`, `POST /api/admin/notices`, `PATCH /api/admin/notices/{noticeId}`, `POST /api/admin/notices/{noticeId}/archive`, `GET /api/admin/audit-logs`

**MVP 제외 항목**
- 문의/고객지원 관리, 관리자 권한 세분화, 계정 삭제
- 배터리 삭제, 센서/측정 데이터 수정, 관리자 통계 CSV/PDF 내보내기(추세 화면 F9 PDF와 구분)
- 릴레이/Kill-Switch 원격 제어, AI 모델/드리프트 관리, Kafka lag 상세 분석, 백업/복구 관리

---

## 5. 주요 스펙 상세 (33개)

### 인증 (5개)
| ID | 스펙 |
|---|---|
| S-IQOGHO | 회원가입 입력 검증 |
| S-ABZLNC | Better Auth 세션 쿠키 기반 로그인 유지 |
| S-VCGWIK | OAuth 리다이렉트 및 콜백 처리 |
| S-OKBMSS | 아이디 찾기 |
| S-TAGOLP | 비밀번호 재설정 이메일 발송 |

### 센서 & 수집 (8개)
| ID | 스펙 |
|---|---|
| S-YUNAFH | 센서 폴링 스케줄러 (100ms 주기) |
| S-DPVOCW | I2C/1-Wire/아날로그(ADS1115) 통신 드라이버 추상화 |
| S-QPLAYR | 모드별 릴레이 채널 매핑 |
| S-LWVJRY | 인터락(상호배제) 로직 — 모드 + active 측정 세션 단일성 |
| S-IBQMVJ | 센서 메시지 JSON 스키마 (Raw 값만 에지 전송, `battery_id`는 백엔드 태깅) — 모드별 가용 필드는 **`gas_raw`(모드 2만)·`pressure_raw`(모드 1만)·`acoustic_raw`(항상 `null`, 센서 미도입)**. 정본은 CLAUDE.md 센서 표이며 회로가 그 근거다(2026-07-28) |
| S-MVDKKZ | 오류/예외 이벤트 기록 |
| S-BATAST | 배터리 자산관리(등록/선택) (`battery_id` UUID 발급, `target_mode` 고정, `chemistry` 필수·`series_count` 선택, 수동 매칭) |
| S-MSESSN | 측정 세션 관리 및 백엔드 `battery_id` 태깅 (active 세션 1개, 미배정 데이터 경고) |

### Kafka & 스트리밍 (4개)
| ID | 스펙 |
|---|---|
| S-BYYPVQ | 토픽 정의 (raw-metrics / anomaly-alerts / events) |
| S-TNASAB | 프로듀서 전송 및 재시도 정책 |
| S-JGLAAI | Consumer 적재 파이프라인 |
| S-SBCSJU | 오프셋 커밋 및 재처리 |

### 데이터베이스 (2개)
| ID | 스펙 |
|---|---|
| S-NFEETD | 시계열 테이블/하이퍼테이블 설계 — `battery_id` 컬럼·인덱스 포함 (배터리별 이력 조회) |
| S-ROGPIB | 대시보드용 조회 뷰/요약 테이블 — `battery_id` 기준 세션·이상점수 이력 집계 |

> `battery_asset`, `measurement_session` 관계 테이블은 PostgreSQL(비시계열)에 두고, 시계열 하이퍼테이블은 `battery_id` FK로 참조한다.
>
> **⚠️ 위 두 스펙은 "설계"가 아니라 "이미 있는 스키마 위의 남은 작업"이다.** 실제 컬럼·제약의 정본은 `backend/migrations/000_identity.sql`~`014_latest_ambient.sql`이다. `002`~`005`는 추론 결과·Raw 보조 필드·하이퍼테이블·진단기·중복 방지·`battery_asset.memo`를, `006`은 진단 phase 경계 스냅샷을, `007`은 raw wire payload를, `008`~`009`는 outbox identity·delivery 상태를, `010`은 영속 domain event를, `011`은 공지·조회 기록·발송 의도를, `012`는 Fail-Safe 프로필과 세션별 압력 baseline을 반영한다. **이 문서가 "시계열 하이퍼테이블"이라 부르는 테이블의 실제 이름은 `telemetry_metric`이다.** 과거 결정 기록은 `docs/handover/schema-open-questions.md`에서 확인한다.

### AI 모델 (4개)
| ID | 스펙 |
|---|---|
| S-LUTREM | 정상 데이터 수집/라벨링 방침 (LSTM-AutoEncoder·Informer 공통) |
| S-WKCPVK | 특징 추출 및 윈도우링 (30 time-steps, 정규화 + Sliding Window로 Sequence 생성) — V_scaled, V_delta, V_drop, I_smooth, dT_dt, d2T_dt2, Wh_cumsum (+ 발열값 `T_rise` = 표면온도 − 실온을 추가하는 방향, 2026-09-25 · 미구현). 동일 Sequence를 LSTM-AutoEncoder·Informer에 동시 입력 |
| S-FGKMXE | 이중 모델 이상점수 계산 — LSTM-AutoEncoder 재구성 오차(AE Score) + Informer 예측 오차(Informer Score)를 Score Fusion(가중합 `Final Score = α × AE Score + β × Informer Score`)으로 결합해 최종 이상점수 산출 |
| S-WJYKSS | 상태 등급 판정 (최종 이상점수 Final Score 기준) — 정상(0.0–0.3) / 주의(0.3–0.6) / 경고(0.6–0.8) / 위험(0.8–1.0) |

> 가스(`gas_raw`)·압력(`pressure_raw`)·음향(`acoustic_raw`)은 AI 예측 입력 특징이 아니라 **사후 대응 안전계층**이다. 가스는 모드 2, 압력은 모드 1에서만 임계값을 적용하고 AI 판정과 무관하게 즉시 릴레이를 차단한다. 음향은 도입하지 않아 `null`이다. AI 이중 모델 입력은 전압·전류·온도·SOC 기반 특징만 사용한다.
> Score Fusion 가중치 α·β는 고정값이 아니라 테스트를 통해 튜닝하며 결정한다(모델 학습/검증 단계에서 그리드서치 등으로 탐색).

### 이벤트 (1개)
| ID | 스펙 |
|---|---|
| S-RMXMCJ | 이상 이벤트 스키마 및 저장 |

### 대시보드 UI (3개)
| ID | 스펙 |
|---|---|
| S-OFKBJC | 홈 요약 카드/게이지 UI — SOC 게이지, V/I/W/T, 신호등, 반응형 카드 그리드 |
| S-AEMMPM | 라이브 차트 (전압/온도 등) — 화면 폭에 따라 차트 높이·범례·필터 재배치 |
| S-XEVPOF | 이상 이벤트 목록/상세 — 데스크톱 테이블, 모바일 카드 목록/상세 전환 |

### 알림 & 차단 (5개)
| ID | 스펙 |
|---|---|
| S-EOCLMX | 카카오톡 알림 메시지 템플릿 |
| S-UZDNPT | 알림 발송 조건/레이트리밋 |
| S-ELAUQJ | 릴레이 제어 API |
| S-VMNNAM | 긴급 차단 자동화 (Fail-Safe) |
| S-VOCALR | 디바이스 스피커 음성 안내 — 사전 생성된 로컬 음성파일 재생, 전체 공통 ON/OFF·음량·카테고리 토글 설정, 동일 이벤트 반복 안내 쿨다운 |

**디바이스 음성 안내 설정 모델/API**
- `voice_alert_settings`: `enabled`, `volume`, `connection_enabled`, `anomaly_enabled`, `failsafe_relay_enabled`, `device_error_enabled`, `network_enabled`, `updated_at`
- API: `GET /settings/voice-alert`, `PATCH /settings/voice-alert`
- 에지는 설정을 주기 조회하거나 설정 변경 이벤트를 반영하고, 네트워크 장애 시 마지막으로 확보한 설정과 로컬 음성파일로 최소 동작한다.

---

## 6. 유저 플로우

일반 사용자 기능과 관리자 기능은 별도 흐름으로 분리한다. 일반 사용자는 측정 대상 등록·세션 시작·실시간 관제·알림·제어를 중심으로 사용하고, 관리자는 전체 사용자/배터리/디바이스/시스템/감사 로그를 운영 관점에서 관리한다.

- 일반 사용자 상세: `docs/userflow.md`
- 관리자 상세: `docs/admin_userflow.md`
- 일반 사용자 기능정의서: `docs/feature_definition.md` — HTML 프로토타입 기준 72개 + 디바이스 음성 안내 설정 1개
- 관리자 기능정의서: `docs/admin_feature_definition.md` — HTML 프로토타입 기준 36개

### 일반 사용자 플로우 섹션 (8개)

```
[인증/계정]
시작 → 로그인 페이지
├── 일반 로그인
├── 소셜 로그인(OAuth)
├── 회원가입
├── 계정 찾기 → 아이디 찾기 / 비밀번호 재설정
└── Better Auth 세션 생성/검증 → 로그아웃/세션 만료

[디바이스/배터리]
디바이스 관리 페이지 → 디바이스 등록/선택
└── 배터리 자산관리
    ├── 저장된 배터리 선택 (이전 이력 연속)
    ├── 새 배터리 등록 (이름/종류/target_mode/직렬 셀 수/모델명 입력 → battery_id 발급)
    ├── 배터리 연결 확인
    └── 배터리 상세/이력 확인

[측정 세션]
배터리 연결 확인
└── 연결하고 측정 → 세션 시작 → 실시간 대시보드
    └── 에지 스피커에서 측정 시작 음성 안내

[실시간 관제]
실시간 대시보드 → 요약 카드/게이지 확인
├── WebSocket 실시간 갱신
├── 연결 끊김/자동 재연결 표시
└── 최근 이벤트 확인

[이상 분석]
이상 이벤트 표시
├── 위험도 분포 집계
├── 이상 근거 설명 패널(XAI)
└── SOH/RUL 건강도 카드

[알림/대응]
알림 센터
├── 인앱/카카오 알림 발송
├── 에지 스피커 음성 안내(설정된 카테고리 기준)
├── 알림 조건/중복 제한 적용
├── 알림 확인(Ack)·대응상태 기록
├── 긴급 대응 SOP 런북
└── 릴레이 제어 → 위험 제어 승인 모달 → Kill-Switch 차단/릴레이 복구

[분석/내보내기]
추세 차트/이력 조회 → 기간/지표 필터
├── 이벤트 이력 목록 → 이벤트 상세
├── 다중 배터리/세션 비교
└── 데이터 내보내기(CSV/PDF)

[설정]
설정 화면
├── 알림 수신 설정
├── 디바이스 음성 안내 설정(전체 ON/OFF, 음량, 카테고리별 토글)
├── 계정 정보 수정
├── 다크모드/테마 전환
└── 캘리브레이션 이력 조회

```

---

### 관리자 전용 플로우 섹션 (7개)

```
[관리자 인증/진입]
로그인 → 역할 확인(RBAC)
├── ADMIN 권한 있음 → 관리자 대시보드
└── ADMIN 권한 없음 → 접근 거부 → 접근 실패 감사 로그 기록

[관리자 대시보드]
전체 운영 현황 확인
├── 전체 유저/배터리/활성 세션/위험 상태/오프라인 디바이스 요약
├── 최근 위험 배터리 → 배터리 상세
├── 최근 오프라인 디바이스 → 디바이스 상세
└── 최근 관리자 조작 로그 → 감사 로그 상세

[유저 계정 관리]
유저 목록 → 검색/필터 → 유저 상세
├── 계정 정지·해제 → 사유 입력 → 변경 확인 → 감사 로그 기록
└── 비밀번호 재설정 → 변경 저장 → 감사 로그 기록

[배터리 운영 관리]
배터리 목록 → 검색/필터 → 배터리 상세
├── 운영 상태(NORMAL/WATCH/BLOCKED) 변경 → 모든 전환 사유 입력 → 변경 확인 → 감사 로그 기록
└── 관리자 메모 별도 저장 → 별도 감사 로그 기록

[통계·디바이스·헬스]
배터리 통계 → 상태/모드/제조사/이상 이벤트 집계
└── 디바이스 상태 → ONLINE/DELAYED/OFFLINE 확인
└── 시스템 헬스 카드 → Kafka/Consumer/DB/AI 정상·비정상·확인불가 확인

[공지사항 관리]
공지사항 목록 → 새 공지 작성/공지 수정
├── 카테고리·공개 범위·제목·내용 입력
├── 임시 저장 또는 게시
└── 게시와 동시에 웹푸시·카카오 알림 발송 선택

[감사 로그]
감사 로그 목록 → 기간/관리자/행위/대상 필터
└── 감사 로그 상세 확인
└── 수정·삭제 차단
```

> 관리자 MVP에서는 HTML 프로토타입에 표시된 조회·상태 관리·비밀번호 재설정·공지사항 관리·감사 추적을 제공한다. 계정 삭제, 권한 세분화, 데이터 삭제, 원격 Kill-Switch, 백업/복구 관리는 MVP 이후 기능이다.

---

## 7. 와이어프레임 페이지 목록 (19개)

> **이 목록은 설계 단계의 페이지 목록이며, 실제로 도는 화면의 정본은 `frontend/`다(2026-08-28 확정).** 아래 표기와 `frontend/src/pages/`의 라우트가 어긋나면 구현 쪽이 맞다.

> "측정 모드 선택"은 "배터리 자산관리"에 흡수됨(배터리의 `target_mode` 자동 적용).
> 모든 웹 화면은 같은 React 반응형 레이아웃 기준을 따른다. 데스크톱은 관제 밀도, 태블릿은 터치 조작, 모바일은 경고 확인·알림·긴급 제어의 빠른 접근성을 우선한다.
> 2026-07-03 HTML 프로토타입 분석에서는 기존 목록 외에 랜딩, 관리자 이벤트 추이, 관리자 공지사항 관리가 명확히 확인되었다. 기능정의서와 플로우 문서에는 HTML 기준으로 반영한다.

| 페이지 | 노드 수 | 주요 내용 |
|---|---|---|
| 로그인 | 21 | 일반/소셜 로그인 |
| 회원가입 | 18 | 입력 검증 포함 |
| 계정 찾기 | 18 | 아이디 찾기, 비밀번호 재설정 |
| 디바이스 관리 | 52 | 목록, 등록 |
| 배터리 자산관리 | 40 | 저장된 배터리 목록 선택 + 새 배터리 등록(이름/종류/모드/직렬 셀 수/모델명), target_mode 자동 적용 |
| 배터리 상세/이력 | 48 | 배터리별 과거 측정 세션·이상점수 추세 조회 |
| **실시간 대시보드** | **136** | 요약 카드 4개, 게이지 4개, 이상탐지 요약, 위험도 분포, 최근 이벤트 5개, 반응형 카드/차트 재배치 |
| 추세 차트 | 57 | 시간축 차트, 기간/필터 |
| 이벤트 이력 | 116 | 이벤트 목록, 상세 |
| 이상 탐지 관리 | 108 | 이상점수, 경고 상태 |
| 알림 설정 | 82 | 카카오톡 연동, 조건 설정, 오버레이 |
| 알림 이력 | 93 | 이력 조회 |
| 릴레이 제어 | 56 | Kill-Switch, 회로 복구 |
| 관리자 대시보드 | 72 | 전체 유저/배터리/세션/위험 상태/오프라인 디바이스 요약 |
| 관리자 유저 관리 | 64 | 유저 목록/검색/필터, 계정 정지·해제 |
| 관리자 배터리 관리 | 76 | 전체 배터리 목록/상세, 운영 상태·메모 |
| 관리자 디바이스 상태 | 52 | 온라인/지연/오프라인, 최근 수신 시각, 시스템 헬스 |
| 관리자 감사 로그 | 48 | 관리자 로그인·상태 변경·접근 실패 이력 조회 |

### 실시간 대시보드 세부 내용

**요약 카드 (4개)**
- 전체 배터리 수: 128개 (정상 운영 중)
- 경고 상태: 7개 (주의 필요)
- 위험 상태: 2개 (즉시 점검 필요)
- 평균 이상 점수: 0.34 (정상 범위)

**핵심 게이지 (4개)**
- 배터리 전압: 3.82 V (정상)
- 셀 온도: 34.1°C (주의)
- 충전 전류: 12.7 A (정상)
- SOC (충전 잔량): 81% (정상)

> 절연 저항 게이지는 `insulation_mohm` 필드 제거(2026-07-27)에 따라 삭제했다. 게이지는 5개 → 4개다.

**이상 탐지 요약**
- 탐지 모델 상태: 실행 중
- 활성 이상 항목: 9건
- 오늘 발생 이상: 23건
- 최고 이상 점수: 0.91

**위험도 분포**
- 정상 (0.0–0.3): 112개
- 주의 (0.3–0.6): 11개
- 경고 (0.6–0.8): 3개
- 위험 (0.8–1.0): 2개

### 반응형 웹 UI 기준

- **데스크톱(1200px 이상)**: 좌측 사이드바와 상단 상태 영역을 유지하고, 요약 카드·게이지·차트·이벤트 목록을 다중 컬럼으로 배치해 관제 밀도를 높인다.
- **태블릿(768px 이상)**: 사이드바는 접힘 상태를 기본으로 하고, 주요 카드와 차트는 2컬럼 중심으로 배치한다. 필터·기간 선택·제어 버튼은 터치 가능한 크기로 제공한다.
- **모바일(767px 이하)**: 하단 내비게이션과 단일 컬럼 카드 흐름을 사용한다. 긴급 경고, 현재 이상점수, 알림, Kill-Switch 진입 버튼을 우선 노출하고, 상세 표는 카드 목록/상세 화면으로 전환한다.
- **공통**: 실시간 WebSocket 갱신 중에도 레이아웃 흔들림을 줄이고, 다크모드·명도 대비·키보드 탐색·스크린리더 라벨을 고려한다.

---

## Task 1 공통 생산 계약 결정 (2026-09-15)

다음 경계의 공통 구현 계약을 확정했다. 상세 요청·응답과 불변식의 정본은
[`docs/backend_contract.md` §3.8](docs/backend_contract.md#38-task-1-공통-생산-계약-결정-2026-09-15)이다.

- 관리자 이벤트 추이는 PostgreSQL `domain_event`의
  `ANOMALY_GRADE_CHANGED`만 원천으로 삼는다. 목적지 등급 기준은
  `CAUTION` 0.3 이상, `WARNING` 0.6 이상, `DANGER` 0.8 이상이며,
  정상 해소·릴레이 차단·`UNASSIGNED_DATA`·관리자 감사 이벤트는 F20에 섞지 않는다.
  anomaly 결과의 `(device_id, evaluated_at)`와 event dedupe key로 Kafka replay를 막는다.
- 공지는 `DRAFT` → `PUBLISHED` → `ARCHIVED` 상태 수명주기와
  `ALL`·`USER`·`ADMIN` 대상을 사용한다. 사용자는 게시된 ALL/USER만 보고,
  목록은 본문 앞 120자 summary, 상세는 전체 본문이다. 상세 조회수는 같은
  인증 사용자의 24시간 반복을 제외하며 notice·조회 dedupe·발송 의도는 DB에 둔다.
- `/api/trends`와 `export.pdf`는 동일 집계 서비스·소유권 검증을 공유한다.
  UTC bucket은 `24h=25시간`, `7d=7일`, `30d=30일`, `temp/anomaly=max`,
  `volt/curr/soc=avg`이며 결측은 `null`이다. CSV Raw는 이 집계와 별도다.
- Fail-Safe는 AI와 독립이고 프로필별 가용 센서만 판정한다. 문턱은 배포
  `config/env`에서만 공급하며 0은 해당 계층만 끄는 sentinel이다. mode1
  압력은 10초 baseline 상대 상승률·baseline 500 미만 부착불량 규칙을 쓰고,
  숫자는 실측·승인 전까지 활성화하지 않는다.
- schema/store 확장은 `010_domain_events.sql`, `011_notices.sql`,
  `012_failsafe_profile_and_baseline.sql`에 반영했다. 수치 문턱은 DB에 저장하지
  않고 배포 설정에서 공급한다. memory provider는 테스트 호환용이며 PostgreSQL
  production 경로에는 고정 demo notice/event/trend를 두지 않는다.

## 8. 개발 로드맵

> ### 🔧 인프라(Kafka·PostgreSQL/TimescaleDB) 담당자는 여기서 시작한다
>
> **Phase 1의 Kafka·DB 3줄과 Phase 3 전체**가 인프라 담당자 몫이다 — Phase 2는 에지, Phase 4는 AI, Phase 5~7은 프론트·백엔드다. 착수 전 아래 **순서대로** 읽는다. 뒤 문서가 앞 문서를 전제로 쓰여 있어 순서를 바꾸면 두 번 읽게 된다.
>
> | 순서 | 문서 | 무엇이 있나 |
> |---|---|---|
> | 1 | `docs/implementation_status.md` §2 A-1 | 담당 경계와 완료 판정. **A1~A5가 곧 작업표다.** §3 B군은 백엔드가 어디까지 해뒀고 어디부터 넘어오는지 |
> | 2 | `CLAUDE.md` §Kafka 토픽 규약 · §센서 데이터 JSON 스키마 | 토픽 3개의 발행자·용도, 에지 프레임의 필드와 부호 규약. ⚠️ `advertised.listeners`를 `localhost`로 두면 라즈베리파이가 **조용히** 못 붙는다 |
> | 3 | `docs/handover/infra-implementations.md` | **구현 명세 정본.** 1부 `CellGuardStore`(PostgreSQL) / 2부 `DeviceCommandPort`(Kafka)와 outbox worker. 완료 판정은 계약 테스트·claim/retry 테스트 통과 |
> | 4 | `docs/handover/b2-session-tagging.md` | Consumer가 `device_id` → `battery_id`로 귀속하는 규칙 5개 + 완료 판정 SQL 2건 |
> | 5 | `docs/handover/schema-open-questions.md` | **과거 미결정 6건의 결정 기록.** 해당 DDL은 `backend/migrations/002`~`005`에 반영됐고, Consumer 착수 시 실제 컬럼·제약과 함께 확인한다 |
> | 6 | `docs/verification_matrix.md` | 무엇을 어떻게 검증하면 끝난 것으로 치는지. 백엔드 typecheck·빌드·`/health`·테스트 명령이 여기 있다 |
>
> ✅ **DB는 `npm run db:migrate` 하나로 올라간다(2026-08-28).** 현재 `backend/migrations/000`~`014`가 연속된 파일명 순서로 적용된다. `010_domain_events.sql`, `011_notices.sql`, `012_failsafe_profile_and_baseline.sql`을 포함하며, 실행기는 advisory lock, TimescaleDB 가용성 사전 확인, 완료 후 두 hypertable 확인을 수행한다. 예전에 `psql -f 001_app_auth.sql`이 첫 구문에서 멈추던 문제(`"user"` 테이블 DDL 부재)는 `000_identity.sql`이 해결했다. **`psql -f`로 001만 직접 돌리지 마라** — 순서가 있는 migration 묶음이다. plain PostgreSQL로 강등하지 않는다. `npm run auth:generate`·`auth:migrate`는 CLI 패키지가 없어 실패하니 부르지 않는다(Better Auth는 지금 미사용).
>
> 세부 계약이 필요해지면 — 에러 코드는 `docs/backend_contract.md` §1.10, 원자성 요구는 §3.4, 에지 프레임 정의와 `battery-events`의 code+params는 `docs/hardware/mode1_backend_spec.md` §9·§11이다.
>
> **충돌하면 계약 문서가 정본이고 이 로드맵을 고친다.**

### Phase 1 — 인프라 기반 구축

> **로컬 단일 PC 구성으로 변경(2026-08-25).** EC2 프로비저닝·보안그룹·TLS/SASL 항목은 삭제했다.

- [ ] 호스트 PC에 Kafka 설치·토픽 3개 생성, LAN 한정 PLAINTEXT 구성 (S-BYYPVQ) — `docker-compose.local.yml`에 KRaft·세 토픽·INTERNAL/LOCALHOST/LAN listener 구성을 추가했다. 실제 호스트 실행과 `advertised.listeners` LAN 주소 적용은 인수에서 수행한다
- [ ] 브로커·DB 포트를 방화벽에서 LAN으로 제한 — Compose는 DB/localhost listener/backend를 loopback에 bind하고 LAN listener는 방화벽 제한이 필요하다
- [ ] PostgreSQL + TimescaleDB **설치** (S-NFEETD) — `docker-compose.local.yml`의 pinned TimescaleDB 이미지와 fail-closed migration/backend 검사를 추가했다. 실제 설치·hypertable 적재 인수는 남았다. ⚠️ **스키마를 새로 설계하지 않는다.** `backend/migrations/000`~`012`가 핵심 테이블·진단 progress·raw payload·outbox delivery·domain event·notice·Fail-Safe profile/baseline을 정의하고 `npm run db:migrate`가 적용한다. 하이퍼테이블 전환·보존정책(60일)은 `005_timescale.sql`에 있다. 압축 정책은 재처리 창과 충돌해 **일부러 걸지 않았다**(되살리는 두 줄이 `005` 주석에 있다). 결정 근거는 `docs/handover/schema-open-questions.md`
- [x] 백엔드 프로젝트 초기화 (Node.js + TypeScript + Express)
- [x] Better Auth 기반 사용자 인증 골격 구현 (R-HBLCDS — F-SDSVND, F-TFJKKF, F-HUYIXC)
- [ ] ~~Better Auth 실인증 전환~~ — **보류(2026-08-25 결정).** 코드는 그대로 두고 `AUTH_MODE=demo`로 꺼둔다. 나중에 환경변수만 바꿔 켠다. 데모 계정에 ADMIN이 있어 RBAC·감사로그 시연에는 지장이 없다

### Phase 2 — 에지 데이터 수집
- [ ] Raspberry Pi 센서 드라이버 구현 (S-DPVOCW — I2C/1-Wire/ADS1115 아날로그 추상화, 가스·압력·음향 포함)
- [ ] 100ms 폴링 스케줄러 구현 (S-YUNAFH)
- [ ] 모드별 릴레이 채널 매핑 및 인터락 로직 (S-QPLAYR, S-LWVJRY)
- [ ] 스피커 로컬 음성파일 재생 모듈 및 이벤트-멘트 매핑 구현 (S-VOCALR)
- [ ] 센서 JSON 스키마 정의 및 Kafka 프로듀서 발행 (S-IBQMVJ, S-TNASAB) — **부분 완료: `backend/src/kafka.ts`에 version 1 Zod wire contract와 파티션 키 규칙을 고정. 실제 에지 producer는 미착수**

### Phase 3 — 스트리밍 파이프라인
- [x] Kafka Consumer 구현 → `telemetry_metric` 적재 (S-JGLAAI) — `backend/src/telemetryConsumer.ts`가 version-1 raw frame·`raw_payload`를 transaction으로 적재한다. 실 Kafka/Timescale 인수는 별도다.
- [ ] 배터리 자산/측정 세션 테이블 및 API (S-BATAST, S-MSESSN) — **부분 완료: DDL(`battery_asset`·`measurement_session`·`device`)과 REST 라우트, PostgreSQL `CellGuardStore` 구현이 있다.** 활성 세션은 **설비 전체 1개**이며 `uq_active_session_global`이 강제한다(2026-08-28 확정). 남은 것은 `TEST_DATABASE_URL`을 이용한 실제 DB 인수 검증이다.
- [x] Consumer 적재 시 active 세션 조회 → `battery_id` 태깅 (S-MSESSN) — 처리 시점 DB 조회·세션 밖 `null` 귀속은 `docs/handover/b2-session-tagging.md` 정본과 일치한다.
- [x] 오프셋 커밋 및 재처리 전략 (S-SBCSJU) — DB transaction + safety hook 뒤 manual commit, `(device_id, measured_at)` replay 무해. DB/Kafka 원자성은 주장하지 않는다.
- [ ] 대시보드용 조회 뷰 생성 (S-ROGPIB)
- [x] 오류/예외 이벤트 기록 (S-MVDKKZ) — 영속 `domain_event`와 Kafka replay dedupe를 추가해 `audit_log`(감사)와 분리했다. 실제 Kafka/DB 인수 검증은 별도다.

### Phase 4 — AI 이상 탐지
- [ ] 정상 데이터 수집 및 라벨링 (S-LUTREM)
- [ ] 특징 추출 및 윈도우링 (30 time-steps, LSTM-AutoEncoder·Informer 공통 입력) 파이프라인 (S-WKCPVK)
- [ ] LSTM-AutoEncoder 모델 학습 (F-MAPLGA) — Google Colab
- [ ] Informer 모델 학습 (F-MAPLGA) — Google Colab
- [ ] 체크포인트를 Colab에서 호스트 PC로 내보내는 절차 확정 (파일 형식·특징 버전 표기·저장 위치)
- [ ] **로컬 추론 프로세스** — 호스트 PC에서 체크포인트를 로드해 `battery-raw-metrics` 구독 → AE Score·Informer Score 계산 → Score Fusion → `battery-anomaly-alerts` 발행 (S-FGKMXE, F-VTQMVE). 칼만 필터·내부 셀 온도 추정도 여기서 수행한다
- [ ] 상태 등급 판정 및 이벤트 저장 (S-WJYKSS, S-RMXMCJ)

> **2026-09-15 Task 5 경계 구현:** `ai/`에 v1 계약 validator, artifact
> manifest/scaler/checkpoint fail-closed loader, 외부 inference adapter와 Kafka
> lifecycle/수동 offset commit 골격을 추가했다. 실제 모델 binary·scaler·권위
> feature metadata·score fusion/Kalman/내부 셀 추정 adapter가 제공되기 전에는
> production 기동과 실추론을 `EXTERNALLY_BLOCKED`로 유지한다. 상세 schema와
> 기동 실패 조건은 [`docs/ai_inference.md`](docs/ai_inference.md)다.

### Phase 5 — 웹 대시보드 & 관제
- [ ] React 프로젝트 초기화 및 라우팅
- [ ] 공통 반응형 레이아웃/내비게이션 설계 (데스크톱 사이드바, 태블릿 접힘 메뉴, 모바일 하단 내비게이션)
- [ ] 배터리 자산관리 + 배터리 상세/이력 페이지 (S-BATAST — target_mode 자동 적용)
- [ ] 실시간 대시보드 페이지 (S-OFKBJC — 게이지, 요약 카드, 반응형 카드 그리드)
- [ ] 추세 차트 페이지 (S-AEMMPM — 라이브 차트, 화면 폭별 차트/필터 재배치)
- [ ] 이벤트 이력 및 이상 탐지 관리 페이지 (S-XEVPOF — 데스크톱 테이블/모바일 카드 목록)
- [ ] 관리자 MVP 콘솔: 대시보드, 유저 관리, 배터리 관리, 통계, 디바이스 상태, 감사 로그 (`docs/admin_userflow.md` 기준)
- [ ] 관리자 권한/상태 모델 및 `/admin/*` API

### Phase 6 — 알림 & 차단
- [ ] ~~카카오톡 알림 연동 (S-EOCLMX, S-UZDNPT)~~ — **보류(2026-08-25 결정).** 설정 화면의 채널 토글은 **현행 유지**한다: 저장은 되지만 발송은 일어나지 않으며, 화면에 별도 미구현 표시를 추가하지 않는다. ⚠️ 시연에서 "알림이 간다"고 설명하지 않도록 주의
- [ ] 릴레이/Kill-Switch 제어 API (S-ELAUQJ) — **부분 완료: REST(승인·재인증·사유·멱등성)와 감사 기록, PostgreSQL transactional outbox, Kafka producer/worker(`battery-events` 발행·재시도·배터리별 순서)는 구현됐다.** 남은 건 실제 Kafka/edge relay 인수 검증 — `docs/handover/infra-implementations.md` 2부
- [ ] 긴급 차단 자동화 Fail-Safe (S-VMNNAM) — **비실물 소프트웨어 통합 완료(2026-09-16).** Raw Consumer가 latest session frame만 AI와 독립 판정하고, mode1 압력 10초 baseline을 session ID별 DB에 고정한다. baseline `<500`은 부착 불량 domain event 후 해당 세션 압력 계층을 끈다. `MODE1_EXTERNAL_CELL_V1`·`MODE2_FULL`·`COMBINED_EXISTING_PARTS_V1` 센서 가용성과 `FAILSAFE_*` 배포 문턱을 분리하며 기본값은 전부 `0`이다. 신규 차단의 relay/audit/domain event/outbox는 PostgreSQL transaction 하나로 기록한다. `relay.autoCut`은 Fail-Safe `RELAY_CUT`의 Kafka publish와 outbox `sent_at` ACK가 성공한 뒤에만 발신한다. 이는 실물 relay actuation ACK가 아니며 그 검증은 Task 7에 남는다. 남은 것은 mode1 H8·mode2 H2/H3/H6/H11/H15 실측·승인, 실제 Kafka/DB 및 relay 인수다 — `docs/backend_contract.md` §3.8 및 `docs/handover/infra-implementations.md` §14·§14b
- [ ] 디바이스 음성 안내 웹 설정 및 백엔드 API (S-VOCALR)
- [ ] 알림 설정 및 이력 페이지

### Phase 7 — 통합 테스트 & 로컬 실행 패키징

> **AWS 배포는 삭제(2026-08-25).** 클라우드에 올리지 않으므로 프로비저닝·도메인·HTTPS 항목이 사라지고, 대신 호스트 PC 1대에서 재현 가능하게 묶는 작업이 남는다.

- [ ] 에지→Kafka→DB→AI→대시보드 end-to-end 테스트
- [ ] 이상 시나리오 주입 테스트 (오탐/미탐 검증)
- [ ] KPI 측정 및 성능 튜닝
- [ ] 프론트엔드 production 빌드 → 백엔드가 정적 서빙 (단일 오리진으로 CORS·쿠키 설정 제거)
- [ ] 프로세스 자동 시작·재시작 구성 (Kafka·PostgreSQL·추론·백엔드) — Compose healthcheck/restart 정책과 수동 recovery 절차를 추가했으며, 실제 PC 재부팅·크래시 복구 리허설은 남았다
- [ ] `.env` 템플릿과 시드 데이터 정리 — root/edge/ai `.env.example`과 Compose seed 경로를 추가했으며, 다른 PC 재현은 실제 인수에서 확인한다
- [ ] 시연 시나리오 리허설 (`docs/final_month_strategy.md` 기준)

---

## 9. KPI 및 리스크

### KPI
| 지표 | 목표 |
|---|---|
| 이상징후 탐지 정확도/재현율 | 테스트 시나리오 기준 정의 |
| 경고 발생 지연시간 | 센서 수집 → 알림 (최소화) |
| 데이터 수집 성공률 | 유실률 최소화 |
| 대시보드 실시간 갱신 안정성 | 안정적 갱신 |
| 긴급 차단 동작 성공률 | 인터락 포함 100% |

### 주요 리스크
| 리스크 | 대응 |
|---|---|
| 보조배터리 내부 BMS 정보 접근 불가 | 모드 2 외부 IR 온도 기반 추정으로 대체. `soc_pct`는 **INA226 적산 상대 SOC**로 확정(2026-07-28) |
| 센서 노이즈/캘리브레이션 미흡 | 칼만 필터 전처리, 테스트 시나리오 검증 |
| 실험 환경 안전 | 안전 장비 및 절차 필수 |
| 스트리밍/DB/대시보드 통합 복잡도 | 단계별 phase 분리 개발 |
| ~~Colab 세션 휘발성·런타임 제한~~ | **해소(2026-08-25)** — 추론이 호스트 PC로 내려와 실시간 경로가 Colab에 의존하지 않는다. Colab은 학습 전용이라 세션이 끊겨도 시연에 영향이 없다 |
| ~~에지-AWS 공인망 노출~~ | **해소(2026-08-25)** — 공인망에 노출하지 않는다. Kafka는 LAN 한정 PLAINTEXT + 방화벽 |
| 호스트 PC 단일 장애점 | Kafka·DB·추론·백엔드·웹이 한 대에 몰려 그 PC가 죽으면 전체가 멈춘다. 프로세스 자동 재시작(Phase 7)과 시연 전 리허설로 완화 |
| 로컬 추론 성능 | 호스트 PC에 GPU가 없으면 AE+Informer 추론이 100ms 스트림을 못 따라갈 수 있다. **30 time-step 윈도우라 CPU로도 가능할 것으로 보이나 실측 전이다** — 못 따라가면 추론 주기를 1초로 낮추는 것을 먼저 검토(대시보드 `metrics.tick`이 이미 1초 다운샘플링이다) |

---

## 10. 프로젝트 현황

| 항목 | 수치 |
|---|---|
| 총 요구사항 | 5개 |
| 총 기능 | 17개 |
| 총 스펙 | 33개 |
| 와이어프레임 페이지 | 19개 |
| 완료된 항목 | 0개 (0%) |
| 중요도 High 요구사항 | 4개 |

---

## 11. 변경 이력

### 2026-08-28 — 화면 정본을 v3 프로토타입에서 `frontend/`로 교체

- **화면·동작의 최종본은 `frontend/` 구현이다.** `설계 산출물/셀가드 프로토타입_v3.html`은 더 이상 정본이 아니며 현재 워킹트리에서 삭제된 상태다.
- **충돌 해소 순서가 바뀌었다**: 회로·실물 제약 > **`frontend/` 구현** > 계약서 > `PLAN.md` > 기능정의서·유저플로우. **`frontend/`와 계약서가 어긋나면 계약서를 현실에 맞춰 고친다** — 반대가 아니다.
- 문서 곳곳의 `[v3 실측]` 인용과 "v3의 이 값은 목업이다"류 경고는 **당시 근거 표시이자 여전히 유효한 경고**로 남긴다. *"지금 v3를 보라"*는 뜻이 아니다.
- 상세는 `CLAUDE.md` §충돌 해소 순서·§프로토타입 번들.

### 2026-07-28 (3) — 보조배터리 즉시 진단 기능 신설

"보조배터리에 바로 연결하면 정보·현재 출력량·열화상태를 한자리에서 본다"는 요구를 설계로 확정했다. 정본은 **`docs/hardware/mode2_powerbank_diagnosis_spec.md`**다.

세 요소 중 정보(자산 등록값)와 출력량(INA226)은 이미 있었고, **열화상태가 새로 만든 부분**이다. `docs/backend_contract.md` Q6이 "SOH/RUL 산출 주체 보류"로 열려 있던 항목이 모드 2에 한해 닫혔다.

**이 설계를 좌우한 물리적 사실 세 개**

| 사실 | 결과 |
|---|---|
| **부스트 컨버터가 셀을 가린다** — 완제품 보조배터리는 셀 3.0~4.2V를 출력 5V로 레귤레이션한다 | 출력단 `ΔV/ΔI` 내부저항은 **셀 열화를 반영하지 않는다**(컨버터 출력 임피던스다). `internalResistanceMohm`은 모드 2에서 `null` 확정. 대신 "부하를 걸었을 때의 반응"으로 우회 |
| **정격 Wh는 셀 기준(3.7V×mAh), 측정은 출력단(5V) 기준** | 부스트 효율 η(85~90%)를 보정하지 않으면 **새 배터리도 SOH 85%로 나온다.** η는 제품마다 달라 가정 불가 → **그 자산의 첫 정밀 테스트를 기준선으로 삼은 상대 SOH를 신뢰값**으로, η 가정 기반 절대 SOH는 참고값으로 분리 |
| **모드 2 `soc_pct`는 시작을 100%로 가정한 상대값** | 진단 시작 시 실제 잔량을 모른다. 잔량이 이탈점·발열을 모두 오염시키므로 **빠른 진단은 절대 SOH를 내지 않고 신뢰도 `LOW` 고정** |

**확정한 것**

| 항목 | 결정 |
|---|---|
| 열화 측정 | **2단계.** 빠른 진단(약 100~160초, 신뢰도 낮음) + 정밀 용량 테스트(수 시간, 신뢰도 높음) |
| 빠른 진단 지표 | 부하 계단 스윙 0.5→1.0→1.5→2.0A로 **① 레귤레이션 이탈 전류**(출력이 경부하 기준값의 94% 아래로 무너지는 최소 전류) **② 발열 기울기**(1.5A 40초 구간 최소자승) **③ 스펙 도달률** |
| 정밀 테스트 | 1.0A 정전류 방전으로 `∫V·I dt` 적산. **완충 확인 게이트 필수**, 중단된 부분 결과는 SOH로 쓰지 않음 |
| 정보 출처 | **등록값 + 실측값 조합.** PD 컨트롤러(FUSB302) 추가 구매 없음 — ZY12PDN은 버튼식 범용 트리거라 Pi에 값을 못 넘긴다 |
| 진입 흐름 | **기존 T2 게이트 유지.** 자산 등록 → 선택 → 세션 시작은 그대로이고, 그 위에 전용 요약 영역(F21)을 더한다 |
| 프로토타입 기본 상태 | **`COMBINED_EXISTING_PARTS_V1` 안전 준비 전·실행 잠금.** 미지원 센서·SOC·진단 단계는 `—`로 표시하고 확인 입력으로 우회할 수 없다. 숨은 프로토타입 속성에서만 `MODE2_FULL` 실행·진행·중단·이력을 검토하며, 실제 제품은 서버 `diagnosisCapability`가 정본이다 |
| 산출 불가 | 모드 2의 `cycleCount`·`rulCycles`·`internalResistanceMohm`은 **`null` 확정.** BMS 접근 불가 + 부스트 뒤라 원리적으로 못 낸다. **v3의 `RUL ~480 사이클`은 목업 숫자다** |
| 스키마 | `battery-raw-metrics`에 `diag_phase`·`load_target_a` 추가. 진단 이벤트는 **새 토픽 없이** `battery-events`에 싣는다 |
| AI 취급 | `diag_phase != null` 프레임은 **정상패턴 학습에서 제외.** 이상점수는 계속 산출하되 **알림만 억제**하고 Fail-Safe는 억제하지 않는다 |
| 계약서 | **F21·T16 신설, REQ-WEB-137~143 신설.** `tools/contract_lint.py`의 영역·REQ 목록과 게이트·불변 하한을 함께 올렸다 |

**부하 수단·릴레이 매핑 확정 (2026-07-28 재검토)**

같은 날 사용자가 보유한 **ATORCH BW150 WiFi Standard Edition** 제품 사진을 제시해 재검토했고, **초판의 "BW150은 수동 설정이라 자동화 불가" 판단이 틀렸음이 확인됐다.**

| 항목 | 확정 |
|---|---|
| **부하 수단** | **보유한 BW150을 쓴다.** ATORCH 시리얼은 양방향이라 `1250MA`(정전류)·`ON`/`OFF`·`10.5VCUT`이 들어간다([`tshaddack/dl24`](https://github.com/tshaddack/dl24)). `CLAUDE.md`의 *"데이터 경로가 아니다"*는 **텔레메트리가 1초라 100ms 스트림에 못 섞인다**는 뜻이지 제어 불가가 아니며, 애초에 *"방전 부하"*로 지정돼 있었다. **부품 추가 구매 없음** |
| **WiFi 에디션의 이득** | ① `USB 절연 없음` 문제가 사라진다(그건 CH340G 유선을 꽂을 때의 문제다) ② 기기 자체 컷오프 `<03.0V><04.2V><0150W><100°C`가 소프트웨어와 **독립된** 안전층이 된다 |
| **핵심 재구성** | **정밀 용량 테스트는 자동화가 아예 필요 없다** — 단일 고정 전류를 몇 시간 거는 것이라 1.0A 한 번 걸면 끝이다. 계단 스윙이 필요한 건 빠른 진단뿐이므로 BW150이 더 가치 있는 절반을 코드 없이 해낸다 |
| **릴레이 매핑** | **모드 1과 동일** — CH1 충전(GPIO5)·CH2 방전(GPIO6)·CH3 마스터(GPIO13)·CH4 예비(GPIO19). **인터락 코드를 한 벌로 유지**하려는 것이며 안전 로직에서 두 벌은 곧 버그다. CH1을 남기는 별도 이유는 **충전 전류 테이퍼 관측으로 완충을 기계 판정**할 수 있어서다 |
| **무부하 자동 차단** | 보조배터리는 수십 mA 이하가 10~30초 지속되면 출력을 스스로 끊는다. **P0·P5를 무부하가 아니라 최소 유지 부하 0.1A로 바꿨고**, 기준전압도 `vOpenCircuitV` → **`vLightLoadV`**(경부하 출력전압)로 고쳤다. 진짜 무부하로 두면 0V를 읽는다 |

**✅ BW150의 5V 부하 가능 여부(V1) 통과 — 제조사 사양표 확인 (2026-07-28)**

한때 보드 실크스크린의 `input 8V<V<36V` 때문에 5V 보조배터리를 못 물릴 가능성이 회로도 착수를 막고 있었다. **제조사 사양표로 해소됐다.**

| 항목 | BW150 사양 | 우리가 쓰는 값 | 여유 |
|---|---|---|---|
| 부하 전압 | **DC 1V ~ 200V** (사양서에 *"1V 배터리를 테스트할 수 있으며"* 명시) | 5V | 범위 한가운데 |
| 부하 전류 | 전압<5V → `0.01~20A` / 전압>5V → `0.01~25A` | 0.1 ~ 2.0A | **10배 이상** |
| 부하 전력 | 전압<36V → **150W** | 최대 **10W** | **15배** |
| 설정 분해능 | **0.01A** | 계단 0.5A · 미세 스윕 0.1A | 10배 |

최소 전류 `0.01A`라 §2-6의 최소 유지 부하 0.1A가 하한의 10배로 안정적이고, 분해능 0.01A라 P6 미세 스윕도 그대로 된다. ⚠️ **다만 `8V<V<36V` 표기가 붙은 단자에 보조배터리를 물리면 사양 밖**이니 배선 시 부하 입력 단자를 정확히 식별해야 한다(조립 지침).

**→ `hardware/mode2/` 회로도를 막는 항목이 없어졌다.**

**✅ 모드 2 배선 확정 (2026-07-28)** — 상세는 `mode2_powerbank_diagnosis_spec.md` §2-7

| 항목 | 확정 |
|---|---|
| 방전 경로 | **USB-A 출력 포트.** CC 5.1kΩ 풀다운이 필요 없다(USB-C였으면 없이는 `VBUS`가 0V) |
| 충전 경로 | **별도 입력 포트**(USB-C/micro) ← ZY12PDN 5V |
| 션트 | **R010 (0.01Ω) → CAL 2560.** 0.1~2.0A에서 상한 3.3배 여유, 분해능 충분 |
| INA226 | **1개(`0x40`).** CH4로 두 포트를 번갈아 본다 — 충·방전 모두 측정되고 부호도 저절로 맞는다(방전 음수·충전 양수) |
| CH4 | **예비 → 포트 선택.** CH1·CH2·CH3는 모드 1과 동일해 **안전 인터락 코드는 한 벌로 유지**된다. CH4는 안전 채널이 아니라 측정 경로 선택기이며 안전은 CH3가 전담한다 |
| ⚠️ **`VBUS` 탭 위치** | **CH4 앞(출력 포트)에 직결.** 모드 1처럼 `IN−`와 같은 점에 물면 릴레이 접점 저항(50~100mΩ)이 2A에서 100~200mV를 먹는데, 이탈 판정 문턱이 300mV라 **문턱의 1/3~2/3를 릴레이가 삼킨다.** 모드 1과 갈리는 유일한 배선이다 |
| ⚠️ **CH4 냉전환** | CH1·CH2 차단 → CH3 차단 → 50ms → CH4 전환 → 50ms → 복구. **전류 중 전환하면 아크로 접점이 타서** 위 문제가 되돌아온다 |
| ⚠️ **케이블 규격** | **20cm 이내·20AWG 이상.** 28AWG 1m면 2A에서 800mV가 떨어져 문턱의 2.7배 — 멀쩡한 배터리가 열화로 나온다. INA226은 브레이크아웃 바로 옆에, 긴 배선은 전부 `IN+` 하류에 |
| GND | 출력 포트 GND **한 가닥만** 스타점에. 충전 귀환도 팩 내부를 거쳐 여기로 나온다(입력 포트 GND를 또 물면 그라운드 루프) |

**미해결 — 실물을 봐야 닫힌다**

`mode2_powerbank_diagnosis_spec.md` §8에 H1~H14로 모아 두었다. **회로도를 막는 건 이제 없다.**

배선 확정에 따라 신설된 것 — **H11** MQ-2 배치 거리(⚠️ 히터 발열이 열화 지표인 발열 기울기를 오염시킨다. 모드 1이 가스를 뺀 바로 그 이유), **H12** USB-A `D+`/`D−` 처리, **H13** USB-C 입력이 맨 5V 충전을 받는가, **H14** 릴레이 접점 저항 실측.

- **H1** — BW150 부하 입력 단자 실물 식별 + V2(DL24 명령셋 호환)·V3(Tuya 제어). **V2·V3는 실패해도** 사람이 돌리고 파이가 INA226 전류에서 계단을 검출하는 방식으로 우회된다
- **H2** 표면온도 중단 문턱(케이스가 열을 막아 셀 70°C에 표면 45°C가 가능 — 모드 1의 55/60°C를 쓰면 안 된다), **H3** 발열 기울기 문턱 `S1`, **H4** 부스트 효율 η 기본값(현재 가정 0.88), **H6** MQ-2 가스 임계, **H7** 컷오프 회복 판정 시간, **H8** 광고 정격 전류 입력 방식, **H9** 최소 유지 부하 크기와 자동 차단 시간, **H10** 보조배터리 입출력 포트 구성
- **H5**(릴레이 매핑)는 위에서 닫혔다

### 2026-07-28 (2) — 하드웨어 미해결 항목 일괄 확정

문서로 정할 수 있는 하드웨어 결정을 전부 닫았다. 남은 건 실물 확인뿐이다.

| 항목 | 확정 내용 |
|---|---|
| **모드 2 `soc_pct`** | **INA226 적산 상대 SOC.** 시작 시점 100% 가정, `capacity_wh`를 분모로 방전 Wh 감산. 모드 2 배터리는 **용량 입력 필수**. 절대 SOC가 아니며 세션 단위로만 유효 |
| **ADS1115 채널 배분** | 모드마다 아날로그 센서 1개씩 → **A0만 사용, ADS1115 1개로 충분(추가 구매 불필요)**. 모드 1=압력, 모드 2=가스 |
| **모드 1 가스 센서** | **안 단다.** MQ-2 히터(150mA@5V 상시 발열)가 셀 온도 센서 4개와 실온 센서를 오염시킨다. `gas_raw`는 모드 1에서 `null` 고정 → 모드 1의 사후 대응 계층은 **압력 단독** |
| **음향 센서** | **도입 안 함.** AE는 100kHz~1MHz라 ADS1115로 원리적 불가. `acoustic_raw` **필드만 유지**하고 항상 `null` |
| **INA226 `Current_LSB`** | **0.0002 A (상한 6.55A).** 실제 상한은 셀 스펙이 아니라 PCM trip(4~10A)이 정한다. CAL: R010=2560, R002=12800 |
| **`current_a` 부호** | **유지**(양수=충전). 프론트만 표시 시 `abs()` + 방향 라벨 |
| **`voltage_v` 보정** | **보정 없음**(2026-07-31 정정). 셀 −가 곧 시스템 GND이고 BQ27441 센스 저항 `R11`(10mΩ)은 배터리 **+** 쪽 하이사이드라, 옛 20mΩ 보정식은 없는 오차를 만들어 넣는다 |
| **`age_ms` 신선도 필드** | **도입.** DS18B20은 12비트 유지(9비트 안 기각 — 0.5°C가 초기 상승을 계단 노이즈로 만든다) |
| **압력 임계** | **baseline 대비 상대 상승률.** 세션마다 시작 10초 중앙값으로 재산출 |

### 2026-08-06 결정 반영

- Q27: 전압·전류·SOC 배지는 임계값을 아직 계산하지 않으며 `status=null`로 둔다.
- Q35: 세션 무수신 타임아웃은 5분으로 확정한다.
- Q36: F21 진단 문턱값은 모두 `0`을 **미설정 sentinel**로 저장한다. 미설정 계층만 비활성화하며 진단 실행 잠금과 Fail-Safe 물리 차단 문턱은 `docs/backend_contract.md` §3.8의 별도 계약을 따른다.
- Q37: `rated_output_current_a`는 모드 2 자산 등록·수정 시 필수 입력이다.
- Q38: 상태 사유와 관리자 메모는 각각 필수/선택 입력과 별도 요청·별도 감사 레코드로 저장하며 기본 최대 길이·문자 정규화·버전 충돌 정책은 백엔드 계약의 기본값을 따른다.
- Q6: 모드 1 SOH/RUL은 백엔드가 BQ27441 원시/집계값으로 계산한다. 모드 2의 미지원 건강도는 계속 `null`이다.
| **MLX90614 필터** | **`IIR=100`, `FIR=111`**(1024탭, 95.2ms). 노이즈를 키우며 창당 2샘플을 얻지 않는다 |
| **열화상 배열(MLX90640)** | **도입 안 함.** 셀 온도는 MLX90614 1존 + DS18B20 3점 = 4점, MLX90614 #2는 실온(2026-09-25 변경 — 예전 2존 + 3점 = 5점) |
| **계측 허용 오차** | 전류 ±2%/±20mA, 전압 ±30mV, 전력 ±3%, SOC 사이클 적산 ±10% |

**같은 날 실물 확인으로 H9·H10도 닫혔다** — 셀에 보호회로가 있고, Babysitter 실크스크린은 회로도 네트 이름과 일치한다. **남은 것은 전원을 넣어야 답이 나오는 8건**(`mode1_backend_spec.md` §13 H1~H8).

H9가 닫히면서 따라온 조치: 18650 홀더를 **보호회로 셀용(68~70mm)**으로 사야 하고, 센서 축방향 기준을 전체 길이가 아니라 **금속 캔 몸통 `L`**로 잡으며, **니켈 탭이 지나가는 면을 피해** 센서를 부착한다.

### 2026-07-28 (1) — 모드 1 회로에서 직렬 퓨즈 제거, 과전류 보호를 셀 보호회로에 위임

모드 1 회로도와 초보자 가이드에 있던 **폴리퓨즈 F1은 구매 승인 목록에 없던 부품**이었다(이 문서의 확정 목록·미확보 목록 어디에도 없음). 새로 사지 않고 **회로에서 제거**하기로 확정했다.

| 변경 | 내용 |
|---|---|
| **F1 삭제** | `tools/gen_mode1_sch.py`에서 `POLYFUSE` 심볼·인스턴스 제거. `CELL_P_F` 네트가 없어지고 셀 +는 `CELL_P` 한 노드로 INA226 `IN−`·`VBUS`에 직결된다. ERC 위반 0건 재확인 |
| **과전류 보호 정책** | 회로 내 보호 소자 없음. **셀에 붙은 보호회로(PCM)에만 의존한다** |
| **조립 전 확인 5가지 → 6가지** | 가이드에 `§3-⑥ 셀에 보호회로가 붙어 있는가`를 추가. 이제 이게 유일한 과전류 방어선이라 선택이 아니라 필수 검사다 |

✅ **전제 확인됨 (2026-07-28)**: 구매한 셀에 보호회로가 있다. 퓨즈를 뺀 이 결정은 성립한다. 파생 조치는 위 `2026-07-28 (2)` 항목 참조.

### 2026-07-27 — 구매 확정 부품 반영, 측정 모드 3 → 2 축소

승인된 구매 목록(디바이스마트 15품목 + ATORCH BW150)을 기준으로 하드웨어 가정을 정정했다.

| 변경 | 내용 |
|---|---|
| **측정 모드 3 → 2** | 구 `모드 1 — 라즈베리파이 내장 배터리` 삭제(해당 배터리 미확보). 구 모드 2·3 → 신 모드 1(외부 셀)·2(보조배터리). 이전 판본의 `모드 3`은 전부 신 `모드 2`를 가리킨다 |
| **`insulation_mohm` 제거** | 절연저항 측정 소자를 확보하지 않아 센서 스키마·API·대시보드에서 삭제. 대시보드 핵심 게이지 5개 → **4개** |
| **압력센서 FSR-402 → FSR 406** | Solder Tabs 버전. 분압용 고정저항이 별도로 필요하다 |
| **충전모듈 TP4056 → SZH-MIN002** | USB-C 5V 2A 충방전 일체형 |
| **전자부하 U6214 → ATORCH BW150** | 방전 부하 + INA226 검증용 기준기. **데이터 경로가 아니다**(1초 주기·USB 절연 없음) |
| **SOC 출처 명시** | BQ27441은 단품이 아니라 SparkFun Battery Babysitter [PRT-13777] 탑재분. 배터리마다 Design Capacity 재설정 필요 |
| **동시 측정 1개 확정** | BQ27441(0x55) 주소가 하드웨어 고정이라 다중 배터리 불가. 멀티플렉서 미도입. **MLX90614는 주소 고정이 아님**(EEPROM 0x0E) — 2026-07-27 데이터시트 재확인으로 정정 |
| **신규 부품** | 0.96" OLED(CN0219, **SPI**) → **3.5" TFT SPI 480×320 V1.0(ILI9488)로 교체(2026-08-05)**, 18650 3.7V 2550mAh ×3, 리튬폴리머 3.7V 1000mAh ×2 |

**과거 미해결 항목의 종료 기록**: 모드 2의 `soc_pct` 출처, 가스·압력·음향 채널 배분, 음향 센서 모델은 **2026-07-28에 모두 확정됨** (아래 항목 참조).

**유지**: 스피커 음성 안내(F-VOICEA·S-VOCALR·REQ-WEB-072)와 음향 센서는 기능으로 유지하되 하드웨어는 별도 확보한다.
