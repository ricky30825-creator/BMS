# Thermal watchdog with automatic load cutoff.
#
#   python3 ~/tempguard.py [--ir-stop 60] [--ds-stop 50] [--rise 6] [--window 60]
#                          [--log ~/guard.log] [--dry-run]
#
# Why this exists: thermal_log_alarm.py judges on the DS18B20 contact sensor and
# only beeps. Measured peaks show the contact sensor reads 15-18 C BELOW the IR
# hot spot (r5: IR 48.8 C while DS read 30.5 C) because the plastic case is an
# insulator. At high power that blind spot is the dangerous one.
#
# This watchdog watches the IR hot spot as the primary channel and actually
# opens CH3 (the master relay, GPIO13) on a trip. CH3 is the designed
# Kill-Switch; opening it under load is what it is for. Guide section 10 forbids
# switching CH3 during *routine* mode changes, not emergency cutoff.
#
# Run it alongside the normal loggers. It writes its own CSV-ish log so the trip
# is timestamped in the run record.
import os, sys, glob, fcntl, ctypes, time, subprocess
from collections import deque
from datetime import datetime

OPT = {"ir_stop": 60.0, "ds_stop": 50.0, "rise": 10.0, "window": 60.0,
       "rise_gate": 40.0,
       "log": os.path.expanduser("~/guard.log"), "interval": 1.0}
DRY = "--dry-run" in sys.argv
_it = iter(sys.argv[1:])
for a in _it:
    if a == "--ir-stop":
        OPT["ir_stop"] = float(next(_it))
    elif a == "--ds-stop":
        OPT["ds_stop"] = float(next(_it))
    elif a == "--rise":
        OPT["rise"] = float(next(_it))
    elif a == "--window":
        OPT["window"] = float(next(_it))
    elif a == "--rise-gate":
        OPT["rise_gate"] = float(next(_it))
    elif a == "--log":
        OPT["log"] = os.path.expanduser(next(_it))
    elif a == "--interval":
        OPT["interval"] = float(next(_it))

BELL = "\a"
I2C_RDWR = 0x0707
# 2026-08-26 정정: 두 프로브의 배치가 문서와 반대였다. 9개 run 전부에서
# 부하 차단 후 식는 쪽이 28-0625650a2c2c 였다 (r3 -7.90, r6 -7.79 C).
# 식는 쪽 = 케이스에 붙은 쪽이므로 아래처럼 맞바꾼다. 프로브는 그대로 두고
# 상수만 고쳐 과거 run 과의 배치 일관성을 유지한다.
CELL_ID = None                       # 2026-09-20: 셀 DS 없음 -> DS 차단 비활성, IR 이 전담
MASTER_GPIO = "13"                   # CH3 master. active-LOW: dh = OFF


class Msg(ctypes.Structure):
    _fields_ = [('addr', ctypes.c_uint16), ('flags', ctypes.c_uint16),
                ('len', ctypes.c_uint16), ('buf', ctypes.POINTER(ctypes.c_uint8))]


class Data(ctypes.Structure):
    _fields_ = [('msgs', ctypes.POINTER(Msg)), ('nmsgs', ctypes.c_uint32)]


fd = os.open('/dev/i2c-1', os.O_RDWR)


def rd16(addr, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 3)()
    m = (Msg * 2)(Msg(addr, 0, 1, ctypes.cast(w, ctypes.POINTER(ctypes.c_uint8))),
                  Msg(addr, 1, 3, ctypes.cast(r, ctypes.POINTER(ctypes.c_uint8))))
    fcntl.ioctl(fd, I2C_RDWR, Data(m, 2))
    return r[0] | (r[1] << 8)


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


