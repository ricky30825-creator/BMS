# 모드 1·2 통합 회로 — STEP 12 이후 작업서

이 문서는 [`mode1_beginner_guide.md`](mode1_beginner_guide.md)의 **STEP 12까지 완료한 회로**를 뜯지 않고, 현재 보유한 INA226 1개와 4채널 릴레이 1개로 다음 두 전력 경로를 한 장치에 넣는 작업서다.

- **모드 1**: 외부 셀 충전·방전·계측 전체
- **모드 2**: 외부 충전기로 완충한 USB 보조배터리의 **방전 계측 경로와 0.5A 시운전**

모드 2의 판정 계약은 [`mode2_powerbank_diagnosis_spec.md`](mode2_powerbank_diagnosis_spec.md)를 따르되, 이 보유부품형 회로에는 **모드 2 자동 충전 경로·충전전류 측정·MQ-2 가스 안전계층이 없다.** 따라서 현재 프로필 이름은 `COMBINED_EXISTING_PARTS_V1`이며, **빠른 진단과 정밀 용량시험을 아직 실행하지 않는다.** 이 문서는 배선과 0.1A→0.5A·10초 전기 시운전까지만 허용한다.

> ⚠️ 이 문서는 STEP 13부터 기존 모드 1 가이드를 대신한다. **기존 가이드의 STEP 14를 그대로 배선한 뒤 이 문서로 돌아오면 안 된다.**

## 0. 이 구성의 한계

| 항목 | 지원 여부 | 이유 |
|---|---|---|
| 모드 1 충전·방전 | 지원 | CH1·CH2·CH3과 Babysitter를 그대로 사용 |
| 모드 2 방전 계측 경로 | 지원 | INA226과 BW150으로 출력 방전을 측정 |
| 모드 2 빠른 진단·정밀 용량시험 | **차단** | MQ-2와 확정된 안전 문턱·연속 감시 프로그램이 없어 `SAFETY_PROFILE_NOT_READY` |
| 모드 2 자동 충전 | **미지원** | CH4를 모드 선택에 사용하므로 입력 포트 선택 경로가 없음 |
| 모드 2 충전 테이퍼로 완충 판정 | **미지원** | 외부 충전기와 사용자 확인으로 대체 |
| 모드 2 MQ-2 가스 안전계층 | **현재 미구현** | STEP 12 상태에서 ADS1115 A0는 FSR이 사용하며, 5V AOUT용 추가 분압부품이 없음 |
| 셀과 보조배터리 동시 연결 | **작업 절차로 금지** | 하드웨어 인터락은 없으며, `SOURCE_P`에는 한 번에 양극 한 가닥만 체결 |

따라서 이 회로는 **모드 1 전체 + 모드 2 방전 계측 프로토타입**이다. 모드 2의 MQ-2 독립 안전계층이 없으므로 제품 F21 진단으로 승격하지 않는다.

## 1. STEP 12까지 유지하는 배선

다음은 손대지 않는다.

- STEP 1~10의 3.3V·신호 GND·I2C·1-Wire·TFT·센서 배선
- STEP 9의 릴레이 제어선과 R3~R6 10kΩ 풀업
- STEP 11의 `ZY12PDN VOUT+ → CH1 COM`
- STEP 12의 `Pi 핀 2(5V) → JD-VCC`

릴레이 역할만 다음처럼 확정한다.

| 채널 | GPIO | 통합 회로 역할 |
|---|---:|---|
| CH1 | GPIO5 | 모드 1 충전 |
| CH2 | GPIO6 | 모드 1 방전 |
| CH3 | GPIO13 | 두 모드 공용 마스터 차단 |
| CH4 | GPIO19 | `OFF/NC`=모드 1, `ON/NO`=모드 2 방전 |

## 2. 전체 전력 경로

```text
■ 교체식 측정 입력 — SOURCE_P 단자에는 아래 양극 중 하나만 체결

  모드 1: 외부 셀 + ─────┐
                         ├── SOURCE_P ── INA226 IN−
  모드 2: USB-A VBUS ────┘                  │ R010 션트
                                            └─ INA226 IN+ ── CH3 COM

  INA226 VBUS ─────────── SOURCE_P

■ CH3 뒤에서 CH4가 모드를 선택

  INA226 IN+ ── CH3 NO ── CH4 COM
                              ├─ CH4 NC ── Babysitter BAT+   [모드 1]
                              └─ CH4 NO ── BW150 부하 +      [모드 2]

■ 모드 1의 기존 충·방전 경로

  ZY12PDN + ── CH1 ── Babysitter VIN
  Babysitter SYS+ ── CH2 ── BW150 부하 +

■ 음극

  외부 셀 − ───────── Babysitter BAT− 한 점
  보조배터리 GND ──── 전력 GND 스플라이스
```

