#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tft_ili9488.py — 3.5인치 ILI9488 480x320 SPI 드라이버 (의존성 없음).

Debian Lite 에는 spidev·Pillow 가 없으므로 /dev/spidev0.0 과 /dev/gpiochip0 을
ctypes + ioctl 로 직접 때린다. 센서 로거들이 쓰는 방식과 같다.

배선은 가이드 STEP 8 그대로 (14핀 중 8핀):

    TFT 1 VCC   -> 3V3          TFT 6 SDI(MOSI) -> GPIO10 / MOSI
    TFT 2 GND   -> GND-B        TFT 7 SCK       -> GPIO11 / SCLK
    TFT 3 CS    -> GPIO8 / CE0  TFT 8 LED       -> 3V3  (백라이트)
    TFT 4 RESET -> GPIO24       TFT 9 SDO(MISO) -> 결선 안 함
    TFT 5 DC/RS -> GPIO25

⚠️ MISO 를 안 꽂았으므로 **쓰기 전용**이다. 상태 레지스터를 되읽어 확인할 수 없다.
   화면이 안 나오면 배선·전원·SPI 활성화를 눈으로 확인하는 수밖에 없다.

⚠️ ILI9488 은 SPI 에서 픽셀당 3바이트(RGB666)를 요구한다. 480x320 전체가 460KB 라
   전체 갱신을 계측 루프에 넣으면 측정이 밀린다. **바뀐 사각형만 다시 그린다.**

사전 준비 (파이에서 한 번):
    sudo raspi-config nonint do_spi 0      # 또는 /boot/firmware/config.txt 에
                                           # dtparam=spi=on 추가 후 재부팅
    ls /dev/spidev0.0                      # 있어야 한다
