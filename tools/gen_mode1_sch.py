#!/usr/bin/env python3
"""셀가드 모드 1(외부 셀) 계측 회로도 KiCad 파일 생성기.

기성 모듈을 배선으로 잇는 하네스라 PCB는 없다. 심볼도 KiCad 기본
라이브러리에 없는 브레이크아웃뿐이라 프로젝트 자체 라이브러리를 함께 만든다.
심볼 핀 이름은 실물 모듈의 실크스크린 글자를 그대로 쓴다 — 회로도와 실물을
1:1로 대조해야 하는 초보자가 볼 문서이기 때문이다.

배선은 전부 글로벌 라벨로 잇는다. 긴 배선이 교차하지 않아 좌표가 단순하고,
"같은 이름끼리 연결"로 읽을 수 있다.

사용법:
    python3 tools/gen_mode1_sch.py

산출:
    hardware/mode1/cellguard.kicad_sym
    hardware/mode1/cellguard_mode1.kicad_sch
    hardware/mode1/sym-lib-table
    hardware/mode1/cellguard_mode1.kicad_pro
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "hardware" / "mode1"
PROJECT = "cellguard_mode1"
LIB = "cellguard"

NS = uuid.UUID("6f1b6a1e-0000-4000-8000-000000000000")
_ROOT = str(uuid.uuid5(NS, "root-sheet"))

GRID = 1.27      # KiCad 연결 격자
PITCH = 5.08     # 핀 세로 간격. 2.54로 하면 글로벌 라벨끼리 세로로 붙어 안 읽힌다
PIN_LEN = 5.08
STUB = 5.08      # 핀 끝에서 글로벌 라벨까지의 짧은 배선


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "|".join(str(p) for p in parts)))


def snap(v: float) -> float:
    """KiCad 연결 격자(1.27mm)에 맞춘다. 안 맞으면 ERC가 endpoint_off_grid로 잡는다."""
    return round(v / 1.27) * 1.27


# ---------------------------------------------------------------- 심볼 정의

@dataclass
class Pin:
    name: str
    number: str
    etype: str = "passive"


@dataclass
class Sym:
    name: str
    ref: str
    value: str
    desc: str
    left: list[Pin] = field(default_factory=list)
    right: list[Pin] = field(default_factory=list)
    width: float = 33.02

    @property
    def rows(self) -> int:
        return max(len(self.left), len(self.right))

    @property
    def height(self) -> float:
        return self.rows * PITCH + PITCH

    def local_pins(self) -> dict[str, tuple[float, float, int]]:
        """핀 이름 -> (심볼 로컬 x, y, 각도). 로컬 좌표는 Y가 위로 증가한다."""
        w, h = self.width, self.height
        out: dict[str, tuple[float, float, int]] = {}
        for i, p in enumerate(self.left):
            out[p.name] = (-w / 2 - PIN_LEN, h / 2 - PITCH * (i + 1), 0)
        for i, p in enumerate(self.right):
            out[p.name] = (w / 2 + PIN_LEN, h / 2 - PITCH * (i + 1), 180)
        return out


def P(spec: str, etype: str = "passive") -> list[Pin]:
    """'1:VCC 2:GND' 형태를 Pin 리스트로."""
    pins = []
    for tok in spec.split():
        num, _, name = tok.partition(":")
        pins.append(Pin(name=name, number=num, etype=etype))
    return pins


# 라즈베리파이 5 40핀 헤더 — 홀수 핀 좌측, 짝수 핀 우측(실물 배치와 동일)
RPI_PINS = [
    "3V3", "5V",
    "GPIO2/SDA1", "5V",
    "GPIO3/SCL1", "GND",
    "GPIO4", "GPIO14/TXD",
    "GND", "GPIO15/RXD",
    "GPIO17", "GPIO18",
    "GPIO27", "GND",
    "GPIO22", "GPIO23",
    "3V3", "GPIO24",
    "GPIO10/MOSI", "GND",
    "GPIO9/MISO", "GPIO25",
    "GPIO11/SCLK", "GPIO8/CE0",
    "GND", "GPIO7/CE1",
    "ID_SD", "ID_SC",
    "GPIO5", "GND",
    "GPIO6", "GPIO12",
    "GPIO13", "GND",
    "GPIO19", "GPIO16",
    "GPIO26", "GPIO20",
    "GND", "GPIO21",
]

_rpi_left = [Pin(f"{RPI_PINS[i]} ({i + 1})", str(i + 1)) for i in range(0, 40, 2)]
_rpi_right = [Pin(f"({i + 1}) {RPI_PINS[i]}", str(i + 1)) for i in range(1, 40, 2)]

SYMBOLS: dict[str, Sym] = {
    "CELL": Sym(
        "CELL", "BT", "Li-ion Cell",
        "측정 대상 셀 — 18650 3.7V 2550mAh 또는 리튬폴리머 3.7V 1000mAh",
        right=P("1:+ 2:-"), width=25.4,
    ),
    "INA226": Sym(
        "INA226", "U", "INA226 [VLT-VCM029]",
        "전압·전류·전력 측정, I2C 0x40. Pi 3.3V로 동작하므로 마스터 차단 후에도 셀 전압 감시가 살아있다",
        left=P("1:IN+ 2:IN- 3:VBUS"),
        right=P("4:VCC 5:GND 6:SCL 7:SDA 8:ALE"),
        width=33.02,
    ),
    "BABYSITTER": Sym(
        "BABYSITTER", "U", "Battery Babysitter [PRT-13777]",
        "BQ24075 충전기 + BQ27441 퓨얼게이지(SOC), I2C 0x55",
        left=P("1:VIN 2:GND_IN"),
        right=P("3:BAT+ 4:BAT- 5:SYS+ 6:SYS- 7:SDA 8:SCL 9:GPOUT 10:GND"),
        width=45.72,
    ),
    "MLX90614": Sym(
        "MLX90614", "U", "MLX90614 [SEN0206]",
        "비접촉 IR 표면온도(MLX90614-DCC, FOV 35°). 주소는 EEPROM 0x0E로 변경 가능. Gravity 4핀 — 검정 GND / 빨강 VCC / 파랑 SDA / 초록 SCL",
        left=P("1:VCC 2:GND"), right=P("3:SDA 4:SCL"), width=33.02,
    ),
    "ADS1115": Sym(
        "ADS1115", "U", "ADS1115 [VLT-AD004]",
        "16비트 4채널 ADC, I2C 0x48. VDD=3.3V 구동이라 I2C 라인이 3.3V로 유지된다",
        left=P("1:A0 2:A1 3:A2 4:A3"),
        right=P("5:VDD 6:GND 7:SCL 8:SDA 9:ADDR 10:ALRT"),
        width=33.02,
    ),
    "DS18B20": Sym(
        "DS18B20", "U", "DS18B20 방수형 [SEN050007]",
        "셀 표면 접촉온도, 1-Wire 멀티드롭(고유 64비트 ROM 코드라 주소 설정 불필요). 빨강 VDD / 노랑 DQ / 검정 GND",
        right=P("1:VDD 2:DQ 3:GND"), width=38.1,
    ),
    "OLED": Sym(
        "OLED", "U", "OLED 0.96in SPI [CN0219]",
        "SSD1306 SPI 7핀. I2C가 아니다",
        right=P("1:GND 2:VCC 3:D0 4:D1 5:RES 6:DC 7:CS"), width=38.1,
    ),
    "RELAY4": Sym(
        "RELAY4", "K", "4CH Relay [SZH-RLBG-012]",
        "4채널 5V 릴레이. active-LOW. VCC-JD_VCC 점퍼 제거 후 VCC=3.3V / JD_VCC=5V",
        left=P("1:VCC 2:IN1 3:IN2 4:IN3 5:IN4 6:GND 7:JD_VCC"),
        right=P("8:CH1_COM 9:CH1_NO 10:CH1_NC "
                "11:CH2_COM 12:CH2_NO 13:CH2_NC "
                "14:CH3_COM 15:CH3_NO 16:CH3_NC "
                "17:CH4_COM 18:CH4_NO 19:CH4_NC"),
        width=45.72,
    ),
    "RPI5_HDR": Sym(
        "RPI5_HDR", "J", "Raspberry Pi 5 GPIO Header",
        "40핀 헤더. 좌측=홀수 핀, 우측=짝수 핀 (실물 배치와 동일)",
        left=_rpi_left, right=_rpi_right, width=53.34,
    ),
    "ZY12PDN": Sym(
        "ZY12PDN", "J", "ZY12PDN PD Trigger (5V)",
        "USB-C PD 트리거. 반드시 5V로 설정할 것 — 9V/12V면 Babysitter가 파손된다",
        right=P("1:VOUT+ 2:VOUT-"), width=40.64,
    ),
    "BW150": Sym(
        "BW150", "J", "ATORCH BW150 부하 입력",
        "전자부하. 데이터 경로가 아니라 방전 부하 + INA226 검증 기준기다",
        left=P("1:LOAD+ 2:LOAD-"), width=40.64,
    ),
    "FSR406": Sym(
        "FSR406", "RV", "FSR 406 [30-73258]",
        "스웰링 압력. 힘이 커지면 저항이 낮아진다 — 분압 고정저항 없이는 읽히지 않는다",
        left=P("1:1"), right=P("2:2"), width=30.48,
    ),
    "R": Sym(
        "R", "R", "R",
        "저항",
        left=P("1:1"), right=P("2:2"), width=17.78,
    ),
}


# ---------------------------------------------------------------- 배치·결선

@dataclass
class Inst:
    key: str          # 심볼 이름
    ref: str          # U1, K1 ...
    x: float
    y: float
    value: str | None = None
    nets: dict[str, str] = field(default_factory=dict)   # 핀 이름 -> 네트 이름
    nc: list[str] = field(default_factory=list)          # 미연결 표시할 핀 이름

    def __post_init__(self) -> None:
        self.x, self.y = snap(self.x), snap(self.y)


I2C = {"SDA": "I2C_SDA", "SCL": "I2C_SCL"}

INSTANCES: list[Inst] = [
    # ---- 배터리 전력 경로 (좌측 열)
    Inst("CELL", "BT1", 62, 40, nets={"+": "CELL_P", "-": "CELL_N"}),
    # 직렬 퓨즈 없음(2026-07-28 결정). 과전류 보호는 셀에 붙은 보호회로(PCM)에
    # 의존한다. 따라서 셀 +는 INA226 IN-와 VBUS에 같은 노드(CELL_P)로 직결된다.
    Inst("INA226", "U1", 62, 118, nets={
        "IN+": "RLY_CH3_IN", "IN-": "CELL_P", "VBUS": "CELL_P",
        "VCC": "+3V3", "GND": "GND", **I2C,
    }, nc=["ALE"]),

    # ---- 압력 (좌측 열 하단)
    Inst("FSR406", "RV1", 62, 168, nets={"1": "+3V3", "2": "FSR_OUT"}),
    Inst("R", "R1", 62, 192, value="10k", nets={"1": "FSR_OUT", "2": "GND"}),
    Inst("R", "R2", 62, 216, value="4.7k", nets={"1": "+3V3", "2": "OW_DATA"}),

    # ---- 릴레이 · 충방전 (가운데 열)
    Inst("RELAY4", "K1", 220, 78, nets={
        "VCC": "+3V3", "GND": "GND", "JD_VCC": "+5V_RLY",
        "IN1": "RLY_IN1", "IN2": "RLY_IN2", "IN3": "RLY_IN3", "IN4": "RLY_IN4",
        "CH1_COM": "V5_PD",       "CH1_NO": "RLY_CH1_OUT",
        "CH2_COM": "SYS_P",       "CH2_NO": "RLY_CH2_OUT",
        "CH3_COM": "RLY_CH3_IN",  "CH3_NO": "RLY_CH3_OUT",
    }, nc=["CH1_NC", "CH2_NC", "CH3_NC", "CH4_COM", "CH4_NO", "CH4_NC"]),

    Inst("BABYSITTER", "U2", 220, 168, nets={
        "VIN": "RLY_CH1_OUT", "GND_IN": "GND",
        "BAT+": "RLY_CH3_OUT", "BAT-": "CELL_N",
        "SYS+": "SYS_P", "SYS-": "GND",
        **I2C, "GND": "GND",
    }, nc=["GPOUT"]),

    Inst("ZY12PDN", "J2", 220, 218, nets={"VOUT+": "V5_PD", "VOUT-": "GND"}),
    Inst("BW150", "J3", 220, 248, nets={"LOAD+": "RLY_CH2_OUT", "LOAD-": "GND"}),

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
        "(18) GPIO24": "OLED_RES",
        "GPIO10/MOSI (19)": "SPI_MOSI",
        "(20) GND": "GND",
        "(22) GPIO25": "OLED_DC",
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

    # ---- 접촉 온도 3점 (1-Wire 멀티드롭 — 셋 다 같은 3선에 병렬)
    #      주소 설정이 필요 없다. 각 센서가 고유 64비트 ROM 코드를 갖는다.
    Inst("DS18B20", "U5", 400, 192, value="DS18B20 #1 (셀 하단)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U7", 400, 220, value="DS18B20 #2 (셀 중앙)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U8", 400, 248, value="DS18B20 #3 (셀 상단·단자쪽)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),

    # ---- I2C / SPI 주변 (최우측 열)
    # ---- IR 표면온도 2존. 둘 다 출고 시 0x5A이므로 U9는 EEPROM 0x0E를 0x5B로
    #      바꿔 두어야 한다. 반드시 한 개씩 따로 연결해서 작업할 것.
    Inst("MLX90614", "U3", 590, 42, value="MLX90614 #1 (0x5A, 셀 중앙)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("MLX90614", "U9", 590, 74, value="MLX90614 #2 (0x5B, 셀 단자쪽)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("ADS1115", "U4", 590, 114, nets={
        "A0": "FSR_OUT", "VDD": "+3V3", "GND": "GND", **I2C, "ADDR": "GND",
    }, nc=["A1", "A2", "A3", "ALRT"]),
    Inst("OLED", "U6", 590, 174, nets={
        "GND": "GND", "VCC": "+3V3",
        "D0": "SPI_SCLK", "D1": "SPI_MOSI",
        "RES": "OLED_RES", "DC": "OLED_DC", "CS": "SPI_CE0",
    }),

    # ---- 릴레이 IN 풀업 (부팅 중 오동작 방지)
    Inst("R", "R3", 590, 216, value="10k", nets={"1": "+3V3", "2": "RLY_IN1"}),
    Inst("R", "R4", 590, 234, value="10k", nets={"1": "+3V3", "2": "RLY_IN2"}),
    Inst("R", "R5", 590, 252, value="10k", nets={"1": "+3V3", "2": "RLY_IN3"}),
    Inst("R", "R6", 590, 270, value="10k", nets={"1": "+3V3", "2": "RLY_IN4"}),
]

# 라즈베리파이 헤더에서 쓰지 않는 핀은 전부 미연결 표시
_rpi = next(i for i in INSTANCES if i.key == "RPI5_HDR")
_all_rpi = [p.name for p in _rpi_left] + [p.name for p in _rpi_right]
_rpi.nc = [n for n in _all_rpi if n not in _rpi.nets]


# 주석은 3단 컬럼으로. (제목, [줄...]) 를 순서대로 쌓고 y는 자동으로 내린다.
_COLUMNS: list[tuple[float, list[tuple[str, str]]]] = [
    (20, [
        ("h1", "셀가드 — 모드 1 (외부 셀) 충·방전 계측 회로"),
        ("", "충전:  ZY12PDN 5V -[CH1]- Babysitter VIN -> (BQ24075) -> BAT+ -[CH3]- INA226 션트 - 셀 +"),
        ("", "[!] 직렬 퓨즈 없음.  과전류 보호는 셀에 붙은 보호회로(PCM)에만 의존한다."),
        ("", "    보호회로 없는 맨 셀(unprotected)을 물리면 배선 단락 시 아무 보호도 없다 — 실물 확인 필수."),
        ("", "방전:  셀 + -> ... -> Babysitter SYS+ -[CH2]- ATORCH BW150 부하 +"),
        ("", "부호 규약:  INA226 IN+ -> IN- 방향(릴레이 -> 셀)이 양수 = 충전.  방전은 음수."),
        ("", ""),
        ("h2", "[!] 조립 전 반드시 확인 — 여기서 틀리면 부품이 탄다"),
        ("", "1. ZY12PDN을 5V로 설정했는가.  9V/12V면 Babysitter가 즉시 파손된다."),
        ("", "2. 릴레이 VCC-JD_VCC 점퍼를 뽑았는가.  VCC=Pi 3.3V(옵토측), JD_VCC=5V(코일측)."),
        ("", "   점퍼를 꽂아 두면 VCC=5V가 되어 3.3V 로직으로 옵토 LED를 확실히 끄지 못한다."),
        ("", "3. INA226 보드의 션트 저항값을 실크스크린에서 읽었는가."),
        ("", "   R100=0.1ohm / R010=0.01ohm / R002=0.002ohm -> Calibration 레지스터 값이 달라진다."),
        ("", "   전류 측정 상한은 션트가 아니라 16비트 Current 레지스터가 정한다 -> 기본 설정에서 3.28A."),
        ("", "4. 셀 -(음극)를 시스템 GND에 직접 연결하지 마라."),
        ("", "   CELL_N은 Babysitter BAT- 하나에만 간다. BQ27441의 20mohm 센스 저항이"),
        ("", "   BAT-와 GND 사이에 있어서, 직결하면 이 저항이 단락되고 SOC가 안 나온다."),
        ("", ""),
        ("h2", "[!] 릴레이는 active-LOW다"),
        ("", "GPIO=0 -> 접점 붙음(도통) / GPIO=1 -> 접점 떨어짐(차단)."),
        ("", "모든 배터리 경로가 NO 접점을 지나므로 정전 / 부팅 중 / 크래시 = 자동 차단(fail-safe)."),
        ("", "부팅 초기 보호 2중화:  IN1~IN4에 10k 풀업(R3~R6)"),
        ("", "                        + /boot/firmware/config.txt 에 gpio=5,6,13,19=op,dh"),
        ("", "  ※ config.txt 쪽은 Pi 5 에서 안 먹을 수 있다. 전원 인가 순간부터 확실한 건 10k 풀업뿐이니"),
        ("", "     R3~R6 을 절대 생략하지 마라.  재부팅 후 pinctrl get 5,6,13,19 으로 확인할 것."),
    ]),
    (300, [
        ("h1", "릴레이 채널 배분"),
        ("", "CH1  충전 경로    ZY12PDN 5V -> Babysitter VIN       GPIO5   (물리핀 29)"),
        ("", "CH2  방전 경로    Babysitter SYS+ -> BW150 부하 +    GPIO6   (물리핀 31)"),
        ("", "CH3  마스터 차단  셀 + 메인 경로 분리                GPIO13  (물리핀 33)"),
        ("", "CH4  예비 (모드 2용, 미배선)                          GPIO19  (물리핀 35)"),
        ("", ""),
        ("", "인터락: CH1과 CH2를 동시에 0으로 두지 마라."),
        ("", "        전환 시 이전 채널을 1로 올리고 50ms 이상 기다린 뒤 다음 채널을 0으로."),
        ("", "CH3을 열면 셀이 완전히 분리된다. BQ27441(SOC)은 꺼지지만"),
        ("", "INA226은 Pi 3.3V로 동작하므로 셀 전압 감시는 계속된다."),
        ("", ""),
        ("h1", "I2C 주소 맵 (버스 1, 3.3V)"),
        ("", "0x40   INA226      전압 · 전류 · 전력"),
        ("", "0x48   ADS1115     A0=FSR 압력 / A1~A3 예비 (ADDR -> GND)"),
        ("", "0x55   BQ27441     SOC (Battery Babysitter 탑재)"),
        ("", "0x5A   MLX90614 #1  IR 표면온도 - 셀 중앙   (SEN0206 = MLX90614-DCC, FOV 35도)"),
        ("", "0x5B   MLX90614 #2  IR 표면온도 - 셀 단자쪽 (EEPROM 0x0E 로 주소 변경한 개체)"),
        ("", ""),
        ("h2", "[!] 온도는 다점 측정 -> 최댓값을 쓴다"),
        ("", "MLX90614 소자 1개는 FOV 안의 '평균'만 낸다. 그래서 2개를 다른 지점에 겨눠 공간 피크를 만든다."),
        ("", "   temp_ir_surface = max(#1, #2)      temp_contact = max(DS18B20 #1, #2, #3)"),
        ("", "DS18B20 3개는 같은 3선(GPIO4 + 3.3V + GND)에 병렬로 문다. 1-Wire는 고유 64비트 ROM 코드를"),
        ("", "쓰므로 주소 설정이 필요 없다. Skip ROM + Convert T 로 셋을 동시에 변환해 750ms 그대로다."),
        ("", ""),
        ("h2", "[!] MLX90614 부착 거리 — 2cm 이내"),
        ("", "FOV 35도 -> 측정 스팟 지름 = 0.63 x 거리.  2cm 에서 1.26cm 로 18650(지름 1.8cm) 안에 들어간다."),
        ("", "5cm 떨어지면 스팟이 3.15cm 라 배경 온도가 절반 넘게 섞여 셀보다 낮게 읽힌다."),
        ("", "출고 상태는 갱신 865ms + 스파이크 50% 감쇠다. EEPROM 0x25 재설정 필수 -> backend_spec.md 6-3"),
        ("", ""),
        ("", "확인:  sudo i2cdetect -y 1  ->  40  48  55  5a  네 개가 보여야 한다."),
    ]),
    (580, [
        ("h1", "Raspberry Pi 5 헤더 배선"),
        ("", "물리핀 1, 17   3.3V        센서 · OLED · 릴레이 VCC(옵토측)"),
        ("", "물리핀 2       5V          릴레이 JD_VCC(코일측)"),
        ("", "물리핀 3       GPIO2/SDA   I2C 데이터"),
        ("", "물리핀 5       GPIO3/SCL   I2C 클럭"),
        ("", "물리핀 7       GPIO4       1-Wire (+ 4.7k 풀업 -> 3.3V) -> DS18B20 x3 (병렬)"),
        ("", "물리핀 18      GPIO24      OLED RES"),
        ("", "물리핀 19      GPIO10      OLED D1 (MOSI)"),
        ("", "물리핀 22      GPIO25      OLED DC"),
        ("", "물리핀 23      GPIO11      OLED D0 (SCLK)"),
        ("", "물리핀 24      GPIO8       OLED CS (SPI0 CE0)"),
        ("", "물리핀 29/31/33/35         릴레이 IN1 / IN2 / IN3 / IN4"),
        ("", "물리핀 6,9,14,20,25,30,34,39   GND (스타 그라운드)"),
        ("", ""),
        ("h2", "이번 회로에 없는 것"),
        ("", "MQ-2 가스(보류) / 음향 센서(미구매)  ->  gas_raw, acoustic_raw 는 null."),
        ("", "PCB 없음 — 기성 모듈 + 배선 하네스다."),
        ("", ""),
        ("h2", "미확보 부품 — 조립 전 확보"),
        ("", "18650 홀더, JST 2.0 커넥터, 4.7k/10k 저항,"),
        ("", "5V 3A+ 어댑터, 캡톤 테이프 · 서멀 패드 x3, 외장 케이스."),
        ("", ""),
        ("", "예비품 없음: DS18B20 3개와 MLX90614 2개를 전부 투입했다. 고장 시 교체품이 없다."),
    ]),
]

_SIZES = {"h1": (3.0, 9.0), "h2": (2.5, 8.0), "": (2.0, 5.2)}

NOTES: list[tuple[float, float, float, str]] = []
for _x, _lines in _COLUMNS:
    _y = 305.0
    for _kind, _s in _lines:
        _size, _step = _SIZES[_kind]
        if _s:
            NOTES.append((_x, _y, _size, _s))
        _y += _step if _s else 3.0


# ---------------------------------------------------------------- 직렬화

def sexp_sym_def(s: Sym) -> str:
    w, h = s.width, s.height
    loc = s.local_pins()
    lines = [
        f'\t\t(symbol "{LIB}:{s.name}"',
        '\t\t\t(pin_names (offset 0.508))',
        '\t\t\t(exclude_from_sim no)',
        '\t\t\t(in_bom yes)',
        '\t\t\t(on_board yes)',
        f'\t\t\t(property "Reference" "{s.ref}" (at {-w/2:.2f} {h/2 + 3.81:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (justify left bottom)))',
        f'\t\t\t(property "Value" "{s.value}" (at {-w/2:.2f} {h/2 + 1.27:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (justify left bottom)))',
        '\t\t\t(property "Footprint" "" (at 0 0 0) (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        '\t\t\t(property "Datasheet" "" (at 0 0 0) (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        f'\t\t\t(property "Description" "{s.desc}" (at 0 0 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        f'\t\t\t(symbol "{s.name}_0_1"',
        f'\t\t\t\t(rectangle (start {-w/2:.2f} {h/2:.2f}) (end {w/2:.2f} {-h/2:.2f})',
        '\t\t\t\t\t(stroke (width 0.254) (type default))',
        '\t\t\t\t\t(fill (type background))',
        '\t\t\t\t)',
        '\t\t\t)',
        f'\t\t\t(symbol "{s.name}_1_1"',
    ]
    for p in s.left + s.right:
        x, y, ang = loc[p.name]
        lines += [
            f'\t\t\t\t(pin {p.etype} line (at {x:.2f} {y:.2f} {ang}) (length {PIN_LEN})',
            f'\t\t\t\t\t(name "{p.name}" (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27))))',
            f'\t\t\t\t\t(number "{p.number}" (effects (font (face \"Apple SD Gothic Neo\") (size 1.016 1.016))))',
            '\t\t\t\t)',
        ]
    lines += ['\t\t\t)', '\t\t)']
    return "\n".join(lines)


def write_symbol_library() -> None:
    body = "\n".join(sexp_sym_def(s) for s in SYMBOLS.values())
    # 라이브러리 파일은 들여쓰기 한 단계가 적다
    body = "\n".join(line[1:] if line.startswith("\t") else line
                     for line in body.split("\n"))
    text = (
        "(kicad_symbol_lib\n"
        "\t(version 20241209)\n"
        '\t(generator "gen_mode1_sch.py")\n'
        '\t(generator_version "9.0")\n'
        f"{body}\n"
        ")\n"
    )
    (OUT / f"{LIB}.kicad_sym").write_text(text, encoding="utf-8")


def sexp_instance(inst: Inst) -> str:
    s = SYMBOLS[inst.key]
    h = s.height
    val = inst.value or s.value
    return "\n".join([
        '\t(symbol',
        f'\t\t(lib_id "{LIB}:{s.name}")',
        f'\t\t(at {inst.x:.2f} {inst.y:.2f} 0)',
        '\t\t(unit 1)',
        '\t\t(exclude_from_sim no)',
        '\t\t(in_bom yes)',
        '\t\t(on_board yes)',
        '\t\t(dnp no)',
        f'\t\t(uuid "{uid("inst", inst.ref)}")',
        f'\t\t(property "Reference" "{inst.ref}"'
        f' (at {inst.x - s.width/2:.2f} {inst.y - h/2 - 3.81:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (justify left bottom)))',
        f'\t\t(property "Value" "{val}"'
        f' (at {inst.x - s.width/2:.2f} {inst.y - h/2 - 1.27:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (justify left bottom)))',
        f'\t\t(property "Footprint" "" (at {inst.x:.2f} {inst.y:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        f'\t\t(property "Datasheet" "" (at {inst.x:.2f} {inst.y:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        f'\t\t(property "Description" "{s.desc}" (at {inst.x:.2f} {inst.y:.2f} 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        '\t\t(instances',
        f'\t\t\t(project "{PROJECT}"',
        f'\t\t\t\t(path "/{_ROOT}" (reference "{inst.ref}") (unit 1))',
        '\t\t\t)',
        '\t\t)',
        '\t)',
    ])


def sexp_wire(x1: float, y1: float, x2: float, y2: float, key: str) -> str:
    return "\n".join([
        '\t(wire',
        f'\t\t(pts (xy {x1:.2f} {y1:.2f}) (xy {x2:.2f} {y2:.2f}))',
        '\t\t(stroke (width 0) (type default))',
        f'\t\t(uuid "{uid("wire", key)}")',
        '\t)',
    ])


def sexp_glabel(name: str, x: float, y: float, ang: int, key: str) -> str:
    just = "left" if ang == 0 else "right"
    return "\n".join([
        f'\t(global_label "{name}"',
        '\t\t(shape bidirectional)',
        f'\t\t(at {x:.2f} {y:.2f} {ang})',
        f'\t\t(effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (justify {just}))',
        f'\t\t(uuid "{uid("gl", key)}")',
        '\t\t(property "Intersheetrefs" "${INTERSHEET_REFS}" (at 0 0 0)'
        ' (effects (font (face \"Apple SD Gothic Neo\") (size 1.27 1.27)) (hide yes)))',
        '\t)',
    ])


def sexp_nc(x: float, y: float, key: str) -> str:
    return f'\t(no_connect (at {x:.2f} {y:.2f}) (uuid "{uid("nc", key)}"))'


def sexp_text(x: float, y: float, size: float, s: str, key: str) -> str:
    return "\n".join([
        f'\t(text "{s}"',
        '\t\t(exclude_from_sim no)',
        f'\t\t(at {x:.2f} {y:.2f} 0)',
        f'\t\t(effects (font (face \"Apple SD Gothic Neo\") (size {size} {size})) (justify left bottom))',
        f'\t\t(uuid "{uid("txt", key)}")',
        '\t)',
    ])


def write_schematic() -> None:
    parts: list[str] = []
    used_syms = {i.key for i in INSTANCES}
    lib_defs = "\n".join(sexp_sym_def(SYMBOLS[k])
                         for k in SYMBOLS if k in used_syms)

    for inst in INSTANCES:
        sym = SYMBOLS[inst.key]
        loc = sym.local_pins()
        parts.append(sexp_instance(inst))

        for pin_name, net in inst.nets.items():
            if pin_name not in loc:
                raise KeyError(f"{inst.ref}: 심볼 {inst.key}에 핀 '{pin_name}' 없음")
            lx, ly, ang = loc[pin_name]
            # 심볼 로컬은 Y가 위로, 회로도는 Y가 아래로 증가한다
            px, py = inst.x + lx, inst.y - ly
            dx = -STUB if ang == 0 else STUB
            ex = px + dx
            key = f"{inst.ref}.{pin_name}"
            parts.append(sexp_wire(px, py, ex, py, key))
            # 라벨은 핀 각도의 반대로 눕혀야 심볼 바깥으로 뻗는다.
            # 같은 각도를 쓰면 라벨이 심볼 위를 덮어 핀 번호가 가려진다.
            parts.append(sexp_glabel(net, ex, py, 180 if ang == 0 else 0, key))

        for pin_name in inst.nc:
            lx, ly, ang = loc[pin_name]
            parts.append(sexp_nc(inst.x + lx, inst.y - ly, f"{inst.ref}.{pin_name}"))

    for idx, (x, y, size, s) in enumerate(NOTES):
        parts.append(sexp_text(x, y, size, s, idx))

    text = "\n".join([
        "(kicad_sch",
        "\t(version 20250114)",
        '\t(generator "gen_mode1_sch.py")',
        '\t(generator_version "9.0")',
        f'\t(uuid "{_ROOT}")',
        '\t(paper "A1")',   # 주석량 때문에 A2로는 모자란다
        # 제목란은 KiCad가 자체 폰트로 그려서 face 지정이 먹지 않는다.
        # 한글을 넣으면 글자가 통째로 사라지므로 ASCII로만 쓴다.
        '\t(title_block',
        '\t\t(title "CellGuard Mode 1 - External Cell Charge/Discharge Measurement")',
        '\t\t(company "Battery Thermal Runaway Task Force")',
        '\t\t(comment 1 "Generated by tools/gen_mode1_sch.py - edit the script, not this file")',
        '\t\t(comment 2 "Beginner guide: docs/hardware/mode1_beginner_guide.md")',
        '\t\t(comment 3 "Backend spec:   docs/hardware/mode1_backend_spec.md")',
        '\t\t(comment 4 "No PCB - off-the-shelf modules + wiring harness")',
        '\t)',
        '\t(lib_symbols',
        lib_defs,
        '\t)',
        "\n".join(parts),
        '\t(sheet_instances',
        '\t\t(path "/" (page "1"))',
        '\t)',
        '\t(embedded_fonts no)',
        ")",
        "",
    ])
    (OUT / f"{PROJECT}.kicad_sch").write_text(text, encoding="utf-8")


def write_project_files() -> None:
    (OUT / "sym-lib-table").write_text(
        "(sym_lib_table\n"
        "  (version 7)\n"
        f'  (lib (name "{LIB}")(type "KiCad")(uri "${{KIPRJMOD}}/{LIB}.kicad_sym")'
        '(options "")(descr "셀가드 모드 1 전용 모듈 심볼"))\n'
        ")\n",
        encoding="utf-8",
    )
    (OUT / f"{PROJECT}.kicad_pro").write_text(
        '{\n'
        '  "board": {},\n'
        '  "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},\n'
        '  "meta": {"filename": "' + PROJECT + '.kicad_pro", "version": 3},\n'
        '  "schematic": {"legacy_lib_dir": "", "legacy_lib_list": []},\n'
        '  "sheets": [["' + _ROOT + '", "Root"]],\n'
        '  "text_variables": {}\n'
        '}\n',
        encoding="utf-8",
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_symbol_library()
    write_schematic()
    write_project_files()
    nets = sorted({n for i in INSTANCES for n in i.nets.values()})
    print(f"생성 완료: {OUT}")
    print(f"  심볼 {len(SYMBOLS)}종 / 인스턴스 {len(INSTANCES)}개 / 네트 {len(nets)}개")
    print("  네트: " + ", ".join(nets))


if __name__ == "__main__":
    main()
