#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bench_display.py — 방전 시험 상태를 3.5인치 TFT 에 띄운다.

    python3 ~/bench_display.py --name PB20K_15W    # 1초 갱신
    python3 ~/bench_display.py --interval 0.5
    python3 ~/bench_display.py --demo              # 센서 없이 화면만 확인

설계상 지켜야 하는 것

  · **부분 갱신만 한다.** ILI9488 은 SPI 에서 픽셀당 3바이트(RGB666)를 쓰므로
    480x320 전체가 460KB 다. 매 주기 전체를 다시 그리면 계측이 밀린다.
    값이 바뀐 칸만 지우고 다시 쓴다 (`_Field`).

  · **칸에 안 들어가는 글자는 조용히 잘린다.** `_Field` 는 `w // (6*scale)` 만큼만
    쓴다. 2026-09-20 이전 판은 값 칸이 6글자였는데 "4.123 V" 가 7글자라
    **단위가 통째로 잘려 나가고 있었다.** 그래서 지금은 단위를 회색 라벨로 올리고
    값 칸에는 숫자만 넣는다. 칸을 새로 만들 때는 `_fits()` 로 먼저 재 볼 것.

  · **DS18B20 은 따로 느리게 읽는다.** 2026-09-20 실측 (파이 4, 1회 평균):

        INA226 3 레지스터      2.01 ms
        MLX90614 x2           1.43 ms
        pinctrl 릴레이         4.93 ms
        DS18B20 x2         1598.43 ms   <- 여기에 다 쓴다
        SPI 전체 칸 다시 그리기  70 ms

    1-Wire 변환이 센서당 800ms 라 **DS 를 매 주기 읽으면 1Hz 가 원천적으로 안 된다**
    (실제 주기가 1.7초였다). 게다가 그 버스는 thermal_log_alarm 이 1초로 쓰는
    버스라 둘이 붙으면 로거 쪽 간격이 늘어난다. 그래서 DS 만 `--ds-interval`
    (기본 30초) 로 **딴 실에** 떼어 놓는다. **I2C 3.5ms 는 ina_log 0.1초와
    부딪히지 않는다** — i2cstress 로 채널당 1,311 회 무결함이 확인된 버스다.

    주기를 30초로 둔 이유: 1-Wire 를 한 번 읽을 때마다 1.6초를 점유하므로
    점유율이 1.6/(T+1.6) 이다. T=10 이면 14%, T=30 이면 5% 다. 그만큼이
    thermal_log_alarm 의 표본에서 빠진다. 셀·실온은 열용량이 커서 분 단위로
    움직이고, 실제 보호는 1Hz 로 도는 IR(tempguard)이 맡으므로 30초면 넉넉하다.

  · **온도는 max(0x5A, 0x5B) 핫스팟**을 쓴다. 평균이 아니다 — 한쪽 겨냥이
    빗나가면 실온을 읽어 평균이 신호를 죽인다. 두 센서 각각의 값은 하단
    진단줄에 따로 띄운다. run 중에 한쪽만 오르면 그쪽만 셀을 보고 있는 것이다
    (CLAUDE.md 핵심 발견 10, 2026-08-31 항목).

  · **0x7FFF 는 값이 아니다.** raw 가 0x7FFF 면 382.19℃ 가 나오는데 에러
    플래그(0x8000)를 한 비트 차이로 빠져나간다. mlx_sane() 이 걸러낸다.

  · **누적 mAh/Wh 는 이 화면이 자체 적분한 참고값이다.** 1Hz 사다리꼴이라
    ina_log.py 의 0.1초 적분보다 거칠고, 화면을 재시작하면 0 으로 돌아간다.
    **분석에 쓰는 값이 아니다** — run 이 예상대로 가고 있는지 보는 용도다.
