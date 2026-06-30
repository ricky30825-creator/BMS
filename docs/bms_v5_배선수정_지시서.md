# BMS 회로 배선 수정 지시서 (기존 v4 도면에 적용)

> 기존 `bms_v5.kicad_sch`(실제 심볼 도면)를 그대로 쓰고, **아래 핀들만 다시 잇습니다.**
> 기준: 원본 `bms_v5.net`의 현재 연결 ↔ 수정 목표. 핀 번호는 넷리스트 기준입니다.
> KiCad에서 작업: 해당 선(네트) 선택 → 삭제 → 새 라벨/와이어로 다시 연결.

## 표기
- ✅ **그대로 OK** — 손대지 않음
- ⚠️ **변경** — 지금 네트에서 떼어 목표 네트로 옮김
- 🔴 **치명적** — 안 고치면 합선/손상

---

## 0. 먼저 새 네트 이름 4개를 만들어 두세요
기존엔 `RP_InPut_5V`(3V3+5V 혼합)와 `mode2_InPut`(거대 GND 합선) 두 개로 뭉쳐 있습니다. 이걸 아래로 분리:

| 새 네트 | 용도 |
|---|---|
| `+3V3` | 3.3V 센서 전원 |
| `+5V` | 5V (릴레이 코일·충전 입력) |
| `GND` | 공통 접지 |
| `BAT+` | 배터리 양극(측정 대상 셀 +) |
| `MEAS+` | 릴레이로 선택된 소스 → INA226 Vin+ |
| `VIN-` | INA226 Vin− → 부하 |

---

## 1. 🔴 전원 합선 풀기 — `RP_InPut_5V` 를 +3V3 / +5V 로 쪼개기
현재 J1의 3V3핀과 5V핀이 같은 네트라 **Pi의 3.3V·5V 레일이 직접 단락**입니다.

| 부품·핀 | 현재 | →목표 |
|---|---|---|
| J1 pin1 (3V3) | RP_InPut_5V | ⚠️ **+3V3** |
| J1 pin17 (3V3) | RP_InPut_5V | ⚠️ **+3V3** |
| J1 pin2 (5V) | RP_InPut_5V | ⚠️ **+5V** |
| J1 pin4 (5V) | RP_InPut_5V | ⚠️ **+5V** |
| J3 Relay pin1 (VCC) | RP_InPut_5V | ⚠️ **+5V** (릴레이 코일) |
| ChargeModule1 TP4056 pin5 (IN+, 5V입력) | Battery_InPut_5V(떠있음) | ⚠️ **+5V** |
| PowerSensor1 INA226 pin6 (VS) | RP_InPut_5V | ⚠️ **+3V3** |
| FuelGauge1 bq27441 pin3 (VCC) | RP_InPut_5V | ⚠️ **+3V3** 🔴 (bq27441 최대 3.6V — 5V 닿으면 파손) |
| TemperatureSensor1 DS18B20 pin3 (VDD) | RP_InPut_5V | ⚠️ **+3V3** |
| TemperatureSensor2 MLX90614 pin1 (VCC) | RP_InPut_5V | ⚠️ **+3V3** |

> 핵심: 3V3 센서군과 5V(릴레이·충전)군을 **다른 네트로**. I2C 디바이스는 전부 3V3여야 SDA/SCL 로직이 3.3V로 유지돼 Pi가 안전합니다.

---

## 2. 🔴 거대 합선 풀기 — `mode2_InPut` 분해
이 네트 하나에 **배터리 +/−, INA226 측정 입력, 릴레이 접점, 충전기 B+, 연료게이지 BAT+, 부하**가 전부 GND로 묶여 있습니다. 진짜 GND인 핀만 남기고 나머지는 전부 떼어내야 합니다.

### 2-1. GND로 **그대로 둘** 핀 (✅ 이건 정상)
J1 GND(6·9·14·20·25·30·34·39), J3 pin2(GND), INA226 pin7(GND), DS18B20 pin1(GND), MLX90614 pin2(GND) → **`GND`로 유지**

### 2-2. 배터리 / 충전 / 연료게이지 — GND에서 떼어내기
| 부품·핀 | 현재 | →목표 |
|---|---|---|
| BT1 Battery_Cell pin1 (+) | mode2_InPut(GND) | 🔴 **BAT+** — 지금 배터리 +/−가 같은 네트라 **셀 직접 단락**! |
| BT1 pin2 (−) | mode2_InPut | ✅ **GND** (유지) |
| FuelGauge1 bq27441 pin1 (BAT+) | mode2_InPut(GND) | ⚠️ **BAT+** (BT1+ 전압 센스) |
| FuelGauge1 pin2 (BAT−) | mode2_InPut | ✅ **GND** |
| FuelGauge1 pin4 (GND) | mode2_InPut | ✅ **GND** |
| ChargeModule1 TP4056 pin1 (B+) | mode2_InPut(GND) | ⚠️ **BAT+** |
| ChargeModule1 pin2 (B−) | mode2_InPut | ✅ **GND** |
| ChargeModule1 pin3 (OUT+) | mode2_InPut(GND) | ⚠️ **MODE1_SRC** (모드1 소스 = TP4056 출력) |
| ChargeModule1 pin4 (OUT−) | mode2_InPut | ✅ **GND** |

### 2-3. 🔴 INA226 측정 입력 — GND에서 떼어 측정 경로로
지금 Vin+ / Vin− 4핀이 전부 GND라 **전류 측정 불가 + 단락**. **션트 저항**을 Vin+ ↔ Vin− 사이(배터리 경로 직렬)에 넣고:

