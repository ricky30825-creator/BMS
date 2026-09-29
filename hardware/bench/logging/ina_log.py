#!/usr/bin/env python3
# ASCII only (Korean output is fine at runtime; source stays ASCII for pipe-safety).
"""INA226 high-rate logger for discharge runs.

    python3 ~/ina_log.py [interval_s] [outfile.csv] [--stop-v V] [--max-a A]

Defaults: 0.1 s, ~/ina_log.csv

Records voltage / current / power at up to 10 Hz so the load-step transient can be
resolved (R0 vs R1).  Sign convention follows the project contract:
    discharge = negative, charge = positive.

Pure ctypes + fcntl -- no smbus2 required.
"""
import ctypes
import csv
import fcntl
import os
import sys
import time
from datetime import datetime

# --- INA226 ---------------------------------------------------------------
BUS = "/dev/i2c-1"
ADDR = 0x40
REG_CONFIG, REG_SHUNT, REG_BUS, REG_POWER, REG_CURRENT, REG_CAL = (
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05)
REG_MASK, REG_MFG, REG_DIE = 0x06, 0xFE, 0xFF

CONFIG_WANT = 0x4527      # AVG=16, VBUSCT/VSHCT = 1.1 ms, continuous shunt+bus
CAL_WANT = 0x0A00         # R010 shunt, Current_LSB = 0.0002 A
CURRENT_LSB = 0.0002
POWER_LSB = CURRENT_LSB * 25.0
BUS_LSB_V = 1.25e-3
SHUNT_LSB_V = 2.5e-6
R_SHUNT = 0.01

I2C_RDWR = 0x0707
I2C_M_RD = 0x0001


class _Msg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16),
                ("len", ctypes.c_uint16), ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _Data(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_Msg)), ("nmsgs", ctypes.c_uint32)]


def _msg(flags, buf):
    return _Msg(addr=ADDR, flags=flags, len=len(buf),
                buf=ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint8)))


def _xfer(fd, msgs):
    arr = (_Msg * len(msgs))(*msgs)
    fcntl.ioctl(fd, I2C_RDWR, _Data(msgs=arr, nmsgs=len(msgs)))


def read_u16(fd, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 2)()
    _xfer(fd, [_msg(0, w), _msg(I2C_M_RD, r)])
    return (r[0] << 8) | r[1]


def write_u16(fd, reg, val):
    w = (ctypes.c_uint8 * 3)(reg, (val >> 8) & 0xFF, val & 0xFF)
    _xfer(fd, [_msg(0, w)])


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


# --- args -----------------------------------------------------------------
POS, OPT = [], {"stop_v": None, "max_a": None}
_it = iter(sys.argv[1:])
for a in _it:
    if a == "--stop-v":
        OPT["stop_v"] = float(next(_it))
    elif a == "--max-a":
        OPT["max_a"] = float(next(_it))
    elif a in ("-h", "--help"):
        print(__doc__)
        raise SystemExit(0)
    else:
        POS.append(a)

INTERVAL = float(POS[0]) if len(POS) > 0 else 0.1
OUTPATH = POS[1] if len(POS) > 1 else os.path.expanduser("~/ina_log.csv")

# --- init -----------------------------------------------------------------
fd = os.open(BUS, os.O_RDWR)
write_u16(fd, REG_CONFIG, CONFIG_WANT)
write_u16(fd, REG_CAL, CAL_WANT)
time.sleep(0.1)

cfg, cal = read_u16(fd, REG_CONFIG), read_u16(fd, REG_CAL)
mfg, die = read_u16(fd, REG_MFG), read_u16(fd, REG_DIE)

bar = "=" * 72
print(bar)
print(" INA226 logger  (%.3f s)" % INTERVAL)
print(" file    : %s" % OUTPATH)
print(" CONFIG  : 0x%04X %s" % (cfg, "OK" if cfg == CONFIG_WANT else "<< MISMATCH"))
print(" CAL     : 0x%04X %s" % (cal, "OK" if cal == CAL_WANT else "<< MISMATCH"))
print(" ID      : MFG=0x%04X DIE=0x%04X %s"
      % (mfg, die, "OK" if (mfg == 0x5449 and die == 0x2260) else "<< NOT INA226"))
