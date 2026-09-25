#!/usr/bin/env python3
"""셀가드 모드 1(외부 셀) 계측 회로도 KiCad 파일 생성기.

심볼 정의는 tools/cellguard_symbols.py, s-expression 직렬화는
tools/kicad_sch.py 에 있다. 이 파일에는 무엇을 어디에 잇는가(배치·결선)와
회로도 주석만 둔다.

모드 1·2 통합 회로는 tools/gen_combined_sch.py 다. 두 회로는 CH4 역할과
INA226 입력단(CELL_P vs SOURCE_P)이 다르므로 파일이 갈린다.

사용법:
    python3 tools/gen_mode1_sch.py

산출:
    hardware/mode1/cellguard.kicad_sym
    hardware/mode1/cellguard_mode1.kicad_sch
    hardware/mode1/sym-lib-table
    hardware/mode1/cellguard_mode1.kicad_pro
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cellguard_symbols import RPI_ALL, SYMBOLS          # noqa: E402
from kicad_sch import REPO, Inst, Schematic, build_notes  # noqa: E402

OUT = REPO / "hardware" / "mode1"
PROJECT = "cellguard_mode1"


# ---------------------------------------------------------------- 배치·결선

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

    # ---- 접촉 온도 3점 (1-Wire 멀티드롭 — 셋 다 같은 3선에 병렬)
    #      주소 설정이 필요 없다. 각 센서가 고유 64비트 ROM 코드를 갖는다.
    Inst("DS18B20", "U5", 400, 192, value="DS18B20 #1 (셀 하단)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U7", 400, 220, value="DS18B20 #2 (셀 중앙)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),
    Inst("DS18B20", "U8", 400, 248, value="DS18B20 #3 (셀 상단·단자쪽)",
         nets={"VDD": "+3V3", "DQ": "OW_DATA", "GND": "GND"}),

    # ---- I2C / SPI 주변 (최우측 열)
    # ---- 현장 표시 화면. OLED(CN0219)를 3.5in TFT로 교체(2026-08-05).
    #      SPI 배선은 OLED와 1:1로 같고 LED(백라이트) 한 가닥만 늘었다.
    #      터치를 쓰지 않으므로 T_* 5핀은 미결선. SDO도 읽기가 필요 없어 미결선.
    #      14핀이라 심볼이 길다 — 이 열의 맨 위에 두고 나머지를 아래로 밀었다.
    Inst("TFT35", "U6", 590, 68, nets={
        "VCC": "+3V3", "GND": "GND",
        "CS": "SPI_CE0", "RESET": "TFT_RES", "DC/RS": "TFT_DC",
        "SDI": "SPI_MOSI", "SCK": "SPI_SCLK", "LED": "+3V3",
    }, nc=["SDO", "T_CLK", "T_CS", "T_DIN", "T_DO", "T_IRQ"]),

    # ---- U3 = 셀 IR 표면온도, U9 = 실온(2026-09-25, Ta 레지스터). 둘 다 출고 시 0x5A이므로 U9는 EEPROM 0x0E를 0x5B로
    #      바꿔 두어야 한다. 반드시 한 개씩 따로 연결해서 작업할 것.
    Inst("MLX90614", "U3", 590, 124, value="MLX90614 #1 (0x5A, 셀 중앙)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("MLX90614", "U9", 590, 152, value="MLX90614 #2 (0x5B, 실온 - 셀을 겨누지 않음)",
         nets={"VCC": "+3V3", "GND": "GND", **I2C}),
    Inst("ADS1115", "U4", 590, 188, nets={
        "A0": "FSR_OUT", "VDD": "+3V3", "GND": "GND", **I2C, "ADDR": "GND",
    }, nc=["A1", "A2", "A3", "ALRT"]),

    # ---- 릴레이 IN 풀업 (부팅 중 오동작 방지)
    Inst("R", "R3", 590, 216, value="10k", nets={"1": "+3V3", "2": "RLY_IN1"}),
    Inst("R", "R4", 590, 234, value="10k", nets={"1": "+3V3", "2": "RLY_IN2"}),
    Inst("R", "R5", 590, 252, value="10k", nets={"1": "+3V3", "2": "RLY_IN3"}),
    Inst("R", "R6", 590, 270, value="10k", nets={"1": "+3V3", "2": "RLY_IN4"}),
]

# 라즈베리파이 헤더에서 쓰지 않는 핀은 전부 미연결 표시
_rpi = next(i for i in INSTANCES if i.key == "RPI5_HDR")
_rpi.nc = [n for n in RPI_ALL if n not in _rpi.nets]


# 주석은 3단 컬럼으로. (제목, [줄...]) 를 순서대로 쌓고 y는 자동으로 내린다.
COLUMNS: list[tuple[float, list[tuple[str, str]]]] = [
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
        ("", "4. 셀 -(음극)는 Babysitter BAT-(보드의 배터리 - 단자) 한 점에만 문다."),
        ("", "   이유는 SOC가 아니라 스타 그라운드다. 방전 2A가 신호 GND 레일을 지나면"),
        ("", "   전압 강하만큼 모든 센서의 기준점이 흔들린다."),
        ("", "   [주의] 공식 회로도 v10 확인: 배터리 -는 보드 GND에 직결이고, BQ27441"),
        ("", "   센스 저항 R11(10mohm)은 배터리 + 쪽 하이사이드(BATTERY_IN<->V_BATT)다."),
        ("", "   따라서 CELL_N <-> GND 도통은 정상이며 SOC와 무관하다."),
        ("", "5. Babysitter 온보드 스위치 2개를 맞춰라."),
        ("", "   S1 슬라이드 = SYSOFF (active-high, HIGH=OFF). OFF면 SYS+ 출력이 0이다."),
        ("", "   S2 DIP = EN1/EN2 (10k로 OUT 풀업). 출고 기본 1,1 = Standby = 충전 안 함."),
        ("", "   우리 설정: EN2=1, EN1=0 (DIP 1만 ON). I_CHG=890/590=1.5A, I_INMAX=1650/1100=1.5A."),
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
        ("", "0x5B   MLX90614 #2  실온 (Ta) - 셀·발열체에서 10cm 이상 (EEPROM 0x0E 로 주소 변경한 개체)"),
        ("", ""),
        ("h2", "[!] 온도는 다점 측정 -> 최댓값을 쓴다"),
        ("", "셀 IR 은 #1 한 존이고, #2 는 실온을 잰다 -> 발열값 = 표면온도 - 실온 (2026-09-25)."),
        ("", "   temp_ir_surface = #1      temp_contact = max(DS18B20 #1, #2, #3)      temp_ambient = #2 Ta"),
        ("", "DS18B20 3개는 같은 3선(GPIO4 + 3.3V + GND)에 병렬로 문다. 1-Wire는 고유 64비트 ROM 코드를"),
        ("", "쓰므로 주소 설정이 필요 없다. Skip ROM + Convert T 로 셋을 동시에 변환해 750ms 그대로다."),
        ("", ""),
        ("h2", "[!] MLX90614 #1 부착 거리 — 2cm 이내"),
        ("", "FOV 35도 -> 측정 스팟 지름 = 0.63 x 거리.  2cm 에서 1.26cm 로 18650(지름 1.8cm) 안에 들어간다."),
        ("", "5cm 떨어지면 스팟이 3.15cm 라 배경 온도가 절반 넘게 섞여 셀보다 낮게 읽힌다."),
        ("", "출고 상태는 갱신 865ms + 스파이크 50% 감쇠다. EEPROM 0x25 재설정 필수 -> backend_spec.md 6-3"),
        ("", ""),
        ("", "확인:  sudo i2cdetect -y 1  ->  40  48  55  5a  네 개가 보여야 한다."),
    ]),
    (580, [
        ("h1", "Raspberry Pi 5 헤더 배선"),
        ("", "물리핀 1, 17   3.3V        센서 · TFT(VCC+LED) · 릴레이 VCC(옵토측)"),
        ("", "물리핀 2       5V          릴레이 JD_VCC(코일측)"),
        ("", "물리핀 3       GPIO2/SDA   I2C 데이터"),
        ("", "물리핀 5       GPIO3/SCL   I2C 클럭"),
        ("", "물리핀 7       GPIO4       1-Wire (+ 4.7k 풀업 -> 3.3V) -> DS18B20 x3 (병렬)"),
        ("", "물리핀 18      GPIO24      TFT RESET"),
        ("", "물리핀 19      GPIO10      TFT SDI (MOSI)"),
        ("", "물리핀 22      GPIO25      TFT DC/RS"),
        ("", "물리핀 23      GPIO11      TFT SCK"),
        ("", "물리핀 24      GPIO8       TFT CS (SPI0 CE0)"),
        ("", "물리핀 29/31/33/35         릴레이 IN1 / IN2 / IN3 / IN4"),
        ("", "물리핀 6,9,14,20,25,30,34,39   GND (스타 그라운드)"),
        ("", ""),
        ("h2", "[!] TFT 3.5in — 표시 전용 9핀만 쓴다"),
        ("", "14핀 중 T_CLK / T_CS / T_DIN / T_DO / T_IRQ 5핀은 터치용이라 미결선."),
        ("", "SDO(MISO)도 화면에서 읽을 일이 없어 미결선 -> SPI0 은 MOSI 단방향이다."),
        ("", "LED(백라이트)는 3.3V 직결 = 상시 점등. 밝기 제어를 원하면 PWM GPIO 로 옮긴다."),
        ("", "SPI 배선 5가닥(CS/RESET/DC/SDI/SCK)은 교체 전 OLED와 GPIO가 완전히 같다."),
        ("", "[주의] VCC 는 3.3V 로 넣는다. 보드에 3.3V LDO 가 얹힌 개체는 3.3V 입력으로"),
        ("", "       드롭아웃이 모자라 화면이 안 켜질 수 있다 -> 그때만 5V(물리핀 2·4)로 옮긴다."),
        ("", "       로직(CS/SCK/SDI/DC/RESET)은 어느 쪽이든 3.3V TTL 이다."),
        ("", "[주의] ILI9488 은 SPI 에서 RGB565 를 못 쓴다. 픽셀당 3바이트(RGB666)라"),
        ("", "       480x320 전체 갱신이 약 460KB 다. 100ms 계측 루프에 전체 화면 갱신을"),
        ("", "       올리지 마라 -> 바뀐 영역만 부분 갱신하고, 표시는 계측과 별도 스레드로."),
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


def main() -> None:
    Schematic(
        out=OUT,
        project=PROJECT,
        generator="gen_mode1_sch.py",
        title="CellGuard Mode 1 - External Cell Charge/Discharge Measurement",
        comments=[
            "Generated by tools/gen_mode1_sch.py - edit the script, not this file",
            "Beginner guide: docs/hardware/mode1_beginner_guide.md",
            "Backend spec:   docs/hardware/mode1_backend_spec.md",
            "No PCB - off-the-shelf modules + wiring harness",
        ],
        symbols=SYMBOLS,
        instances=INSTANCES,
        notes=build_notes(COLUMNS),
        lib_descr="셀가드 모드 1 전용 모듈 심볼",
    ).write()


if __name__ == "__main__":
    main()