`BW150 +`에는 CH2 NO와 CH4 NO 두 선이 함께 붙는다. **CH2 NO와 CH4 NO가 동시에 BW150+로 연결되는 상태**를 만들지 않는다. 모드 1 방전에서는 CH2 NO와 CH4 NC가 닫히는 것이 정상이며, 아래 허용 상태표를 기준으로 판단한다.

## 3. 배선 전 중단 게이트

하나라도 통과하지 못하면 STEP 13으로 가지 않는다.

| ☐ | 확인 | 통과 기준 |
|---|---|---|
| ☐ | 라즈베리파이와 USB-C 어댑터 | 둘 다 분리 |
| ☐ | 외부 셀 | 홀더가 비어 있음 |
| ☐ | 보조배터리 | USB 케이블이 빠져 있음 |
| ☑ | INA226 션트 실크스크린 | **`R010`** — 사용자 실물 확인, 2026-08-05 |
| ☐ | CH4 단자 식별 | 무전원 도통검사로 COM·NC·NO를 표시 |
| ☑ | USB-A 출력 케이블 | **20cm 이하·20AWG 이상** — 사용자 실물 확인, 2026-08-05 |

> 실물 션트와 케이블을 교체하면 위 확인은 무효다. 다시 확인해 인계표의 날짜와 값을 갱신한다.

---

# 4. 통합 2단계 — 전력부와 무배터리 검사

## STEP 13. Babysitter 전력부

기존 모드 1 STEP 13과 같다. 모두 0.75SQ 전력선이다.

| ☐ | 어디서 | → | 어디로 |
|---|---|---|---|
| ☐ | CH1 NO | → | Babysitter `VIN` |
| ☐ | Babysitter `GND_IN` | → | 전력 GND 스플라이스 자리, 끝 절연 |
| ☐ | Babysitter `SYS+` | → | CH2 COM |
| ☐ | Babysitter `SYS−` | → | 전력 GND 스플라이스 자리, 끝 절연 |

**확인**: `GND_IN`·`SYS−`는 신호 GND 레일이 아니라 스플라이스 자리에서 대기한다. Babysitter 슬라이드 스위치는 `ON`, DIP는 `1`(EN1)만 `ON`이다.

## STEP 14. CH3 공용 마스터와 CH4 모드 선택

기존 모드 1 STEP 14와 달라지는 핵심이다. CH3 NO를 Babysitter에 바로 연결하지 않고 CH4를 사이에 넣는다.

| ☐ | 어디서 | → | 어디로 | 굵기 |
|---|---|---|---|
| ☐ | INA226 `IN+` | → | CH3 COM | 0.75SQ |
| ☐ | CH3 NO | → | CH4 COM | 0.75SQ |
| ☐ | CH4 NC | → | Babysitter `BAT+` | 0.75SQ |
| ☐ | CH4 NO | → | BW150 부하 `+` | 0.75SQ |

**왜 CH4 NC가 허용되는가**: 정전 시 CH4는 모드 1 쪽으로 돌아가지만, 앞단 CH3가 NO 접점이라 동시에 열린다. 어느 측정 대상도 BW150이나 Babysitter 전력 경로와 연결되지 않는다.

**확인**

- ☐ CH3 NO가 Babysitter `BAT+`에 직결되지 않았다.
- ☐ CH4 COM이 CH3 NO에서 왔다.
- ☐ 무전원 상태에서 CH4 COM↔NC만 도통되고 COM↔NO는 열려 있다.

## STEP 15. BW150과 6가닥 전력 GND 스플라이스

| ☐ | 어디서 | → | 어디로 |
|---|---|---|---|
| ☐ | CH2 NO | → | BW150 부하 `+` — CH4 NO와 같은 단자 |
| ☐ | BW150 부하 `−` | → | 전력 GND 스플라이스 자리 |

BW150의 실제 **부하 입력 단자**인지 실물로 확인한다. `8V<V<36V`라고 적힌 다른 기능 단자에 보조배터리를 물리지 않는다.