"""
import ctypes
import fcntl
import os
import struct
import time

# ── SPI (spidev ioctl) ──────────────────────────────────────────────
SPI_IOC_MAGIC = ord("k")
SPI_CPHA, SPI_CPOL = 0x01, 0x02


def _IOW(nr, size):
    return (1 << 30) | (size << 16) | (SPI_IOC_MAGIC << 8) | nr


SPI_IOC_WR_MODE = _IOW(1, 1)
SPI_IOC_WR_BITS_PER_WORD = _IOW(3, 1)
SPI_IOC_WR_MAX_SPEED_HZ = _IOW(4, 4)


def _spi_msg_ioc(n):
    return _IOW(0, ctypes.sizeof(_SpiTransfer) * n)


class _SpiTransfer(ctypes.Structure):
    _fields_ = [
        ("tx_buf", ctypes.c_uint64), ("rx_buf", ctypes.c_uint64),
        ("len", ctypes.c_uint32), ("speed_hz", ctypes.c_uint32),
        ("delay_usecs", ctypes.c_uint16), ("bits_per_word", ctypes.c_uint8),
        ("cs_change", ctypes.c_uint8), ("tx_nbits", ctypes.c_uint8),
        ("rx_nbits", ctypes.c_uint8), ("word_delay_usecs", ctypes.c_uint8),
        ("pad", ctypes.c_uint8),
    ]


# ── GPIO (gpiochip character device, GPIO_V2) ───────────────────────
# linux/gpio.h enum gpio_v2_line_flag — OUTPUT 은 비트 3 이다.
#   USED(0) / ACTIVE_LOW(1) / INPUT(2) / OUTPUT(3)
# 비트 1 로 잘못 쓰면 라인이 입력으로 잡혀 SET_VALUES 가 EPERM 을 낸다.
GPIO_V2_LINE_FLAG_OUTPUT = 1 << 3
GPIO_V2_LINES_MAX, GPIO_V2_LINE_NUM_ATTRS_MAX = 64, 10


class _LineAttribute(ctypes.Structure):
    _fields_ = [("id", ctypes.c_uint32), ("padding", ctypes.c_uint32),
                ("value", ctypes.c_uint64)]


class _LineConfigAttribute(ctypes.Structure):
    _fields_ = [("attr", _LineAttribute), ("mask", ctypes.c_uint64)]


class _LineConfig(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint64), ("num_attrs", ctypes.c_uint32),
                ("padding", ctypes.c_uint32 * 5),
                ("attrs", _LineConfigAttribute * GPIO_V2_LINE_NUM_ATTRS_MAX)]


class _LineRequest(ctypes.Structure):
    _fields_ = [("offsets", ctypes.c_uint32 * GPIO_V2_LINES_MAX),
                ("consumer", ctypes.c_char * 32), ("config", _LineConfig),
                ("num_lines", ctypes.c_uint32), ("event_buffer_size", ctypes.c_uint32),
                ("padding", ctypes.c_uint32 * 5), ("fd", ctypes.c_int32)]


class _LineValues(ctypes.Structure):
    _fields_ = [("bits", ctypes.c_uint64), ("mask", ctypes.c_uint64)]


GPIO_V2_GET_LINE_IOCTL = (3 << 30) | (ctypes.sizeof(_LineRequest) << 16) | (0xB4 << 8) | 0x07
GPIO_V2_LINE_SET_VALUES_IOCTL = (3 << 30) | (ctypes.sizeof(_LineValues) << 16) | (0xB4 << 8) | 0x0F


class _Gpio(object):
    """DC / RESET 두 줄만 출력으로 잡는다."""

    def __init__(self, chip, offsets, consumer=b"tft_ili9488"):
        self.chip_fd = os.open(chip, os.O_RDWR)
        req = _LineRequest()
        for i, off in enumerate(offsets):
            req.offsets[i] = off
        req.num_lines = len(offsets)
        req.consumer = consumer
        req.config.flags = GPIO_V2_LINE_FLAG_OUTPUT
        fcntl.ioctl(self.chip_fd, GPIO_V2_GET_LINE_IOCTL, req)
        self.fd = req.fd
        self.n = len(offsets)

    def set(self, index, high):
        v = _LineValues()
        v.mask = 1 << index
        v.bits = (1 << index) if high else 0
        fcntl.ioctl(self.fd, GPIO_V2_LINE_SET_VALUES_IOCTL, v)

    def close(self):
        os.close(self.fd)
        os.close(self.chip_fd)


# ── 5x7 폰트 (ASCII 32~126) ─────────────────────────────────────────
# 문자당 5바이트, 각 바이트가 세로 8픽셀 열 하나 (LSB 가 위).
_FONT = (
    b"\x00\x00\x00\x00\x00\x00\x00\x5f\x00\x00\x00\x07\x00\x07\x00\x14\x7f\x14\x7f\x14"
    b"\x24\x2a\x7f\x2a\x12\x23\x13\x08\x64\x62\x36\x49\x55\x22\x50\x00\x05\x03\x00\x00"
    b"\x00\x1c\x22\x41\x00\x00\x41\x22\x1c\x00\x14\x08\x3e\x08\x14\x08\x08\x3e\x08\x08"
    b"\x00\x50\x30\x00\x00\x08\x08\x08\x08\x08\x00\x60\x60\x00\x00\x20\x10\x08\x04\x02"
    b"\x3e\x51\x49\x45\x3e\x00\x42\x7f\x40\x00\x42\x61\x51\x49\x46\x21\x41\x45\x4b\x31"
    b"\x18\x14\x12\x7f\x10\x27\x45\x45\x45\x39\x3c\x4a\x49\x49\x30\x01\x71\x09\x05\x03"
    b"\x36\x49\x49\x49\x36\x06\x49\x49\x29\x1e\x00\x36\x36\x00\x00\x00\x56\x36\x00\x00"
    b"\x08\x14\x22\x41\x00\x14\x14\x14\x14\x14\x00\x41\x22\x14\x08\x02\x01\x51\x09\x06"
    b"\x32\x49\x79\x41\x3e\x7e\x11\x11\x11\x7e\x7f\x49\x49\x49\x36\x3e\x41\x41\x41\x22"
    b"\x7f\x41\x41\x22\x1c\x7f\x49\x49\x49\x41\x7f\x09\x09\x09\x01\x3e\x41\x49\x49\x7a"
    b"\x7f\x08\x08\x08\x7f\x00\x41\x7f\x41\x00\x20\x40\x41\x3f\x01\x7f\x08\x14\x22\x41"
    b"\x7f\x40\x40\x40\x40\x7f\x02\x0c\x02\x7f\x7f\x04\x08\x10\x7f\x3e\x41\x41\x41\x3e"
    b"\x7f\x09\x09\x09\x06\x3e\x41\x51\x21\x5e\x7f\x09\x19\x29\x46\x46\x49\x49\x49\x31"
    b"\x01\x01\x7f\x01\x01\x3f\x40\x40\x40\x3f\x1f\x20\x40\x20\x1f\x3f\x40\x38\x40\x3f"
    b"\x63\x14\x08\x14\x63\x07\x08\x70\x08\x07\x61\x51\x49\x45\x43\x00\x7f\x41\x41\x00"
    b"\x02\x04\x08\x10\x20\x00\x41\x41\x7f\x00\x04\x02\x01\x02\x04\x40\x40\x40\x40\x40"
    b"\x00\x01\x02\x04\x00\x20\x54\x54\x54\x78\x7f\x48\x44\x44\x38\x38\x44\x44\x44\x20"
    b"\x38\x44\x44\x48\x7f\x38\x54\x54\x54\x18\x08\x7e\x09\x01\x02\x0c\x52\x52\x52\x3e"
    b"\x7f\x08\x04\x04\x78\x00\x44\x7d\x40\x00\x20\x40\x44\x3d\x00\x7f\x10\x28\x44\x00"
    b"\x00\x41\x7f\x40\x00\x7c\x04\x18\x04\x78\x7c\x08\x04\x04\x78\x38\x44\x44\x44\x38"
    b"\x7c\x14\x14\x14\x08\x08\x14\x14\x18\x7c\x7c\x08\x04\x04\x08\x48\x54\x54\x54\x20"
    b"\x04\x3f\x44\x40\x20\x3c\x40\x40\x20\x7c\x1c\x20\x40\x20\x1c\x3c\x40\x30\x40\x3c"
    b"\x44\x28\x10\x28\x44\x0c\x50\x50\x50\x3c\x44\x64\x54\x4c\x44\x00\x08\x36\x41\x00"
    b"\x00\x00\x7f\x00\x00\x00\x41\x36\x08\x00\x08\x08\x2a\x1c\x08"
)

# ── 색 (RGB888; 드라이버가 RGB666 으로 줄인다) ──────────────────────
BLACK, WHITE = 0x000000, 0xFFFFFF
GREY, DARK = 0x808080, 0x202020
RED, AMBER, GREEN = 0xFF3B30, 0xFF9500, 0x34C759
BLUE, CYAN = 0x2A78D6, 0x46B8C4


class ILI9488(object):
    WIDTH, HEIGHT = 480, 320          # 가로 방향(rotation=1) 기준

    def __init__(self, spi_dev="/dev/spidev0.0", chip="/dev/gpiochip0",
                 dc=25, reset=24, speed_hz=32000000, rotation=1):
        self.fd = os.open(spi_dev, os.O_RDWR)
        fcntl.ioctl(self.fd, SPI_IOC_WR_MODE, struct.pack("B", 0))     # mode 0
        fcntl.ioctl(self.fd, SPI_IOC_WR_BITS_PER_WORD, struct.pack("B", 8))
        fcntl.ioctl(self.fd, SPI_IOC_WR_MAX_SPEED_HZ, struct.pack("I", speed_hz))
        self.speed = speed_hz
        self.gpio = _Gpio(chip, [dc, reset])
        self.DC, self.RST = 0, 1
        self.rotation = rotation
        self._reset()
        self._init_panel()

    # ── 저수준 ──────────────────────────────────────────────────────
    def _xfer(self, data):
        """한 번의 ioctl 로 보낸다. 커널 버퍼 한계를 고려해 4KB 씩 자른다."""
        mv = memoryview(data)
        CH = 4096
        for i in range(0, len(mv), CH):
            chunk = bytes(mv[i:i + CH])
            buf = ctypes.create_string_buffer(chunk, len(chunk))
            tr = _SpiTransfer(tx_buf=ctypes.addressof(buf), rx_buf=0,
                              len=len(chunk), speed_hz=self.speed,
                              delay_usecs=0, bits_per_word=8, cs_change=0)
            fcntl.ioctl(self.fd, _spi_msg_ioc(1), tr)

    def cmd(self, c, *args):
        self.gpio.set(self.DC, False)
        self._xfer(bytes([c]))
        if args:
            self.gpio.set(self.DC, True)
            self._xfer(bytes(args))

    def _data(self, payload):
        self.gpio.set(self.DC, True)
        self._xfer(payload)

    def _reset(self):
        self.gpio.set(self.RST, True); time.sleep(0.01)
        self.gpio.set(self.RST, False); time.sleep(0.02)
        self.gpio.set(self.RST, True); time.sleep(0.15)

    def _init_panel(self):
        c = self.cmd
        c(0x01); time.sleep(0.12)                      # software reset
        c(0xE0, 0x00, 0x03, 0x09, 0x08, 0x16, 0x0A, 0x3F, 0x78,
          0x4C, 0x09, 0x0A, 0x08, 0x16, 0x1A, 0x0F)    # positive gamma
        c(0xE1, 0x00, 0x16, 0x19, 0x03, 0x0F, 0x05, 0x32, 0x45,
          0x46, 0x04, 0x0E, 0x0D, 0x35, 0x37, 0x0F)    # negative gamma
        c(0xC0, 0x17, 0x15)                            # power control 1
        c(0xC1, 0x41)                                  # power control 2
        c(0xC5, 0x00, 0x12, 0x80)                      # VCOM
        c(0x3A, 0x66)                                  # ★ 18bit RGB666 (SPI 필수)
        c(0xB0, 0x00)                                  # interface mode
        c(0xB1, 0xA0)                                  # frame rate
        c(0xB4, 0x02)                                  # display inversion
        c(0xB6, 0x02, 0x02)                            # display function
        c(0xE9, 0x00)                                  # image function
        c(0xF7, 0xA9, 0x51, 0x2C, 0x82)                # adjust control 3
        self.set_rotation(self.rotation)
        c(0x11); time.sleep(0.12)                      # sleep out
        c(0x29)                                        # display on

    def set_rotation(self, r):
        # MADCTL. 1 = 가로(480x320), 0 = 세로(320x480)
        madctl = {0: 0x48, 1: 0x28, 2: 0x88, 3: 0xE8}[r % 4]
        self.cmd(0x36, madctl)
        self.rotation = r % 4
        if self.rotation % 2:
            self.WIDTH, self.HEIGHT = 480, 320
        else:
            self.WIDTH, self.HEIGHT = 320, 480

    def _window(self, x, y, w, h):
        x1, y1 = x + w - 1, y + h - 1
        self.cmd(0x2A, x >> 8, x & 0xFF, x1 >> 8, x1 & 0xFF)
        self.cmd(0x2B, y >> 8, y & 0xFF, y1 >> 8, y1 & 0xFF)
        self.cmd(0x2C)

    # ── 그리기 ──────────────────────────────────────────────────────
    def fill_rect(self, x, y, w, h, color):
        if w <= 0 or h <= 0:
            return
        x = max(0, min(x, self.WIDTH - 1)); y = max(0, min(y, self.HEIGHT - 1))
        w = min(w, self.WIDTH - x); h = min(h, self.HEIGHT - y)
        px = bytes(((color >> 16) & 0xFC, (color >> 8) & 0xFC, color & 0xFC))
        self._window(x, y, w, h)
        self._data(px * (w * h))

    def clear(self, color=BLACK):
        self.fill_rect(0, 0, self.WIDTH, self.HEIGHT, color)

    def text(self, x, y, s, color=WHITE, bg=BLACK, scale=2):
        """5x7 폰트를 scale 배로 확대해 그린다.

        문자열 전체를 메모리에서 한 장으로 합성한 뒤 **한 번의 윈도우 전송**으로
        보낸다. 켜진 픽셀마다 fill_rect 를 부르면 글자 하나에 ioctl 이 수백 번
        나가 1Hz 갱신도 못 맞춘다.
        """
        if not s:
            return
        cw = 6 * scale                       # 글자 5 + 자간 1
        w, h = cw * len(s), 8 * scale
        if x >= self.WIDTH or y >= self.HEIGHT:
            return
        w = min(w, self.WIDTH - x)
        h = min(h, self.HEIGHT - y)

        fg = bytes(((color >> 16) & 0xFC, (color >> 8) & 0xFC, color & 0xFC))
        bgp = bytes(((bg >> 16) & 0xFC, (bg >> 8) & 0xFC, bg & 0xFC))
        buf = bytearray(bgp * (w * h))

        for ci, ch in enumerate(s):
            o = (ord(ch) - 32) * 5
            if o < 0 or o + 5 > len(_FONT):
                continue
            gx = ci * cw
            for col in range(5):
                bits = _FONT[o + col]
                for row in range(8):
                    if not (bits & (1 << row)):
                        continue
                    px0, py0 = gx + col * scale, row * scale
                    for dy in range(scale):
                        py = py0 + dy
                        if py >= h:
                            break
                        base = (py * w + px0) * 3
                        n = min(scale, w - px0)
                        if n > 0:
                            buf[base:base + n * 3] = fg * n

        self._window(x, y, w, h)
        self._data(bytes(buf))

    def close(self):
        try:
            self.gpio.close()
        finally:
            os.close(self.fd)


if __name__ == "__main__":
    d = ILI9488()
    d.clear(BLACK)
    d.text(20, 20, "ILI9488 OK", GREEN, scale=4)
    d.text(20, 70, "480x320 RGB666 write-only", GREY, scale=2)
    for i, c in enumerate((RED, AMBER, GREEN, BLUE, CYAN, WHITE)):
        d.fill_rect(20 + i * 70, 120, 60, 60, c)
    d.text(20, 210, "CellGuard BMS", CYAN, scale=3)
    print("그려졌다. 화면이 까맣다면 TFT 8번 LED 핀이 3V3 에 물렸는지 확인할 것.")