| INA226 핀 | 현재 | →목표 |
|---|---|---|
| pin10 B_Vin+ | mode2_InPut(GND) | 🔴 **MEAS+** (션트 高측) |
| pin12 G_Vin+ | mode2_InPut(GND) | 🔴 **MEAS+** |
| pin9 B_Vin− | mode2_InPut(GND) | 🔴 **VIN-** (션트 低측→부하) |
| pin11 G_Vin− | mode2_InPut(GND) | 🔴 **VIN-** |
| pin1 A1 | mode2_InPut(GND) | ✅ **GND** (I2C 주소 0x40) |
| pin2 A0 | mode2_InPut(GND) | ✅ **GND** |
| pin3 Alert | mode2_InPut(GND) | ⚠️ GND에서 떼기 (미사용 또는 4.7k 풀업→3V3) |

> 💡 더 간단한 대안: 바 INA226 칩 대신 **션트 내장 INA226 브레이크아웃(CJMCU-226 등)** 으로 교체하면 Vin+/Vin−만 배터리 경로에 직렬로 끼우면 끝(외부 션트·캡 불필요).

### 2-4. 릴레이 접점 — GND에서 떼어 모드 절체로
지금 NO/COM이 전부 GND. 각 채널을 "모드 소스(+) → 공통 측정버스(MEAS+)" 절체로:

| 릴레이(값) | 핀 | 현재 | →목표 |
|---|---|---|---|
| J4 Relay_CH1 (모드1) | NO | mode2_InPut(GND) | ⚠️ **MEAS+** |
| J4 | COM | mode2_InPut(GND) | ⚠️ **MODE1 소스+** (내장배터리/TP4056 OUT+) |
| J6 Relay_CH2 (모드2) | NO | mode2_InPut(GND) | ⚠️ **MEAS+** |
| J6 | COM | mode2_InPut(GND) | ⚠️ **BAT+** (외부셀+) |
| J5 Relay_CH3 (모드3) | NO | mode2_InPut(GND) | ⚠️ **MEAS+** |
| J5 | COM | mode2_InPut(GND) | ⚠️ **MODE3 소스+** (ZY12PDN 출력) |
| J4·J5·J6 | NC | /NC (셋이 묶임) | 미사용으로 분리(각자 떼기) |

### 2-5. 부하 / PD 트리거
| 부품·핀 | 현재 | →목표 |
|---|---|---|
| J2 load_tester pin1 | mode2_InPut(GND) | ⚠️ **VIN-** (INA226 Vin−와 연결) |
| J2 pin2 | mode2_InPut | ✅ **GND** |
| PD_triger1 ZY12PDN pin2 (V+ 출력) | mode3_InPut(떠있음) | ⚠️ **MODE3_SRC** |
| PD_triger1 pin1·pin3 (V−) | mode2_InPut(GND) | ✅ **GND** |

---

## 3. ✅ 손대지 않아도 되는 부분 (이미 정상)
- **I2C SDA**: J1 pin3 ↔ INA226 pin4 ↔ bq27441 pin5 ↔ MLX90614 pin3
- **I2C SCL**: J1 pin5 ↔ INA226 pin5 ↔ bq27441 pin6 ↔ MLX90614 pin4
- **릴레이 제어**: J1 pin7→IN1, pin29→IN2, pin31→IN3 ↔ J3
- **1-Wire**: J1 pin24 ↔ DS18B20 pin2(DQ)

---

## 4. 부품 추가 (빠져 있음)
| 부품 | 값 | 연결 |
|---|---|---|
| R(추가) | 4.7k | SDA ↔ +3V3 (I2C 풀업) |
| R(추가) | 4.7k | SCL ↔ +3V3 (I2C 풀업) |
| R(추가) | 4.7k | DS18B20 DQ ↔ +3V3 (1-Wire 풀업) — **필수** |
| 션트저항 | 수~수십 mΩ | INA226 Vin+ ↔ Vin− (배터리 경로 직렬) — *브레이크아웃 쓰면 불필요* |

---

## 5. ✅ 확정된 가정 (핀 순서·동작)
- **TP4056(ChargeModule1)** 5핀: **`1=B+, 2=B−, 3=OUT+, 4=OUT−, 5=IN+(5V)`** 로 확정.
  - TP4056은 외부셀(BT1)을 충전: B+→BAT+, B−→GND, IN+→+5V, IN−는 GND 공유.
  - OUT+ → `MODE1_SRC`(모드1 소스). *Pi 내장 배터리에 별도 탭이 있으면 그걸 J4 COM에 연결하고 OUT+는 미사용으로 두세요.*
- **ZY12PDN(PD_triger1)** 3핀: **`pin2=V+(출력), pin1·3=V−`** 로 확정 (넷리스트상 pin2만 별도 노드였음).
  - pin2(V+) → `MODE3_SRC`, pin1·3 → GND.
- **릴레이 = 모드 절체용**으로 확정. 각 채널이 "해당 모드 소스(+) → 공통 측정버스(MEAS+)"를 절체하고, 소프트웨어 인터락으로 한 번에 한 채널만 ON.
  - CH1(J4)=모드1(MODE1_SRC), CH2(J6)=모드2(BAT+/외부셀), CH3(J5)=모드3(MODE3_SRC).

> 실제 보드 실크(특히 TP4056)가 위 핀 순서와 다르면 그 부품만 핀 번호를 맞춰 바꿔주세요. 나머지 네트 목표는 동일합니다.