print(" shunt   : R010 (0.01 ohm), max +-8.19 A")
print(" sign    : discharge = negative")
if OPT["stop_v"] is not None:
    print(" stop-v  : %.3f V  (logger exits below this)" % OPT["stop_v"])
if OPT["max_a"] is not None:
    print(" max-a   : %.3f A  (logger exits above this)" % OPT["max_a"])
print(" stop    : Ctrl+C")
print(bar)

if cfg != CONFIG_WANT or cal != CAL_WANT or mfg != 0x5449 or die != 0x2260:
    print("!! register/identity check failed -- fix before logging")
    raise SystemExit(1)

new = not os.path.exists(OUTPATH) or os.path.getsize(OUTPATH) == 0
f = open(OUTPATH, "a", newline="")
w = csv.writer(f)
if new:
    w.writerow(["timestamp", "elapsed_s", "voltage_v", "current_a",
                "power_w", "shunt_check_a", "ovf"])

t0 = time.time()
n = 0
last_print = 0.0
peak_a = 0.0
io_errors = 0          # transient I2C failures are retried, never fatal
armed = False          # stop-v arms only after the source has actually come up
low_streak = 0
ARM_MARGIN = 0.3       # V above stop_v that counts as "running"
LOW_NEEDED = 10        # consecutive low samples (1 s) before stopping
try:
    while True:
        tick = t0 + n * INTERVAL
        now = time.time()
        if tick > now:
            time.sleep(tick - now)
        n += 1

        bus_r = cur_r = sh_r = pw_r = mask = None
        for attempt in range(4):
            try:
                bus_r = read_u16(fd, REG_BUS)
                cur_r = s16(read_u16(fd, REG_CURRENT))
                sh_r = s16(read_u16(fd, REG_SHUNT))
                pw_r = read_u16(fd, REG_POWER)
                mask = read_u16(fd, REG_MASK)
                break
            except OSError as e:
                io_errors += 1
                bus_r = None
                if attempt == 3:
                    print("   [i2c read failed x4 (errno %s) -- skipping sample %d]"
                          % (e.errno, n))
                else:
                    time.sleep(0.02)
        if bus_r is None:
            continue

        t = time.time()
        elapsed = t - t0
        voltage = bus_r * BUS_LSB_V
        current = cur_r * CURRENT_LSB
        power = pw_r * POWER_LSB
        shunt_a = sh_r * SHUNT_LSB_V / R_SHUNT
        ovf = 1 if (mask & 0x0004) else 0
        if power > 0 and current < 0:
            power = -power          # POWER register is unsigned; follow current sign

        w.writerow([datetime.fromtimestamp(t).isoformat(timespec="milliseconds"),
                    round(elapsed, 3), round(voltage, 4), round(current, 4),
                    round(power, 4), round(shunt_a, 4), ovf])
        if n % 20 == 0:
            f.flush()

        peak_a = max(peak_a, abs(current))
        if elapsed - last_print >= 2.0:
            last_print = elapsed
            print("%s  t+%-8.1f %7.4f V  %+8.4f A  %+8.3f W  (n=%d, peak %.3f A)%s"
                  % (datetime.fromtimestamp(t).strftime("%H:%M:%S"), elapsed,
                     voltage, current, power, n, peak_a,
                     "  OVF!" if ovf else ""))

        if OPT["max_a"] is not None and abs(current) > OPT["max_a"]:
            print("\n!! |current| %.4f A exceeded --max-a %.4f -- stopping"
                  % (abs(current), OPT["max_a"]))
            break
        if OPT["stop_v"] is not None:
            if voltage > OPT["stop_v"] + ARM_MARGIN:
                if not armed:
                    armed = True
                    print("   [stop-v armed at %.4f V]" % voltage)
                low_streak = 0
            elif armed and voltage < OPT["stop_v"]:
                low_streak += 1
                if low_streak >= LOW_NEEDED:
                    print("\n>> voltage %.4f V below --stop-v %.4f for %d samples -- stopping"
                          % (voltage, OPT["stop_v"], low_streak))
                    break
            else:
                low_streak = 0
except KeyboardInterrupt:
    print("\n-- interrupted --")
finally:
    f.flush()
    f.close()
    os.close(fd)
    print("samples: %d   i2c retries/skips: %d   duration: %.1f s   file: %s"
          % (n, io_errors, time.time() - t0, OUTPATH))
