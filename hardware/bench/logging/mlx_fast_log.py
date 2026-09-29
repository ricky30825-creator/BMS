#!/usr/bin/env python3
# ASCII only.
"""MLX90614 high-rate logger (IR two-zone).

    python3 ~/mlx_fast_log.py [interval_s] [outfile.csv] [--rise C] [--window S]

Defaults: 0.1 s, ~/mlx_fast.csv

MLX90614 with STEP 19 filters (IIR=100, FIR=111) refreshes every 95.2 ms, so
0.1 s sampling yields a genuinely new measurement each frame.  DS18B20 cannot
do this (750 ms conversion) -- that is why this logger is IR-only.

Columns follow the backend contract naming: temp_ir_surface is max(non-null ir).
Pure ctypes + fcntl -- no smbus2 required.
"""
import ctypes
import csv
import fcntl
import os
import sys
import time
from collections import deque
from datetime import datetime

BUS = "/dev/i2c-1"
ADDRS = [0x5A, 0x5B]
REG_TA, REG_TOBJ = 0x06, 0x07
I2C_RDWR = 0x0707
I2C_M_RD = 0x0001
BELL = "\a"


class _Msg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16),
                ("len", ctypes.c_uint16), ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _Data(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_Msg)), ("nmsgs", ctypes.c_uint32)]


def _msg(addr, flags, buf):
    return _Msg(addr=addr, flags=flags, len=len(buf),
                buf=ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint8)))


# MLX90614 스턱 리드 방어 (2026-09-02 추가).
# raw 가 0x7FFF 이면 382.19 C 가 나오는데 에러 플래그는 0x8000 이라
# `raw & 0x8000` 검사를 한 비트 차이로 빠져나간다. PB20000_c4 에서 실제로 6 건.
MLX_T_MIN, MLX_T_MAX = -40.0, 150.0


def mlx_sane(raw):
    """raw 16비트를 섭씨로. 못 믿을 값이면 None."""
    if raw & 0x8000 or raw == 0x7FFF:
        return None
    v = raw * 0.02 - 273.15
    return v if MLX_T_MIN <= v <= MLX_T_MAX else None


def read_reg(fd, addr, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 3)()
    arr = (_Msg * 2)(_msg(addr, 0, w), _msg(addr, I2C_M_RD, r))
    fcntl.ioctl(fd, I2C_RDWR, _Data(msgs=arr, nmsgs=2))
    return mlx_sane(r[0] | (r[1] << 8))


# --- args -----------------------------------------------------------------
POS, OPT = [], {"rise": None, "window": 10.0}
_it = iter(sys.argv[1:])
for a in _it:
    if a == "--rise":
        OPT["rise"] = float(next(_it))
    elif a == "--window":
        OPT["window"] = float(next(_it))
    elif a in ("-h", "--help"):
        print(__doc__)
        raise SystemExit(0)
    else:
        POS.append(a)

INTERVAL = float(POS[0]) if len(POS) > 0 else 0.1
OUTPATH = POS[1] if len(POS) > 1 else os.path.expanduser("~/mlx_fast.csv")

fd = os.open(BUS, os.O_RDWR)

bar = "=" * 72
print(bar)
print(" MLX90614 fast logger  (%.3f s)" % INTERVAL)
print(" file    : %s" % OUTPATH)
present = []
for a in ADDRS:
    try:
        v = read_reg(fd, a, REG_TOBJ)
        present.append(a)
        print(" 0x%02X    : OK   TOBJ=%.2f C" % (a, v))
    except OSError:
        print(" 0x%02X    : << NOT RESPONDING" % a)
if not present:
    print("!! no MLX90614 found -- aborting")
    raise SystemExit(1)
if OPT["rise"] is not None:
    print(" rise    : %.1f C within %.0f s -> beep" % (OPT["rise"], OPT["window"]))
print(" note    : DS18B20 cannot do this rate (750 ms conversion) -- IR only")
print(" stop    : Ctrl+C")
print(bar)

new = not os.path.exists(OUTPATH) or os.path.getsize(OUTPATH) == 0
f = open(OUTPATH, "a", newline="")
w = csv.writer(f)
if new:
    w.writerow(["timestamp", "elapsed_s",
                "mlx5a_obj_c", "mlx5a_amb_c",
                "mlx5b_obj_c", "mlx5b_amb_c",
                "temp_ir_surface", "missing"])

hist = deque()
t0 = time.time()
n = 0
last_print = 0.0
peak = None
try:
    while True:
        tick = t0 + n * INTERVAL
        now = time.time()
        if tick > now:
            time.sleep(tick - now)
        n += 1

        vals, missing = {}, 0
        for a in ADDRS:
            try:
                o = read_reg(fd, a, REG_TOBJ)
                m = read_reg(fd, a, REG_TA)
            except OSError:
                o = m = None
            if o is None:
                missing += 1
            vals[a] = (o, m)

        t = time.time()
        elapsed = t - t0
        objs = [vals[a][0] for a in ADDRS if vals[a][0] is not None]
        surface = max(objs) if objs else None

        def fm(x):
            return "" if x is None else round(x, 2)

        w.writerow([datetime.fromtimestamp(t).isoformat(timespec="milliseconds"),
                    round(elapsed, 3),
                    fm(vals[0x5A][0]), fm(vals[0x5A][1]),
                    fm(vals[0x5B][0]), fm(vals[0x5B][1]),
                    fm(surface), missing])
        if n % 50 == 0:
            f.flush()

        alarm = ""
        if surface is not None:
            peak = surface if peak is None else max(peak, surface)
            if OPT["rise"] is not None:
                hist.append((t, surface))
                while hist and t - hist[0][0] > OPT["window"]:
                    hist.popleft()
                if len(hist) > 1 and surface - min(v for _, v in hist) >= OPT["rise"]:
                    alarm = BELL + "  << RAPID RISE"

        if elapsed - last_print >= 5.0 or alarm:
            last_print = elapsed
            print("%s  t+%-8.1f 5A=%6s  5B=%6s  surf=%6s  (n=%d, peak %s, 결측 %d)%s"
                  % (datetime.fromtimestamp(t).strftime("%H:%M:%S"), elapsed,
                     fm(vals[0x5A][0]), fm(vals[0x5B][0]), fm(surface), n,
                     fm(peak), missing, alarm))
except KeyboardInterrupt:
    print("\n-- interrupted --")
finally:
    f.flush()
    f.close()
    os.close(fd)
    print("samples: %d   duration: %.1f s   file: %s" % (n, time.time() - t0, OUTPATH))
