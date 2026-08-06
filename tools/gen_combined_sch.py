#!/usr/bin/env python3
"""셀가드 모드 1·2 통합(COMBINED_EXISTING_PARTS_V1) 계측 회로도 생성기.

정본 문서: docs/hardware/mode1_mode2_combined_beginner_guide.md
보유한 INA226 1개와 4채널 릴레이 1개로 모드 1(외부 셀) 전체와
모드 2(USB 보조배터리)의 방전 계측 경로를 한 회로에 담는다.

모드 1 전용 회로(tools/gen_mode1_sch.py)와 갈리는 지점은 세 가지다.

  1. CH4 를 실제로 배선한다 — OFF/NC = 모드 1, ON/NO = 모드 2 방전.
     모드 1 회로에서 CH4 는 미배선 예비 채널이었다.
  2. INA226 IN-/VBUS 앞에 SOURCE_P 단일 체결점을 둔다. 모드 1 셀 +와
     모드 2 USB-A VBUS 중 정확히 한 가닥만 번갈아 물린다.
  3. 전력 GND 스플라이스가 다섯 가닥에서 여섯 가닥으로 늘어난다(PB_N 추가).

사용법:
    python3 tools/gen_combined_sch.py

산출:
    hardware/combined/cellguard.kicad_sym
    hardware/combined/cellguard_combined.kicad_sch
    hardware/combined/sym-lib-table
    hardware/combined/cellguard_combined.kicad_pro
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cellguard_symbols import COMBINED_ONLY, RPI_ALL, SYMBOLS   # noqa: E402
from kicad_sch import REPO, Inst, Schematic, build_notes        # noqa: E402

OUT = REPO / "hardware" / "combined"
PROJECT = "cellguard_combined"

ALL_SYMBOLS = {**SYMBOLS, **COMBINED_ONLY}


# ---------------------------------------------------------------- 배치·결선

I2C = {"SDA": "I2C_SDA", "SCL": "I2C_SCL"}

INSTANCES: list[Inst] = [
    # ---- 교체식 측정 입력 (좌측 열 상단)
    #
    #   모드 1: 외부 셀 + ─────┐
    #                          ├── SOURCE_P ── INA226 IN- / VBUS
    #   모드 2: USB-A VBUS ────┘
    #
    # 두 양극을 같은 단자에 동시에 넣으면 셀과 보조배터리가 서로를 향해
    # 방전한다. 이 회로에는 그것을 막을 다이오드도 퓨즈도 없다 —
    # 하드웨어 인터락이 아니라 작업 절차로만 막고 있다.
    Inst("CELL", "BT1", 62, 34, value="Li-ion Cell (모드 1 전용)",
         nets={"+": "CELL_P", "-": "CELL_N"}),
    Inst("POWERBANK", "PB1", 62, 72,
         nets={"VBUS": "PB_VBUS", "GND": "GND"}, nc=["D-", "D+"]),
    Inst("SRC_SEL", "TB1", 62, 114, nets={
        "M1_CELL_P": "CELL_P", "M2_VBUS": "PB_VBUS", "SOURCE_P": "SOURCE_P",
    }),

    # INA226 은 두 모드가 공유한다. 직렬 퓨즈 없음(2026-07-28 결정) —
    # 과전류 보호는 셀 보호회로(PCM)와 보조배터리 내부 BMS 뿐이다.
    Inst("INA226", "U1", 62, 156, nets={
        "IN+": "RLY_CH3_IN", "IN-": "SOURCE_P", "VBUS": "SOURCE_P",
        "VCC": "+3V3", "GND": "GND", **I2C,
    }, nc=["ALE"]),

    # ---- 압력 (좌측 열 하단) — 모드 1 전용. 모드 2에서는 pressure_raw = null
    Inst("FSR406", "RV1", 62, 206, nets={"1": "+3V3", "2": "FSR_OUT"}),
    Inst("R", "R1", 62, 230, value="10k", nets={"1": "FSR_OUT", "2": "GND"}),
    Inst("R", "R2", 62, 254, value="4.7k", nets={"1": "+3V3", "2": "OW_DATA"}),

    # ---- 릴레이 · 충방전 (가운데 열)
    #
    # CH3 뒤에서 CH4 가 모드를 고른다. CH3 NO 를 Babysitter BAT+ 에 바로
    # 연결하지 않고 CH4 를 사이에 넣는 것이 모드 1 회로와의 핵심 차이다.
    #
    #   INA226 IN+ -[CH3]- CH4 COM ─┬─ NC ── Babysitter BAT+   [모드 1]
    #                               └─ NO ── BW150 부하 +      [모드 2]
    #
    # BW150 부하 + 에는 CH2 NO 와 CH4 NO 두 선이 함께 붙는다(LOAD_P).
    # 정전 시 CH4 는 모드 1 쪽(NC)으로 돌아가지만 앞단 CH3 가 NO 접점이라
    # 함께 열려, 어느 측정 대상도 부하·충전 경로에 연결되지 않는다.
    Inst("RELAY4", "K1", 220, 78, nets={
        "VCC": "+3V3", "GND": "GND", "JD_VCC": "+5V_RLY",
        "IN1": "RLY_IN1", "IN2": "RLY_IN2", "IN3": "RLY_IN3", "IN4": "RLY_IN4",
        "CH1_COM": "V5_PD",       "CH1_NO": "RLY_CH1_OUT",
        "CH2_COM": "SYS_P",       "CH2_NO": "LOAD_P",
        "CH3_COM": "RLY_CH3_IN",  "CH3_NO": "RLY_CH3_OUT",
        "CH4_COM": "RLY_CH3_OUT", "CH4_NO": "LOAD_P", "CH4_NC": "BAT_P",
    }, nc=["CH1_NC", "CH2_NC", "CH3_NC"]),

    Inst("BABYSITTER", "U2", 220, 168, nets={
        "VIN": "RLY_CH1_OUT", "GND_IN": "GND",
        "BAT+": "BAT_P", "BAT-": "CELL_N",
        "SYS+": "SYS_P", "SYS-": "GND",
        **I2C, "GND": "GND",
    }, nc=["GPOUT"]),

    Inst("ZY12PDN", "J2", 220, 218, nets={"VOUT+": "V5_PD", "VOUT-": "GND"}),
    Inst("BW150", "J3", 220, 248, nets={"LOAD+": "LOAD_P", "LOAD-": "GND"}),

    # ---- 라즈베리파이 헤더 (우측 열)
    Inst("RPI5_HDR", "J1", 400, 112, nets={
        "3V3 (1)": "+3V3",
        "(2) 5V": "+5V_RLY",
        "GPIO2/SDA1 (3)": "I2C_SDA",
        "GPIO3/SCL1 (5)": "I2C_SCL",
        "(6) GND": "GND",
        "GPIO4 (7)": "OW_DATA",
        "GND (9)": "GND",
        "(14) GND": "GND",
        "3V3 (17)": "+3V3",
        "(18) GPIO24": "TFT_RES",
        "GPIO10/MOSI (19)": "SPI_MOSI",
        "(20) GND": "GND",
        "(22) GPIO25": "TFT_DC",
        "GPIO11/SCLK (23)": "SPI_SCLK",
        "(24) GPIO8/CE0": "SPI_CE0",
        "GND (25)": "GND",
        "GPIO5 (29)": "RLY_IN1",
        "(30) GND": "GND",
        "GPIO6 (31)": "RLY_IN2",
        "GPIO13 (33)": "RLY_IN3",
        "(34) GND": "GND",
        "GPIO19 (35)": "RLY_IN4",
        "GND (39)": "GND",
    }),

    # ---- 접촉 온도 3점 (1-Wire 멀티드롭) — 모드 1 전용.
    #      모드 2에서는 보조배터리에 옮겨 붙이지 않고 값도 쓰지 않는다.
    Inst("DS18B20", "U5", 400, 192, value="DS18B20 #1 (셀 하단, 모드 1 전용)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U7", 400, 220, value="DS18B20 #2 (셀 중앙, 모드 1 전용)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U8", 400, 248, value="DS18B20 #3 (셀 단자쪽, 모드 1 전용)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),

    # ---- I2C / SPI 주변 (최우측 열)
    Inst("TFT35", "U6", 590, 68, nets={
        "VCC": "+3V3", "GND": "GND",
        "CS": "SPI_CE0", "RESET": "TFT_RES", "DC/RS": "TFT_DC",
        "SDI": "SPI_MOSI", "SCK": "SPI_SCLK", "LED": "+3V3",
    }, nc=["SDO", "T_CLK", "T_CS", "T_DIN", "T_DO", "T_IRQ"]),

    # ---- IR 표면온도 2존 — 두 모드가 공유하는 유일한 온도 센서다.
    #      모드를 오갈 때 브래킷째 옮겨 겨눠야 하므로 나사·클램프 고정.
    Inst("MLX90614", "U3", 590, 124,
         value="MLX90614 #1 (0x5A, 셀 중앙 / 모드 2: 케이스 중앙)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("MLX90614", "U9", 590, 152,
         value="MLX90614 #2 (0x5B, 셀 단자쪽 / 모드 2: USB-A 포트쪽)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("ADS1115", "U4", 590, 188, nets={
        "A0": "FSR_OUT", "VDD": "+3V3", "GND": "GND", **I2C, "ADDR": "GND",
    }, nc=["A1", "A2", "A3", "ALRT"]),

    # ---- 릴레이 IN 풀업 (부팅 중 오동작 방지)
    #      R6 은 통합형에서 더 중요하다 — GPIO19 가 뜨면 CH4 가 임의로
    #      모드 2 쪽(NO)으로 붙는다. 앞단 CH3 가 막아 주지만 두 겹 중 한 겹이다.
    Inst("R", "R3", 590, 216, value="10k", nets={"1": "+3V3", "2": "RLY_IN1"}),
    Inst("R", "R4", 590, 234, value="10k", nets={"1": "+3V3", "2": "RLY_IN2"}),
    Inst("R", "R5", 590, 252, value="10k", nets={"1": "+3V3", "2": "RLY_IN3"}),
    Inst("R", "R6", 590, 270, value="10k", nets={"1": "+3V3", "2": "RLY_IN4"}),
]

# 라즈베리파이 헤더에서 쓰지 않는 핀은 전부 미연결 표시
_rpi = next(i for i in INSTANCES if i.key == "RPI5_HDR")
_rpi.nc = [n for n in RPI_ALL if n not in _rpi.nets]


# 주석은 3단 컬럼으로.
COLUMNS: list[tuple[float, list[tuple[str, str]]]] = [
    (20, [
        ("h1", "셀가드 — 모드 1·2 통합 계측 회로  (프로필 COMBINED_EXISTING_PARTS_V1)"),
        ("", "보유한 INA226 1개 + 4채널 릴레이 1개로 두 전력 경로를 한 회로에 담는다."),
        ("", "  모드 1 (외부 셀)      충전 · 방전 · 계측 전체"),
        ("", "  모드 2 (USB 보조배터리) 방전 계측 경로와 0.1A -> 0.5A / 각 10초 시운전까지만"),
        ("", ""),
        ("", "모드 1 충전:  ZY12PDN 5V -[CH1]- Babysitter VIN -> (BQ24075) -> BAT+ -[CH4 NC]-[CH3]- INA226 - SOURCE_P - 셀 +"),
        ("", "모드 1 방전:  셀 + - SOURCE_P - INA226 -[CH3]-[CH4 NC]- BAT+ ... SYS+ -[CH2]- BW150 부하 +"),
        ("", "모드 2 방전:  보조배터리 USB-A VBUS - SOURCE_P - INA226 -[CH3]-[CH4 NO]- BW150 부하 +"),
        ("", "부호 규약:  INA226 IN+ -> IN- 방향이 양수 = 충전.  방전은 음수."),
        ("", ""),
        ("h2", "[!!] SOURCE_P 에는 한 번에 양극 한 가닥만 체결한다"),
        ("", "셀 홀더 + 와 USB-A VBUS 를 같은 점에 동시에 물면 셀과 보조배터리가 서로를 향해 방전한다."),
        ("", "이 회로에는 그것을 막을 다이오드도 퓨즈도 없다. 하드웨어 인터락이 아니라 작업 절차로만 막는다."),
        ("", "  - 단자에 [한 가닥만] 라벨을 붙인다.  미사용 양극선 끝은 개별 절연한다."),
        ("", "  - 모드를 바꿀 때: 전원(Pi + USB-C) 분리 -> 측정 대상 물리적 제거 -> 양극 교체 체결."),
        ("", "  - SOURCE_P 는 CH3 앞이라 CH3 OFF 로도 이 구간의 GND 단락을 차단하지 못한다."),
        ("", "  - 반복 체결이 안 되는 INA226 개체라면 현재 부품만으로 통합형을 만들지 않는다."),
        ("", ""),
        ("h2", "[!] 두 모드의 음극 귀환이 서로 다르다 — 스타 그라운드"),
        ("", "모드 1:  셀 - 는 오직 Babysitter BAT- 한 점에만 간다 (CELL_N)."),
        ("", "모드 2:  보조배터리 GND 는 Babysitter 에 가지 않고 전력 GND 스플라이스로 직접 돌아온다 (PB_N)."),
        ("", "전력 GND 스플라이스는 여섯 가닥이다 — 모드 1 전용 회로의 다섯 가닥 + PB_N."),
        ("", "  ZY12PDN VOUT- / Babysitter GND_IN / Babysitter SYS- / BW150 부하 - / PB_N / 신호 GND 레일 한 가닥"),
        ("", "[주의] CELL_N <-> GND 도통은 정상이다. Babysitter 보드 안에서 배터리 - 는 GND 직결이고"),
        ("", "       BQ27441 센스 저항 R11(10mohm)은 배터리 + 쪽 하이사이드다. 위 규칙은 SOC 가 아니라 노이즈 때문이다."),
        ("", ""),
        ("h2", "[!] 조립 전 반드시 확인 — 여기서 틀리면 부품이 탄다"),
        ("", "1. ZY12PDN 을 5V 로 설정했는가.  9V/12V 면 Babysitter 가 즉시 파손된다.  (모드 2는 이 경로를 안 쓴다)"),
        ("", "2. 릴레이 VCC-JD_VCC 점퍼를 뽑았는가.  VCC=Pi 3.3V(옵토측), JD_VCC=5V(코일측)."),
        ("", "3. INA226 션트 실크스크린.  R010 = 0.01ohm 확정(2026-08-05 실물).  R100 은 0.82A 상한이라 모드 2에 부적합."),
        ("", "   Current_LSB=0.0002A -> CAL = 2560 (0x0A00).  CONFIG=0x4527.  Mask/Enable bit2 = OVF 를 매 프레임 확인."),
        ("", "4. Babysitter 온보드 스위치 2개.  S1 슬라이드 = ON (SYSOFF 는 active-high, HIGH=OFF)."),
        ("", "   S2 DIP 은 1(EN1)만 ON.  출고 기본 1,1 은 Standby 라 충전을 안 한다.  I_CHG=1.5A, I_INMAX=1.5A."),
        ("", "5. BW150 의 부하 입력 단자를 실물로 식별했는가.  보드의 8V<V<36V 표기 단자는 부하 입력이 아니다."),
        ("", "   부하 입력은 DC1V~200V / 5V 에서 0.01~20A.  배터리에는 CC(필요시 CR)만 — CV·CP 는 매뉴얼이 금지."),
        ("", "6. USB-A 케이블은 20cm 이하 / 20AWG 이상.  D+ 와 D- 는 각각 절연 (서로도 GND 에도 잇지 않는다)."),
        ("", "   28AWG 1m 를 쓰면 2A 에서 800mV 가 떨어져 판정 문턱(300mV)의 2.7배를 먹고 멀쩡한 배터리가 열화로 나온다."),
        ("", "7. 셀에 보호회로(PCM)가 있는가.  직렬 퓨즈가 없어 과전류 보호는 PCM 과 보조배터리 내부 BMS 뿐이다."),
        ("", "   보호회로가 있으면 18650 전체 길이가 68~70mm 다 -> 홀더와 센서 축방향 기준(캔 몸통 L)이 달라진다."),
    ]),
    (300, [
        ("h1", "릴레이 채널 배분 — CH4 가 모드 1 회로와 갈리는 지점이다"),
        ("", "CH1  모드 1 충전    ZY12PDN 5V -> Babysitter VIN        GPIO5   (물리핀 29)"),
        ("", "CH2  모드 1 방전    Babysitter SYS+ -> BW150 부하 +     GPIO6   (물리핀 31)"),
        ("", "CH3  공용 마스터    두 모드의 측정 대상 분리             GPIO13  (물리핀 33)"),
        ("", "CH4  모드 선택      OFF/NC = 모드 1 / ON/NO = 모드 2     GPIO19  (물리핀 35)"),
        ("", "                    -> 모드 1 전용 회로에서는 미배선 예비 채널이었다."),
        ("", ""),
        ("", "active-LOW:  GPIO=0(dl) 도통 / GPIO=1(dh) 차단."),
        ("", "모든 배터리 경로가 NO 접점을 지나므로 정전 / 부팅 중 / 크래시 = 자동 차단(fail-safe)."),
        ("", "CH4 만 NC 접점을 쓴다. 정전 시 CH4 는 모드 1 쪽으로 돌아가지만 앞단 CH3 가 함께 열려 안전하다."),
        ("", ""),
        ("", "[주의] CH3 을 열면 두 모드 다 측정 대상이 완전히 분리된다 — 아래는 고장이 아니라 정상 동작이다."),
        ("", "  모드 1: BQ27441 이 꺼져 I2C 0x55 가 버스에서 사라진다. 릴레이 상태를 조건으로 걸지 않으면 센서 오류 알림이 폭주한다."),
        ("", "  모드 2: 팩이 무부하가 되어 스스로 꺼지므로 INA226 이 0V 를 읽는다. 배터리 사망으로 오독하지 마라."),
        ("", "  INA226 은 Pi 3.3V 로 동작하므로 모드 1 에서는 마스터 차단 후에도 셀 전압 감시가 계속된다."),
        ("", "부팅 초기 보호 2중화: IN1~IN4 에 10k 풀업(R3~R6) + config.txt 의 gpio=5,6,13,19=op,dh."),
        ("", "  ※ config.txt 는 Pi 5 에서 안 먹을 수 있다. R3~R6 을 절대 생략하지 마라."),
        ("", ""),
        ("h2", "허용 상태 (이 다섯 가지 외에는 만들지 않는다)"),
        ("", "                              CH1 CH2 CH3 CH4   연결 대상"),
        ("", "정지                            1   1   1   1    없음"),
        ("", "모드 1 충전                     0   1   0   1    외부 셀만"),
        ("", "모드 1 방전                     1   0   0   1    외부 셀만"),
        ("", "모드 2 선택 · 마스터 OFF        1   1   1   0    보조배터리 연결 전/후"),
        ("", "모드 2 0.1A · 0.5A 시운전       1   1   0   0    보조배터리만"),
        ("", ""),
        ("h2", "[!] 금지 — 하나라도 하면 부품이 타거나 판정이 오염된다"),
        ("", "- SOURCE_P 에 셀 홀더 + 와 USB-A VBUS 동시 체결"),
        ("", "- CH1 과 CH2 동시 도통 / 모드 2 에서 CH1 또는 CH2 도통"),
        ("", "- CH3 도통 중 CH4 전환.  BW150 전류가 흐르는 중 CH3·CH4 접점 전환"),
        ("", "  -> 전환 순서: CH1·CH2 차단 -> CH3 차단 -> 50ms 이상 대기 -> CH4 전환."),
        ("", "     전류 중 전환하면 아크로 접점이 타서 접점 저항이 판정 문턱을 먹기 시작한다."),
        ("", "- R100 INA226 으로 0.82A 초과 / 규격을 모르는 USB 케이블로 2A 판정"),
        ("", "- 이 프로필에서 P0~P6 빠른 진단 · 2A · 정밀 용량시험 실행"),
        ("", ""),
        ("h2", "[!] 이 회로가 못 하는 것 — 제품 F21 진단으로 승격하지 않는다"),
        ("", "모드 2 자동 충전 경로 없음      -> CH4 를 모드 선택에 썼다. 완충은 외부 충전기로 한다."),
        ("", "모드 2 충전 전류 측정 없음      -> 충전 테이퍼로 완충을 판정하지 못한다."),
        ("", "MQ-2 가스 안전계층 없음         -> ADS1115 A0 는 FSR 이 쓰고, 5V AOUT 용 분압 부품이 없다."),
        ("", "확정된 안전 문턱 · 연속 감시 없음 -> API 는 409 SAFETY_PROFILE_NOT_READY."),
        ("", "  => 모드 1 의 사후 안전계층은 압력(FSR) 하나뿐이고, 모드 2 에는 그것마저 없다."),
        ("", "     사람이 지켜보는 것이 그만큼 더 중요하다."),
        ("", ""),
        ("h1", "I2C 주소 맵 (버스 1, 3.3V)"),
        ("", "0x40  INA226    전압 · 전류 · 전력      (두 모드 공유)"),
        ("", "0x48  ADS1115   A0=FSR 압력 (ADDR->GND)  모드 1 전용"),
        ("", "0x55  BQ27441   SOC (Babysitter 탑재)    모드 1 전용 — 보조배터리 셀에는 접근할 수 없다"),
        ("", "0x5A  MLX90614 #1  IR 표면온도          (두 모드 공유)"),
        ("", "0x5B  MLX90614 #2  IR 표면온도          (EEPROM 0x0E 로 주소 변경한 개체)"),
        ("", "무배터리 검사 기대값:  i2cdetect -y 1  ->  40  48  5a  5b   (셀이 없으니 55 없음이 정상)"),
    ]),
    (580, [
        ("h1", "Raspberry Pi 5 헤더 배선 — 모드 1 회로와 완전히 같다"),
        ("", "물리핀 1, 17   3.3V        센서 · TFT(VCC+LED) · 릴레이 VCC(옵토측)"),
        ("", "물리핀 2       5V          릴레이 JD_VCC(코일측)"),
        ("", "물리핀 3 / 5   GPIO2 / 3   I2C SDA / SCL"),
        ("", "물리핀 7       GPIO4       1-Wire (+ 4.7k 풀업 -> 3.3V) -> DS18B20 x3 (병렬)"),
        ("", "물리핀 18/19/22/23/24      TFT RESET / SDI / DC / SCK / CS"),
        ("", "물리핀 29/31/33/35         릴레이 IN1 / IN2 / IN3 / IN4"),
        ("", "물리핀 6,9,14,20,25,30,34,39   GND (신호 GND 레일 — 전력 GND 스플라이스와 나눈다)"),
        ("", ""),
        ("h2", "[!] 모드에 따라 살아있는 센서가 다르다 — Raw 필드가 달라진다"),
        ("", "                        모드 1        모드 2"),
        ("", "voltage_v / current_a   INA226        INA226        (같은 소자, 같은 션트)"),
        ("", "temp_ir_surface         MLX x2        MLX x2        브래킷째 옮겨 겨눈다"),
        ("", "temp_contact            DS18B20 x3    null          보조배터리에 옮겨 붙이지 않는다"),
        ("", "pressure_raw            FSR 406       null          외장 케이스에 가려 부착 불가"),
        ("", "soc_pct                 BQ27441       null          완제품이라 셀에 접근 불가"),
        ("", "gas_raw / acoustic_raw  null          null          이 회로에 센서 자체가 없다"),
        ("", "diag_phase / load_target_a  null      null          P0~P6 을 실행하지 않는 프로필이다"),
        ("", "온도는 다점 측정이고 쓰는 값은 최댓값이다 — 열폭주는 국부에서 시작하므로 평균을 쓰면 초기 신호가 희석된다."),
        ("", "  temp_ir_surface = max(#1, #2)      temp_contact = max(DS18B20 #1, #2, #3)"),
        ("", "  DS18B20 3개는 같은 3선에 병렬로 문다. 1-Wire 고유 64비트 ROM 코드라 주소 설정이 필요 없고,"),
        ("", "  Skip ROM + Convert T 로 셋을 동시에 변환해 개수가 늘어도 750ms 그대로다(순차로 하면 2250ms)."),
        ("", "모드 2 IR 배치: 0x5A=케이스 중앙 / 0x5B=USB-A 출력 포트쪽. 표면에서 최대 5cm, 스팟 중심 4cm 이상 분리."),
        ("", "[주의] 케이스 표면온도는 셀 온도가 아니다. 모드 1 의 55/60도 문턱을 모드 2 에 그대로 쓰지 마라."),
        ("", ""),
        ("h2", "[!] MLX90614 는 두 모드가 공유하므로 마운트를 떼었다 붙일 수 있게 만든다"),
        ("", "접착 고정이 아니라 나사 1개 또는 클램프로 각도·거리를 바꿀 수 있게 하고, 케이블에 여유를 준다."),
        ("", "모드 1 부착 거리는 2cm 이내 — FOV 35도라 스팟 지름 = 0.63 x 거리, 18650(지름 1.8cm) 안에 들어와야 한다."),
        ("", "둘 다 출고 시 0x5A 이므로 한 개씩 따로 연결해 U9 를 0x5B 로 바꾼다. EEPROM 쓰기에는 PEC 바이트가 필수다."),
        ("", "출고 상태는 갱신 865ms + 스파이크 50% 감쇠다. EEPROM 0x25 를 IIR=100 / FIR=111 로 재설정 -> 95.2ms."),
        ("", ""),
        ("h2", "[!] TFT 3.5in — 표시 전용 9핀만 쓴다"),
        ("", "T_CLK / T_CS / T_DIN / T_DO / T_IRQ 5핀은 터치용, SDO(MISO)도 미결선."),
        ("", "LED(백라이트)는 3.3V 직결 = 상시 점등.  VCC 는 3.3V — 안 켜지면 그때만 5V(물리핀 2·4)로 옮긴다."),
        ("", "ILI9488 은 SPI 에서 RGB565 를 못 쓴다. 480x320 전체 갱신 약 460KB 이므로"),
        ("", "100ms 계측 루프에 전체 화면 갱신을 올리지 마라 -> 부분 갱신 + 별도 스레드."),
        ("", ""),
        ("h2", "모드 전환 절차 요약 (자세한 것은 통합 조립 가이드 8·9절)"),
        ("", "모드 2 -> 모드 1:  BW150 0A/OFF -> pinctrl set 5,6,13,19 op dh -> USB-A 플러그를 보조배터리에서 뽑기"),
        ("", "                   -> Pi·ZY12PDN 전원 분리 -> VBUS 를 SOURCE_P 에서 분리·절연 -> 셀 홀더 + 체결."),
        ("", "모드 1 -> 모드 2:  BW150 0A/OFF -> CH1·CH2·CH3 OFF -> Pi·ZY12PDN 전원 분리 -> 셀을 홀더에서 빼기"),
        ("", "                   -> 홀더 + 분리·절연 -> VBUS 체결 -> Pi 만 부팅 -> CH3 OFF 에서 CH4 ON -> 50ms 대기"),
        ("", "                   -> 보조배터리 연결 -> 무부하 검산 -> BW150 0.1A 설정 -> CH3 ON -> BW150 출력 ON."),
        ("", "무부하 통과 기준:  CAL=0x0A00, MFG=0x5449, DIE=0x2260, OVF=0, |current_a| <= 0.02A."),
        ("", ""),
        ("", "PCB 없음 — 기성 모듈 + 배선 하네스다.  전력 경로는 0.75SQ 실리콘 배선, JD_VCC 만 점퍼선."),
        ("", "예비품 없음: DS18B20 3개와 MLX90614 2개를 전부 투입했다. 고장 시 교체품이 없다."),
    ]),
]


def main() -> None:
    Schematic(
        out=OUT,
        project=PROJECT,
        generator="gen_combined_sch.py",
        title="CellGuard Mode 1 + Mode 2 Combined - COMBINED_EXISTING_PARTS_V1",
        comments=[
            "Generated by tools/gen_combined_sch.py - edit the script, not this file",
            "Assembly guide: docs/hardware/mode1_mode2_combined_beginner_guide.md",
            "Mode 2 spec:    docs/hardware/mode2_powerbank_diagnosis_spec.md",
            "SOURCE_P takes exactly ONE positive lead at a time - cell + OR USB-A VBUS",
        ],
        symbols=ALL_SYMBOLS,
        instances=INSTANCES,
        notes=build_notes(COLUMNS),
        lib_descr="셀가드 모드 1·2 통합 회로 모듈 심볼",
        root_key="root-sheet-combined",
    ).write()


if __name__ == "__main__":
    main()