"""
import argparse
import ctypes
import fcntl
import os
import subprocess
import sys
import threading
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tft_ili9488 import (ILI9488, BLACK, WHITE, GREY, DARK,
                         RED, AMBER, GREEN, BLUE, CYAN)

# ── 센서 ────────────────────────────────────────────────────────────
I2C_BUS = "/dev/i2c-1"
I2C_RDWR, I2C_M_RD = 0x0707, 0x0001
INA_ADDR, MLX_ADDRS = 0x40, (0x5A, 0x5B)
CELL_ID = "28-0625650a2c2c"      # 셀·케이스 표면
AMBIENT_ID = "28-0625657fe542"   # 공기 중
W1_DIR = "/sys/bus/w1/devices"

CURRENT_LSB, POWER_LSB, BUS_LSB_V = 0.0002, 0.005, 1.25e-3
SHUNT_LSB_V, R_SHUNT = 2.5e-6, 0.01     # R010 — ina_log.py 와 같은 값
CAL_WANT = 0x0A00                        # ina_log.py 가 써 넣는 값
MLX_T_MIN, MLX_T_MAX = -40.0, 150.0

# 릴레이 — active-LOW (dh = OFF, dl = ON)
RELAYS = [("CH1", "5", "charge"), ("CH2", "6", "babysit"),
          ("CH3", "13", "MASTER"), ("CH4", "19", "path")]

IR_SPREAD_WARN = 3.0    # 두 MLX 가 이만큼 벌어지면 겨냥을 의심한다


class _Msg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16),
                ("len", ctypes.c_uint16), ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _Data(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_Msg)), ("nmsgs", ctypes.c_uint32)]


def _rd(fd, addr, reg, n):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * n)()
    m = (_Msg * 2)(_Msg(addr, 0, 1, ctypes.cast(w, ctypes.POINTER(ctypes.c_uint8))),
                   _Msg(addr, I2C_M_RD, n, ctypes.cast(r, ctypes.POINTER(ctypes.c_uint8))))
    fcntl.ioctl(fd, I2C_RDWR, _Data(m, 2))
    return list(r)


def _s16(v):
    return v - 0x10000 if v & 0x8000 else v


def mlx_sane(raw):
    """0x7FFF 스턱 리드와 범위 밖 값을 결측으로 돌린다."""
    if raw & 0x8000 or raw == 0x7FFF:
        return None
    v = raw * 0.02 - 273.15
    return v if MLX_T_MIN <= v <= MLX_T_MAX else None


def read_ds(dev_id):
    try:
        with open(os.path.join(W1_DIR, dev_id, "w1_slave")) as f:
            txt = f.read()
        if "YES" not in txt.split("\n")[0]:
            return None
        v = int(txt[txt.find("t=") + 2:].split()[0]) / 1000.0
        return None if abs(v - 85.0) < 0.001 else v   # 85.0 = 전원 미인가
    except Exception:
        return None


class DsReader(threading.Thread):
    """DS18B20 을 **딴 실로** 읽는다. 그리기 루프는 캐시만 본다.

    1-Wire 변환이 센서당 800ms 라 이걸 주 루프에 두면 그 주기가 통째로 멎는다.
    주기를 늘려 캐시하는 것만으로는 안 된다 — 갱신하는 그 한 주기가 여전히
    1.6초 멎고, 실측에서 최악 주기가 1705ms 로 남아 있었다.
    파일 읽기는 커널에서 블록하며 GIL 을 놓으므로 그리기가 방해받지 않는다.
    """

    def __init__(self, period=30.0):
        threading.Thread.__init__(self)
        self.daemon = True          # 주 루프가 죽으면 같이 죽는다
        self.period = period
        self.cell = None
        self.amb = None
        self._stop = threading.Event()

    def run(self):
        while not self._stop.is_set():
            self.cell = read_ds(CELL_ID)    # 속성 대입은 GIL 하에서 원자적이라
            self.amb = read_ds(AMBIENT_ID)  # 잠금이 필요 없다
            self._stop.wait(self.period)

    def stop(self):
        self._stop.set()


def read_all(fd, ds=None):
    out = {"v": None, "i": None, "p": None, "ir": None, "a": None, "b": None,
           "cal_ok": None, "mismatch": None,
           "ds": None if ds is None else ds.cell,
           "amb": None if ds is None else ds.amb}
    try:
        def u16(reg):
            r = _rd(fd, INA_ADDR, reg, 2)
            return (r[0] << 8) | r[1]

        cal = u16(0x05)
        out["cal_ok"] = (cal == CAL_WANT)
        out["v"] = u16(0x02) * BUS_LSB_V
        # 션트 전압은 CAL 과 무관하다 — 이게 참값이다
        i_shunt = _s16(u16(0x01)) * SHUNT_LSB_V / R_SHUNT
        if out["cal_ok"]:
            # CAL 이 서 있으면 Current 레지스터를 쓴다 — ina_log.py 가 기록하는
            # 값과 같아야 화면과 데이터가 어긋나지 않는다
            out["i"] = _s16(u16(0x04)) * CURRENT_LSB
            p = u16(0x03) * POWER_LSB
            out["p"] = -p if out["i"] < 0 and p > 0 else p
            out["mismatch"] = out["i"] - i_shunt
        else:
            # CAL=0 이면 Current/Power 레지스터는 전류가 흘러도 0 을 뱉는다.
            # 그걸 그대로 띄우면 「팩이 잠들었다」로 오독한다 (핵심 발견 12).
            out["i"] = i_shunt
            out["p"] = out["v"] * i_shunt
    except OSError:
        pass
    for key, addr in zip(("a", "b"), MLX_ADDRS):
        try:
            r = _rd(fd, addr, 0x07, 3)
            out[key] = mlx_sane(r[0] | (r[1] << 8))
        except OSError:
            pass
    hot = [x for x in (out["a"], out["b"]) if x is not None]
    out["ir"] = max(hot) if hot else None
    return out


def read_relays():
    try:
        txt = subprocess.check_output(
            ["pinctrl", "get", ",".join(g for _, g, _ in RELAYS)],
            stderr=subprocess.DEVNULL).decode()
    except Exception:
        return {n: None for n, _, _ in RELAYS}
    state = {}
    for name, gpio, _ in RELAYS:
        state[name] = None
        for line in txt.splitlines():
            if line.strip().startswith(gpio + ":"):
                state[name] = "lo" in line.split("|")[-1]   # lo = ON (active-LOW)
    return state


# ── run 미터 ────────────────────────────────────────────────────────
class RunMeter(object):
    """전류가 흐르기 시작한 시각부터 경과·mAh·Wh 를 센다.

    ina_log.py 의 0.1초 적분을 대신하려는 게 아니다. 1Hz 사다리꼴 어림이고
    화면을 재시작하면 0 으로 돌아간다. **run 이 예상대로 가는지 보는 용도다.**
    """

    def __init__(self, arm_a=0.05, max_gap=5.0):
        self.arm_a, self.max_gap = arm_a, max_gap
        self.t0 = None          # 전류가 처음 흐른 시각
        self.prev_t = None
        self.prev_i = 0.0
        self.prev_p = 0.0
        self.mah = 0.0
        self.wh = 0.0

    def update(self, t, i, p):
        if i is None:
            self.prev_t = None          # 결측 구간은 건너뛴다 (0 으로 적분하지 않는다)
            return
        cur, pw = abs(i), abs(p if p is not None else 0.0)
        if self.t0 is None:
            if cur < self.arm_a:
                return                  # 아직 무부하 — 시계를 안 돌린다
            self.t0 = t
        if self.prev_t is not None:
            dt = t - self.prev_t
            if 0.0 < dt <= self.max_gap:   # 화면이 멎었던 구간은 안 메운다
                self.mah += (cur + self.prev_i) * 0.5 * dt / 3.6
                self.wh += (pw + self.prev_p) * 0.5 * dt / 3600.0
        self.prev_t, self.prev_i, self.prev_p = t, cur, pw

    @property
    def elapsed(self):
        return None if self.t0 is None else time.time() - self.t0


# ── 화면 ────────────────────────────────────────────────────────────
def _fits(w, scale, text):
    """칸에 들어가는 글자 수. 새 칸을 만들 때 이걸로 먼저 재 볼 것."""
    return w // (6 * scale) >= len(text)


class _Field(object):
    """값 한 칸. 문자열이 바뀔 때만 다시 그린다 — 이게 부분 갱신의 전부다."""

    def __init__(self, tft, x, y, w, scale=3, color=WHITE, bg=BLACK):
        self.t, self.x, self.y, self.w = tft, x, y, w
        self.scale, self.color, self.bg = scale, color, bg
        self.last = None

    def set(self, text, color=None):
        col = self.color if color is None else color   # BLACK(0) 도 유효한 색이다
        if text == self.last and col == self.color:
            return
        self.color = col
        self.last = text
        # 남은 자리를 공백으로 채워 이전 값의 잔상을 지운다 (전송 1회)
        cw = 6 * self.scale
        pad = max(0, self.w // cw)
        self.t.text(self.x, self.y, text.ljust(pad)[:pad],
                    col, bg=self.bg, scale=self.scale)


def temp_color(c):
    if c is None:
        return GREY
    if c >= 50:
        return RED
    if c >= 40:
        return AMBER
    return GREEN


# 세 칸 공통 x 좌표와 폭 — scale 4 에서 6글자, scale 3 에서 8글자가 들어간다
COL_X = (8, 168, 330)
COL_W = (156, 156, 146)


def build(tft):
    tft.clear(BLACK)

    # 머리줄
    tft.fill_rect(0, 0, 480, 30, DARK)
    tft.text(8, 8, "CellGuard", CYAN, bg=DARK, scale=2)

    # 1행 — 전기. 단위는 라벨로 올린다 (값 칸은 6글자뿐이다)
    for x, label in zip(COL_X, ("VOLTAGE  V", "CURRENT  A", "POWER  W")):
        tft.text(x, 42, label, GREY, scale=1)
    tft.fill_rect(0, 96, 480, 1, DARK)

    # 2행 — 온도
    for x, label in zip(COL_X, ("IR HOTSPOT  C", "CELL DS  C", "AMBIENT  C")):
        tft.text(x, 104, label, GREY, scale=1)
    tft.fill_rect(0, 158, 480, 1, DARK)

    # 3행 — run 미터
    for x, label in zip(COL_X, ("ELAPSED", "CAPACITY  mAh", "ENERGY  Wh")):
        tft.text(x, 166, label, GREY, scale=1)
    tft.fill_rect(0, 212, 480, 1, DARK)

    # 릴레이 — 이름은 고정, 상태만 칸으로
    for i, (name, _, role) in enumerate(RELAYS):
        x = 8 + i * 120
        tft.text(x, 220, name, WHITE, scale=2)
        tft.text(x, 240, role, GREY, scale=1)
    tft.fill_rect(0, 256, 480, 1, DARK)

    return {
        "clock": _Field(tft, 300, 8, 176, scale=2, color=GREY, bg=DARK),
        "name": _Field(tft, 140, 8, 152, scale=2, color=AMBER, bg=DARK),
        "v":   _Field(tft, COL_X[0], 56, COL_W[0], scale=4),
        "i":   _Field(tft, COL_X[1], 56, COL_W[1], scale=4),
        "p":   _Field(tft, COL_X[2], 56, COL_W[2], scale=4),
        "ir":  _Field(tft, COL_X[0], 118, COL_W[0], scale=4),
        "ds":  _Field(tft, COL_X[1], 118, COL_W[1], scale=4),
        "amb": _Field(tft, COL_X[2], 118, COL_W[2], scale=4),
        "el":  _Field(tft, COL_X[0], 180, COL_W[0], scale=3),
        "mah": _Field(tft, COL_X[1], 180, COL_W[1], scale=3),
        "wh":  _Field(tft, COL_X[2], 180, COL_W[2], scale=3),
        "r0":  _Field(tft, 8 + 48, 220, 64, scale=2),
        "r1":  _Field(tft, 128 + 48, 220, 64, scale=2),
        "r2":  _Field(tft, 248 + 48, 220, 64, scale=2),
        "r3":  _Field(tft, 368 + 48, 220, 64, scale=2),
        "split": _Field(tft, 8, 262, 464, scale=1, color=GREY),
        "status": _Field(tft, 8, 280, 464, scale=3, color=GREY),
    }


def fmt(v, spec):
    return "--" if v is None else spec % v


def fmt_elapsed(sec):
    if sec is None:
        return "--"
    sec = int(sec)
    return "%d:%02d:%02d" % (sec // 3600, sec % 3600 // 60, sec % 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--rotation", type=int, default=1)
    ap.add_argument("--ds-interval", type=float, default=30.0,
                    help="DS18B20 읽기 주기(초). 1-Wire 가 센서당 800ms 라 "
                         "매 주기 읽으면 1Hz 가 안 되고 thermal_log 와 부딪힌다")
    ap.add_argument("--name", default="", help="run 이름 — 머리줄에 띄운다")
    ap.add_argument("--arm-a", type=float, default=0.05,
                    help="이 전류를 넘으면 run 미터를 시작한다")
    ap.add_argument("--demo", action="store_true", help="센서 없이 화면만 확인")
    args = ap.parse_args()

    tft = ILI9488(rotation=args.rotation)
    f = build(tft)
    f["name"].set(args.name[:10])
    meter = RunMeter(arm_a=args.arm_a)
    fd = None if args.demo else os.open(I2C_BUS, os.O_RDWR)
    ds = None
    if not args.demo:
        ds = DsReader(args.ds_interval)
        ds.start()                  # 1-Wire 는 딴 실에서 — 주 루프를 안 막는다
    print("표시 시작 — Ctrl+C 로 중단")

    demo_t0 = time.time()
    cycles, busy_max, reported = 0, 0.0, False
    try:
        while True:
            t0 = time.time()
            f["clock"].set(datetime.now().strftime("%m-%d %H:%M:%S"))

            if args.demo:
                # 값이 흐르는 것처럼 움직여야 잔상·잘림이 보인다
                k = (time.time() - demo_t0) / 30.0
                d = {"v": 5.024 - 0.4 * k, "i": -2.964, "p": -14.43,
                     "ir": 31.4 + 6 * k, "ds": 29.7 + 3 * k, "amb": 28.8,
                     "a": 31.4 + 6 * k, "b": 31.1 + 5.4 * k}
                rel = {"CH1": False, "CH2": False, "CH3": True, "CH4": True}
            else:
                d = read_all(fd, ds)
                rel = read_relays()

            meter.update(t0, d["i"], d["p"])

            f["v"].set(fmt(d["v"], "%.3f"), WHITE)
            f["i"].set(fmt(d["i"], "%+.3f"),
                       AMBER if (d["i"] or 0) < -0.05 else WHITE)
            f["p"].set(fmt(d["p"], "%+.2f"), WHITE)
            f["ir"].set(fmt(d["ir"], "%.1f"), temp_color(d["ir"]))
            f["ds"].set(fmt(d["ds"], "%.1f"), temp_color(d["ds"]))
            f["amb"].set(fmt(d["amb"], "%.1f"), GREY)

            f["el"].set(fmt_elapsed(meter.elapsed), WHITE)
            f["mah"].set("--" if meter.t0 is None else "%.0f" % meter.mah, WHITE)
            f["wh"].set("--" if meter.t0 is None else "%.2f" % meter.wh, WHITE)

            for i, (name, _, _r) in enumerate(RELAYS):
                on = rel.get(name)
                txt = "--" if on is None else ("ON" if on else "OFF")
                col = GREY if on is None else (
                    (RED if name == "CH3" else GREEN) if on else GREY)
                f["r%d" % i].set(txt, col)

            # IR 두 채널 각각 — 한쪽만 오르면 그쪽만 셀을 보고 있는 것이다
            if d["a"] is None or d["b"] is None:
                f["split"].set("IR  5a %s   5b %s" % (fmt(d["a"], "%.2f"),
                                                      fmt(d["b"], "%.2f")), GREY)
            else:
                gap = abs(d["a"] - d["b"])
                f["split"].set("IR  5a %.2f C   5b %.2f C   spread %.2f C"
                               % (d["a"], d["b"], gap),
                               AMBER if gap > IR_SPREAD_WARN else GREY)

            # 상태 한 줄 — 위험한 것부터 본다
            if d["ir"] is not None and d["ir"] >= 50:
                f["status"].set("OVER TEMP  %.1f C" % d["ir"], RED)
            elif d["ir"] is not None and d["ir"] >= 40:
                f["status"].set("WARM  %.1f C" % d["ir"], AMBER)
            elif d["cal_ok"] is False:
                # 전류는 션트로 살렸지만 ina_log 가 아직 안 떴다는 뜻이다
                f["status"].set("INA CAL=0  shunt fallback", AMBER)
            elif rel.get("CH3"):
                f["status"].set("DISCHARGING  CH3 closed", GREEN)
            else:
                f["status"].set("IDLE  master open", GREY)

            # 주기를 지키고 있는지 스스로 보고한다 — DS 를 매 주기 읽던 판은
            # --interval 1.0 을 줘도 실제로 1.7초였고 아무도 그걸 몰랐다
            busy = time.time() - t0
            busy_max = max(busy_max, busy)
            cycles += 1
            if not reported and cycles >= 30:
                reported = True
                print("주기 실측 — 최악 %.0f ms / 설정 %.0f ms%s"
                      % (busy_max * 1e3, args.interval * 1e3,
                         "" if busy_max <= args.interval else "   ** 밀린다 **"))
            time.sleep(max(0.0, args.interval - (time.time() - t0)))
    except KeyboardInterrupt:
        print("\n-- 중단 --")
        if meter.t0 is not None:
            print("경과 %s   %.0f mAh   %.2f Wh  (화면 자체 적분, 참고용)"
                  % (fmt_elapsed(meter.elapsed), meter.mah, meter.wh))
    finally:
        if ds is not None:
            ds.stop()
        if fd is not None:
            os.close(fd)
        tft.close()


if __name__ == "__main__":
    main()