기존 모드 1의 다섯 가닥에 모드 2 보조배터리 GND용 피그테일 한 가닥을 추가해 **여섯 가닥**을 한 번에 잇는다.

| ☐ | 가닥 | 굵기 |
|---|---|---|
| ☐ | ZY12PDN `VOUT−` | 0.75SQ |
| ☐ | Babysitter `GND_IN` | 0.75SQ |
| ☐ | Babysitter `SYS−` | 0.75SQ |
| ☐ | BW150 부하 `−` | 0.75SQ |
| ☐ | 보조배터리 USB-A GND로 갈 `PB_N` | 0.75SQ |
| ☐ | 신호 GND 레일로 갈 한 가닥 | 점퍼선 또는 22AWG 단선 |

납땜·수축튜브·스트레인 릴리프 방법은 기존 가이드 STEP 15를 그대로 따른다. `PB_N`의 반대쪽은 STEP 23까지 절연한다.

**확인**

- ☐ 여섯 가닥 중 아무 두 GND를 짚으면 도통한다.
- ☐ 3.3V 레일과 스플라이스는 도통하지 않는다.
- ☐ 노출된 심선이 없다.

## STEP 16~20. 기존 인터페이스 검사

측정 대상이 없는 상태에서 기존 가이드의 다음 절차를 그대로 수행한다.

