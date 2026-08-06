#!/usr/bin/env python3
"""셀가드 회로도 심볼 라이브러리 정의.

기성 모듈을 배선으로 잇는 하네스라 PCB는 없다. 심볼도 KiCad 기본
라이브러리에 없는 브레이크아웃뿐이라 프로젝트 자체 라이브러리를 함께 만든다.
심볼 핀 이름은 실물 모듈의 실크스크린 글자를 그대로 쓴다 — 회로도와 실물을
1:1로 대조해야 하는 초보자가 볼 문서이기 때문이다.

모드 1 전용 회로와 모드 1·2 통합 회로가 이 정의를 공유한다.
통합 회로에서만 쓰는 심볼(POWERBANK·SRC_SEL)은 COMBINED_ONLY에 있다.
"""

from __future__ import annotations

from kicad_sch import P, Pin, Sym

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

RPI_LEFT = [Pin(f"{RPI_PINS[i]} ({i + 1})", str(i + 1)) for i in range(0, 40, 2)]
RPI_RIGHT = [Pin(f"({i + 1}) {RPI_PINS[i]}", str(i + 1)) for i in range(1, 40, 2)]
RPI_ALL = [p.name for p in RPI_LEFT] + [p.name for p in RPI_RIGHT]


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
        "BQ24075 충전기 + BQ27441 퓨얼게이지(SOC), I2C 0x55. "
        "핀 이름은 회로도 규약이며 보드 실크스크린과 다르다 -- "
        "VIN/GND_IN=VIN +/-, SYS+/SYS-=VOUT +/-, BAT+/BAT-=JST +/-. "
        "GND/GND_IN/SYS-는 보드 안에서 같은 GND 네트",
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
    "TFT35": Sym(
        "TFT35", "U", "TFT 3.5in SPI 480x320 V1.0",
        "ILI9488 + 저항막 터치 14핀. 표시 전용 9핀만 쓰고 T_* 5핀과 SDO는 미결선. "
        "로직은 3.3V(TTL)",
        right=P("1:VCC 2:GND 3:CS 4:RESET 5:DC/RS 6:SDI 7:SCK 8:LED 9:SDO "
                "10:T_CLK 11:T_CS 12:T_DIN 13:T_DO 14:T_IRQ"),
        width=45.72,
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
        left=RPI_LEFT, right=RPI_RIGHT, width=53.34,
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


# ------------------------------------------------- 모드 1·2 통합 회로 전용
#
# 통합 회로는 INA226 IN-/VBUS 앞에 SOURCE_P 라는 단일 체결점을 두고
# 모드 1의 셀 +와 모드 2의 USB-A VBUS 중 하나만 번갈아 물린다.
# 두 양극을 동시에 물면 셀과 보조배터리가 서로를 향해 방전하는데
# 이 회로에는 그것을 막을 다이오드도 퓨즈도 없다.

COMBINED_ONLY: dict[str, Sym] = {
    "SRC_SEL": Sym(
        "SRC_SEL", "TB", "SOURCE_P 단일 체결점 (나사 단자)",
        "모드 1 셀 + 와 모드 2 USB-A VBUS 중 정확히 하나만 체결한다. "
        "하드웨어 인터락이 아니라 작업 절차로만 막는 지점이라 "
        "한 가닥만 라벨을 붙이고 미사용 양극은 개별 절연한다",
        left=P("1:M1_CELL_P 2:M2_VBUS"), right=P("3:SOURCE_P"), width=50.8,
    ),
    "POWERBANK": Sym(
        "POWERBANK", "PB", "USB 보조배터리 + USB-A 수 플러그 (20cm 이하 / 20AWG 이상)",
        "모드 2 측정 대상. 완제품이라 셀에 접근할 수 없고 내부 BMS 문턱도 모른다. "
        "충전은 외부 충전기로 하고 이 회로는 출력 방전만 계측한다. "
        "D+/D-는 각각 절연 — 서로 또는 GND에 연결하지 않는다",
        right=P("1:VBUS 2:D- 3:D+ 4:GND"), width=53.34,
    ),
}