def mlx_obj(addr):
    # three reads + median: single I2C reads glitch (one sample at 53 C between
    # neighbours at 27 C). A glitch must never trip the load.
    got = []
    for _ in range(3):
        try:
            c = mlx_sane(rd16(addr, 0x07))
            if c is not None:
                got.append(c)
        except Exception:
            pass
        time.sleep(0.002)
    if not got:
        return None
    got.sort()
    return got[len(got) // 2]


def ds_cell():
    try:
        t = open('/sys/bus/w1/devices/%s/w1_slave' % CELL_ID).read()
        if 'YES' not in t:
            return None
        v = int(t.split('t=')[1]) / 1000.0
        return None if abs(v - 85.0) < 0.01 else v   # 85.0 = power-up default
    except Exception:
        return None


def gpio_state():
    try:
        return subprocess.check_output(['pinctrl', 'get', MASTER_GPIO]).decode().strip()
    except Exception as e:
        return "pinctrl failed: %s" % e


def cut():
    if DRY:
        return "DRY-RUN: would run 'pinctrl set %s op dh'" % MASTER_GPIO
    try:
        subprocess.check_call(['pinctrl', 'set', MASTER_GPIO, 'op', 'dh'])
        time.sleep(0.2)
        return "CH3 opened -> %s" % gpio_state()
    except Exception as e:
        return "!! CUTOFF FAILED: %s -- PULL THE LOAD BY HAND" % e


logf = open(OPT["log"], "a", buffering=1)


def say(s):
    line = "%s  %s" % (datetime.now().isoformat(timespec="seconds"), s)
    print(line, flush=True)
    logf.write(line + "\n")


print("=" * 72)
print(" TEMP GUARD  --  automatic load cutoff" + ("   [DRY RUN]" if DRY else ""))
print("=" * 72)
print(" IR  stop  : %.1f C   (max of 0x5A / 0x5B object temp)  << primary" % OPT["ir_stop"])
print(" DS  stop  : %.1f C   (%s, contact -- reads 15-18 C low)" % (OPT["ds_stop"], CELL_ID))
print(" rise trip : %.1f C in %.0f s  (IR, only above %.0f C)"
      % (OPT["rise"], OPT["window"], OPT["rise_gate"]))
print(" on trip   : pinctrl set %s op dh   (CH3 master OFF)" % MASTER_GPIO)
print(" master now: %s" % gpio_state())
print(" log       : %s" % OPT["log"])
print("=" * 72)

a0, b0, d0 = mlx_obj(0x5A), mlx_obj(0x5B), ds_cell()
if a0 is None and b0 is None:
    print("!! no IR sensor responding -- refusing to run as a guard")
    sys.exit(1)
if d0 is None:
    print(" note: DS cell sensor not readable; guarding on IR only")
print(" start: 5A %s  5B %s  DS %s"
      % (("%.2f" % a0) if a0 else "--", ("%.2f" % b0) if b0 else "--",
         ("%.2f" % d0) if d0 else "--"))
say("guard armed  ir_stop=%.1f ds_stop=%.1f rise=%.1f/%.0fs gate=%.0f dry=%s"
    % (OPT["ir_stop"], OPT["ds_stop"], OPT["rise"], OPT["window"],
       OPT["rise_gate"], DRY))

hist = deque()
tripped = False
peak_ir = -999.0
t0 = time.time()
try:
    while True:
        now = time.time()
        a, b = mlx_obj(0x5A), mlx_obj(0x5B)
        d = ds_cell()
        ir = max([x for x in (a, b) if x is not None], default=None)
        if ir is not None:
            peak_ir = max(peak_ir, ir)
            hist.append((now, ir))
            while hist and now - hist[0][0] > OPT["window"]:
                hist.popleft()

        reason = None
        if ir is not None and ir >= OPT["ir_stop"]:
            reason = "IR %.2f C >= ir-stop %.1f" % (ir, OPT["ir_stop"])
        elif d is not None and d >= OPT["ds_stop"]:
            reason = "DS %.2f C >= ds-stop %.1f" % (d, OPT["ds_stop"])
        elif (len(hist) >= 5 and ir is not None
              and ir >= OPT["rise_gate"]):
            # 급상승 판정은 이미 뜨거울 때만 쓴다. 2026-08-26 에 상온 27 C 에서
            # 손이 0x5B 앞을 지나가 33.6 C 가 찍히자 6 C/60s 문턱에 걸려
            # run 시작 직전에 CH3 가 끊긴 적이 있다. 열폭주는 낮은 온도에서
            # 시작하지 않으므로 게이트를 두는 편이 안전하고 오탐이 없다.
            lo = min(v for _, v in hist)
            if ir - lo >= OPT["rise"]:
                reason = "IR rose %.2f C within %.0f s (>= %.1f, gate %.0f C)" % (
                    ir - lo, now - hist[0][0], OPT["rise"], OPT["rise_gate"])

        if reason and not tripped:
            tripped = True
            sys.stdout.write(BELL * 8)
            say("*** TRIP *** %s" % reason)
            say("    5A %s  5B %s  DS %s  peak IR %.2f"
                % (("%.2f" % a) if a else "--", ("%.2f" % b) if b else "--",
                   ("%.2f" % d) if d else "--", peak_ir))
            say("    %s" % cut())
            say("    Loggers keep running -- this is the cooling tail. "
                "Turn the BW150 output OFF by hand as well.")

        if int(now - t0) % 30 < OPT["interval"]:
            print(" %6.0fs  5A %s  5B %s  DS %s  peakIR %.2f  %s"
                  % (now - t0, ("%.2f" % a) if a else "--",
                     ("%.2f" % b) if b else "--", ("%.2f" % d) if d else "--",
                     peak_ir, "TRIPPED" if tripped else "ok"), flush=True)
            if tripped:
                sys.stdout.write(BELL)
        time.sleep(OPT["interval"])
except KeyboardInterrupt:
    say("guard stopped by hand  (peak IR %.2f, tripped=%s)" % (peak_ir, tripped))
finally:
    os.close(fd)