1. [STEP 16 전원 투입·I2C/SPI/1-Wire 설정](mode1_beginner_guide.md#step-16-전원-투입--인터페이스-켜기)
2. [STEP 17 I2C 1차 확인](mode1_beginner_guide.md#step-17-i2cdetect-1차-확인)
3. [STEP 18 MLX90614 주소 변경](mode1_beginner_guide.md#step-18-mlx90614-2-주소를-0x5b로-바꾸고-1을-붙인다)
4. [STEP 19 MLX90614 필터 설정](mode1_beginner_guide.md#step-19-mlx90614-두-개의-필터를-재설정한다-iir100-fir111)
5. [STEP 20 DS18B20 인식 확인](mode1_beginner_guide.md#step-20-ds18b20-3개-인식-확인)

기대 주소는 `40 48 5a 5b`다. 셀이 없으므로 `55`가 없는 것이 정상이다.

## STEP 21. CH4까지 포함한 릴레이 경로 검사

셀 홀더는 비어 있고 보조배터리는 분리된 상태여야 한다.

도통계를 대기 전에 각 측정점의 DC 전압이 50mV 미만인지 전압 모드로 먼저 확인한다. 전압이 보이면 도통 모드로 바꾸지 말고 전원을 끈 뒤 배선을 다시 확인한다. **ZY12PDN용 USB-C 충전기만 계속 분리하고, 아래 `pinctrl` 실행을 위해 라즈베리파이 전원은 유지한다.** BW150 입력은 OFF로 둔다.

먼저 전부 OFF로 둔다.

```bash
pinctrl set 5,6,13,19 op dh
pinctrl get 5,6,13,19       # 네 채널 모두 op dh 확인
```

다음 순서로 한 채널씩 확인한다.

| ☐ | 상태 | 명령 | 도통계 기대값 |
|---|---|---|---|
| ☐ | 모두 OFF | 위 명령 | INA226 `IN+` ↔ BAT+·BW150+ 모두 열림 |
| ☐ | 모드 1 선택 | `pinctrl set 19 op dh` 후 `pinctrl set 13 op dl` | INA226 `IN+` ↔ Babysitter `BAT+` 도통 |
| ☐ | 다시 마스터 OFF | `pinctrl set 13 op dh` | 위 경로 열림 |
| ☐ | 모드 2 선택 | `pinctrl set 19 op dl` 후 `pinctrl set 13 op dl` | INA226 `IN+` ↔ BW150 `+` 도통 |
| ☐ | 전부 OFF | `pinctrl set 13,19 op dh` | 두 경로 모두 열림 |

CH1·CH2도 기존 가이드 STEP 21대로 각각 딸깍이는지 확인하되 동시에 켜지 않는다.

**확인**: 검사가 끝나면 반드시 다음 상태다.

```bash
pinctrl set 5,6,13,19 op dh
```

## STEP 22. 무배터리 마감 검사

| ☐ | 검사 | 통과 기준 |
|---|---|---|
| ☐ | 모든 GPIO | `5,6,13,19`가 `op dh` |
| ☐ | I2C | `40 48 5a 5b` |
| ☐ | 1-Wire | `28-` 디렉터리 3개 |
| ☐ | CH4 무전원 경로 | COM↔NC만 도통 |
| ☐ | 마스터 차단 | CH3 OFF에서 INA226 `IN+`가 BAT+·BW150+와 모두 분리 |
| ☐ | 측정 대상 | 셀 없음, 보조배터리 없음 |

하나라도 다르면 STEP 23으로 가지 않는다.

---

# 5. 통합 3단계 — 교체식 입력 인터페이스

## STEP 23. `SOURCE_P` 단일 선택점을 만든다

이 STEP에서도 셀과 보조배터리를 연결하지 않는다.

### 23-1. INA226 쪽 고정 배선

| ☐ | 어디서 | → | 어디로 |
|---|---|---|---|
| ☐ | INA226 `VBUS` | → | INA226 `IN−`와 같은 전기점 `SOURCE_P` |

`SOURCE_P`는 INA226의 기존 나사 단자처럼 전원을 끈 뒤 풀고 조일 수 있는 **단일 체결점**이어야 한다. 여기에 아래 두 양극 중 **정확히 하나만** 체결한다.

| 선택 모드 | `SOURCE_P`에 체결 | 반드시 분리·절연할 선 |
|---|---|---|
| 모드 1 | 빈 셀 홀더 `+` | USB-A `VBUS` |
| 모드 2 | USB-A `VBUS` | 빈 셀 홀더 `+` |

> ⚠️ 두 양극을 같은 단자에 함께 넣거나 별도 스플라이스로 합치지 않는다. `SOURCE_P`에 두 전선을 동시에 넣지 못하게 `한 가닥만` 라벨을 붙인다. 기존 INA226 단자가 반복 체결을 지원하지 않거나 두 선을 확실히 구분할 수 없으면 현재 부품만으로 진행하지 않는다.

> ⚠️ `SOURCE_P`와 선택된 양극선은 CH3 앞에 있고 별도 퓨즈가 없다. CH3 OFF도 이 구간의 GND 단락을 차단하지 못하므로, 전원을 제거한 상태에서만 체결하고 노출 심선을 남기지 않는다. 현재 보유 부품만으로는 셀 PCM·보조배터리 내부 보호 외의 추가 과전류 보호를 제공하지 못한다.

### 23-2. 서로 다른 음극 귀환

| ☐ | 어디서 | → | 어디로 |
|---|---|---|---|
| ☐ | 빈 셀 홀더 `−` | → | Babysitter `BAT−` 한 점 |
| ☐ | USB-A 수 플러그 `GND` | → | STEP 15의 `PB_N` |

USB-A 케이블은 색만 믿지 말고, 플러그 핀과 잘라낸 선 사이를 멀티미터로 확인한다. `D+`·`D−`는 각각 절연하고 서로 또는 GND에 연결하지 않는다. 전력선은 **20cm 이하·20AWG 이상**이어야 한다.

**확인**

- ☐ 셀 홀더가 비어 있다.
- ☐ USB-A 플러그가 보조배터리에서 빠져 있다.
- ☐ `SOURCE_P` ↔ INA226 `IN−`·`VBUS`가 도통한다.
- ☐ `SOURCE_P`에 양극이 없거나 정확히 한 가닥만 체결돼 있다.
- ☐ 사용하지 않는 양극 선 끝이 개별 절연돼 있다.
- ☐ USB-A GND ↔ 전력 GND 스플라이스가 도통한다.
- ☐ USB-A VBUS ↔ GND가 0Ω이 아니다.

## STEP 24. 최초 모드 선택 전 검사

| ☐ | 검사 | 통과 기준 |
|---|---|---|
| ☐ | 셀과 보조배터리 | 둘 다 없음 |
| ☐ | `SOURCE_P`–GND | 0Ω 근처가 아님 |
| ☐ | 양극 선택 | `SOURCE_P`에 최대 한 가닥, 미사용 양극 개별 절연 |
| ☐ | CH1·CH2·CH3·CH4 | 모두 OFF (`dh`) |
| ☐ | USB 케이블 | VBUS/GND 극성을 눈과 도통 측정으로 각각 확인 |
| ☐ | INA226 | `R010`, CAL 예정값 `2560 (0x0A00)` |

---

# 6. 모드 1 사용

## STEP 25-M1. 보조배터리를 먼저 분리한다

1. ☐ BW150 부하를 `0A/OFF`로 둔다.
2. ☐ 라즈베리파이가 켜진 상태에서 아래 `pinctrl` 명령을 실행하고 네 채널이 모두 `op dh`인지 확인한다.
3. ☐ 보조배터리에서 USB-A 플러그를 **물리적으로 뽑는다.** 케이블만 OFF라는 말로 대체하지 않는다.
4. ☐ 라즈베리파이와 ZY12PDN 전원을 모두 뽑고 USB-A `VBUS`를 `SOURCE_P`에서 분리해 끝을 절연한다.
5. ☐ 빈 셀 홀더 `+`만 `SOURCE_P`에 체결한다.
6. ☐ CH4를 OFF/NC로 둔다.

```bash
pinctrl set 5,6,13,19 op dh
pinctrl get 5,6,13,19       # 네 채널 모두 op dh 확인
```

## STEP 26-M1. 기존 모드 1 셀 조립을 완료한다

보조배터리가 빠지고 USB-A `VBUS`가 `SOURCE_P`에서 분리·절연된 것을 다시 확인한 뒤 기존 가이드의 다음 절차를 수행한다.

- [STEP 24 셀 삽입 전 마지막 검사](mode1_beginner_guide.md#step-24-셀-삽입-전-마지막-검사)
- [STEP 25 IR·FSR 배치](mode1_beginner_guide.md#step-25-ir-2개와-fsr을-거치대에-자리잡는다)
- [STEP 26 셀과 DS18B20 배치](mode1_beginner_guide.md#step-26-셀을-끼우고-ds18b20-3점을-밀착한다)
- [STEP 27~29 인식·위치표·압력 baseline](mode1_beginner_guide.md#step-27-전원-투입--5개-다-보이는지)

모드 1에서는 CH4가 항상 OFF/NC다. STEP 27에서 `0x55`를 확인할 때는 CH1·CH2가 OFF이고 CH4가 OFF/NC인 것을 확인한 뒤 CH3만 ON한다. 충전은 CH1+CH3, 방전은 CH2+CH3을 사용한다.

---

# 7. 모드 2 사용

## STEP 25-M2. 외부 셀을 먼저 제거한다

1. ☐ BW150 부하를 `0A/OFF`로 둔다.
2. ☐ 라즈베리파이가 켜진 상태에서 아래 명령으로 CH1·CH2·CH3을 OFF하고 모두 `op dh`인지 확인한다.
3. ☐ 라즈베리파이와 ZY12PDN 전원을 뽑는다.
4. ☐ 외부 셀을 홀더에서 **물리적으로 뺀다.** CH3 OFF만으로 대체하지 않는다.
5. ☐ 빈 홀더의 극 사이 전압이 `0V`인지 확인한다.
6. ☐ 홀더 `+`를 `SOURCE_P`에서 분리하고 끝을 절연한다.
7. ☐ 보조배터리가 아직 빠진 상태에서 USB-A `VBUS`만 `SOURCE_P`에 체결한다.
8. ☐ `SOURCE_P`에 양극 한 가닥만 있는지 눈으로 확인한다.

```bash
pinctrl set 5,6,13 op dh
pinctrl get 5,6,13          # 세 채널 모두 op dh 확인
```

## STEP 26-M2. IR 센서를 보조배터리에 배치한다

- `0x5A`: 케이스 중앙
- `0x5B`: USB-A 출력 포트쪽
- 표면에서 최대 5cm
- 두 측정 스팟 중심을 최소 4cm 이상 분리
- DS18B20과 FSR은 보조배터리에 붙이지 않고, 소프트웨어에서 모드 2 값으로 사용하지 않는다.

## STEP 27-M2. 보조배터리를 연결하고 경부하부터 확인한다

보조배터리는 외부 충전기로 완충하고, 충전기를 완전히 분리한 뒤 USB-A 출력만 연결한다.

1. ☐ ZY12PDN용 USB-C 어댑터는 계속 분리하고 BW150 출력도 OFF로 둔다.
2. ☐ 라즈베리파이 전원만 넣고 부팅한다.
3. ☐ `pinctrl get 5,6,13,19`에서 네 핀이 모두 `op dh`인지 확인한다. 다르면 멈춘다.
4. ☐ CH3 OFF 상태에서 CH4를 ON/NO로 전환한다.
5. ☐ 50ms 이상 기다린다.
6. ☐ 보조배터리 USB-A 출력 플러그를 연결한다.
7. ☐ 아래 INA226 초기화·무부하 확인을 통과한다.
8. ☐ BW150을 `0.1A`로 설정하되 아직 출력은 OFF로 둔다.
9. ☐ CH3을 ON한다.
10. ☐ BW150 출력을 ON한다.

```bash
pinctrl set 5,6,13 op dh   # CH1·CH2·CH3 OFF
pinctrl set 19 op dl       # CH4 모드 2 선택
# 50ms 이상 대기
```

### 27-1. INA226 `R010` 초기화·검산

다음 스크립트는 Configuration과 CAL을 실제 레지스터에 쓰고 다시 읽는다. 무부하, 0.1A, 0.5A, 정지 직전 0A 확인 때마다 실행한다.

```bash
python3 - <<'PY'
from smbus2 import SMBus
import time

ADDR = 0x40
CONFIG = 0x4527
CAL = 0x0A00             # R010, Current_LSB=0.0002A

def swap(v):
    return ((v & 0xFF) << 8) | ((v >> 8) & 0xFF)

def i16(v):
    return v - 65536 if v & 0x8000 else v

with SMBus(1) as bus:
    def read_u16(reg):
        return swap(bus.read_word_data(ADDR, reg))

    def write_u16(reg, value):
        bus.write_word_data(ADDR, reg, swap(value))

    write_u16(0x00, CONFIG)
    write_u16(0x05, CAL)
    time.sleep(0.1)

    config = read_u16(0x00)
    cal = read_u16(0x05)
    manufacturer = read_u16(0xFE)
    die = read_u16(0xFF)
    shunt_raw = i16(read_u16(0x01))
    bus_raw = read_u16(0x02)
    current_raw = i16(read_u16(0x04))
    mask = read_u16(0x06)

    voltage_v = bus_raw * 0.00125
    current_a = current_raw * 0.0002
    shunt_a = shunt_raw * 0.0000025 / 0.01
    mismatch_a = abs(current_a - shunt_a)
    ovf = bool(mask & 0x0004)

    print(f"CONFIG=0x{config:04X} CAL=0x{cal:04X}")
    print(f"MFG=0x{manufacturer:04X} DIE=0x{die:04X} OVF={int(ovf)}")
    print(f"voltage_v={voltage_v:.4f} current_a={current_a:+.4f}")
    print(f"shunt_check_a={shunt_a:+.4f} mismatch_a={mismatch_a:.4f}")

    assert config == CONFIG, "CONFIG readback mismatch"
    assert cal == CAL, "CAL readback mismatch"
    assert manufacturer == 0x5449 and die == 0x2260, "INA226 identity mismatch"
    assert not ovf, "INA226 OVF=1; current/power invalid"
    assert mismatch_a <= max(0.02, abs(current_a) * 0.02), "CAL/shunt mismatch"
PY
```

**무부하 통과 기준**: `CAL=0x0A00`, `MFG=0x5449`, `DIE=0x2260`, `OVF=0`, `|current_a| ≤ 0.02A`. 하나라도 다르면 CH3을 켜지 않는다.

무부하 검사가 통과한 뒤에만 CH3과 BW150을 순서대로 켠다.

```bash
pinctrl set 13 op dl       # CH3 마스터 ON
# 그 다음 BW150 출력 ON
```

기대값:

- `voltage_v` 약 5V
- `current_a` 약 **−0.1A**
- CH1·CH2는 계속 OFF

0.1A 출력은 **최대 10초**만 유지한다. 이 안에 STEP 27-1 스크립트를 한 번 실행해 통과값을 기록한 뒤 BW150을 OFF하고 즉시 STEP 28의 0.5A 단계로 전환한다. 시간 안에 확인하지 못했거나 이상이 있으면 0.5A로 진행하지 않는다.

전류가 양수면 INA226 방향이 잘못된 것이므로 즉시 BW150을 OFF하고 CH3을 연다. 배선 수정 전에는 계속하지 않는다.

## STEP 28-M2. 0.5A 1차 검증

처음부터 2A를 걸지 않는다.

| ☐ | 확인 | 기대값 |
|---|---|---|
| ☐ | BW150 | 0.5A 정전류, **최대 10초** |
| ☐ | INA226 전류 | 약 −0.5A |
| ☐ | INA226 전압 | 보조배터리 출력 전압과 멀티미터가 허용오차 안에서 일치 |
| ☐ | CH1·CH2 | OFF |
| ☐ | 릴레이·케이블 | 비정상 발열·냄새 없음 |

다음이 모두 확인되기 전에는 0.5A를 넘기지 않는다.

- INA226 실크스크린 `R010`
- CAL `2560 (0x0A00)`
- USB-A 전력선 20cm 이하·20AWG 이상
- BW150의 실제 부하 입력 단자 확인
- 0.5A에서 전류 부호와 전압 비교 통과

0.1A와 0.5A에서 각각 STEP 27-1 스크립트를 실행한다. `current_a`가 목표값의 ±2% 또는 ±20mA 중 큰 범위 안에서 **음수**, `OVF=0`, `mismatch_a` 통과여야 한다. 각 단계의 10초가 끝나면 BW150을 즉시 OFF한다. 0.5A 종료 뒤에는 바로 STEP 29로 간다.

> **여기서 시운전은 끝이다.** `COMBINED_EXISTING_PARTS_V1`은 MQ-2·확정 안전 문턱·연속 감시 프로그램이 없으므로 P0~P6, 2A 시험, 수 시간 용량시험을 시작하지 않는다.

## STEP 29-M2. 정지와 모드 1 복귀

CH4를 전류가 흐르는 중에 전환하지 않는다.

1. ☐ BW150 부하를 `0A/OFF`로 내린다.
2. ☐ STEP 27-1 스크립트로 `|current_a| ≤ 0.02A`와 `OVF=0`을 확인한다.
3. ☐ CH3을 OFF한다.
4. ☐ 50ms 이상 기다린다.
5. ☐ 보조배터리 USB-A 플러그를 뽑는다.
6. ☐ CH4를 OFF/NC로 돌린다.

```bash
pinctrl set 13 op dh       # CH3 OFF
# 보조배터리 분리 후
pinctrl set 19 op dh       # CH4 모드 1 복귀
```

---

## 8. 허용 상태와 금지 상태

`active-LOW`: `0(dl)`=릴레이 도통, `1(dh)`=릴레이 차단.

| 상태 | CH1 | CH2 | CH3 | CH4 | 연결 대상 |
|---|---:|---:|---:|---:|---|
| 정지 | 1 | 1 | 1 | 1 | 없음 |
| 모드 1 충전 | 0 | 1 | 0 | 1 | 외부 셀만 |
| 모드 1 방전 | 1 | 0 | 0 | 1 | 외부 셀만 |
| 모드 2 선택·마스터 OFF | 1 | **1** | 1 | 0 | 보조배터리 연결 전/후 |
| 모드 2 0.1A·0.5A 시운전 | 1 | **1** | 0 | 0 | 보조배터리만 |

다음은 모두 금지다.

- `SOURCE_P`에 셀 홀더 `+`와 USB-A `VBUS` 동시 체결
- CH1과 CH2 동시 도통
- 모드 2에서 CH1 또는 CH2 도통
- CH3 도통 중 CH4 전환
- BW150 전류가 흐르는 중 CH3·CH4 접점 전환
- `R100` INA226으로 0.82A 초과
- 규격을 모르는 USB 케이블로 2A 판정
- `COMBINED_EXISTING_PARTS_V1`에서 P0~P6·2A·정밀 용량시험 실행

## 9. 완료 인계표

| ☐ | 항목 | 기록값 |
|---|---|---|
| ☐ | INA226 션트 | R___ |
| ☐ | INA226 CAL | 0x____ |
| ☐ | USB-A 케이블 길이·굵기 | ___cm / ___AWG |
| ☐ | 실물 확인 날짜 | 2026-08-05 |
| ☐ | 0.1A 전압·전류 | ___V / ___A |
| ☐ | 0.5A 전압·전류 | ___V / ___A |
| ☐ | 모드 1 CH4 상태 | OFF/NC 확인 |
| ☐ | 모드 2 CH1·CH2 상태 | OFF 확인 |
| ☐ | 두 측정 대상 동시 연결 방지 방법 | __________ |
| ☐ | MQ-2 미구현 인지 | 확인 |
| ☐ | 제품 진단 잠금 | `SAFETY_PROFILE_NOT_READY` 확인 |

이 표와 기존 모드 1 가이드 §7-1의 인계표를 함께 백엔드 개발자에게 넘긴다.
