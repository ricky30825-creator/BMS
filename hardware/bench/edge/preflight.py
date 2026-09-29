# Pre-run check. Pure python (ctypes+fcntl), no external deps.
import os, sys, glob, fcntl, ctypes, subprocess, shutil, time

I2C_RDWR = 0x0707
I2C_SLAVE = 0x0703
GO = []
NG = []
WARN = []


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


def ina_rd(reg):
    f = os.open('/dev/i2c-1', os.O_RDWR)
    fcntl.ioctl(f, I2C_SLAVE, 0x40)
    os.write(f, bytes([reg]))
    d = os.read(f, 2)
    os.close(f)
    return (d[0] << 8) | d[1]


LABEL = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "UNLABELED RUN"
print("=" * 62)
print(" PRE-FLIGHT  --  %s" % LABEL)
print("=" * 62)

# ---- 1. DS18B20
print("\n[1] DS18B20")
# 2026-09-24: 28-0625657fe542 revived after rewiring (its 85.0 C was a VCC fault,
#   not a dead part) and was re-attached to the pack surface.
#   Surface/safety judgement still belongs to MLX; this probe feeds the
#   cell_temp_c feature that ai/model/preprocess.py requires.
CELL, AMB = None, '28-0625650a2c2c'   # 2026-09-20: 셀 표면 DS 없음
RETIRED = {'28-0625657fe542'}          # 변환 실패 100% -> 폐기
ds = {}
for d in sorted(glob.glob('/sys/bus/w1/devices/28-*')):
    name = os.path.basename(d)
    try:
        t = open(d + '/w1_slave').read()
        ok = 'YES' in t
        v = int(t.split('t=')[1]) / 1000.0
        ds[name] = v
        flag = 'OK '
        if not ok:
            flag = 'CRC'
        if abs(v - 85.0) < 0.01:
            flag = 'PWR'
        if name in RETIRED:
            print("    %-18s %7.3f C   RET  (2026-09-20 폐기 — 무시한다)" % (name, v))
            continue
        print("    %-18s %7.3f C   %s" % (name, v, flag))
        if flag != 'OK ':
            NG.append("DS %s = %s" % (name, flag))
    except Exception as e:
        print("    %-18s ERR %s" % (name, e))
        NG.append("DS %s read fail" % name)
# 2026-09-20: 28-0625657fe542 는 변환 실패 100% (85.000 을 12/12) -> 폐기했다.
#   살아남은 28-0625650a2c2c 를 실온으로 돌리고 셀 표면 DS 는 아예 없앴다.
#   (그 프로브는 IR 이 +6C 오르는 동안 변동 0.0000 이라 팩에 안 붙어 있었다.)
#   표면 온도는 IR max(5a,5b), 자동차단은 tempguard 의 --ir-stop 이 전담한다.
#   thermal_log_alarm.py / tempguard.py 의 상수도 같이 고쳐져 있다.
if AMB in ds and abs(ds[AMB] - 85.0) >= 0.01:
    print("    실온 기준 %.3f C" % ds[AMB])
    print("    셀 표면 DS 없음 — IR max(5a,5b) 가 표면을 맡는다")
    GO.append("DS ambient")
    WARN.append("셀 표면 DS 가 없다 — 음성경보 없음, IR 자동차단이 유일한 방어선")
else:
    NG.append("실온 DS %s 불량 — 이것마저 죽으면 run 불가" % AMB)

# ---- 2. MLX
print("\n[2] MLX90614  (repeated START)")
mlx = {}
for addr in (0x5A, 0x5B):
    try:
        tobj = rd16(addr, 0x07)
        ta = rd16(addr, 0x06)
        cfg = rd16(addr, 0x25)
        if tobj & 0x8000:
            raise ValueError("error bit set")
        o, a = tobj * 0.02 - 273.15, ta * 0.02 - 273.15
        mlx[addr] = o - a
        print("    0x%02X  TOBJ %7.3f  TA %7.3f  diff %+.3f C  CFG 0x%04X"
              % (addr, o, a, o - a, cfg))
        GO.append("MLX 0x%02X" % addr)
    except Exception as e:
        print("    0x%02X  FAIL %s" % (addr, e))
        NG.append("MLX 0x%02X" % addr)
if 0x5A in mlx:
    print("    baseline mlx5a diff = %+.3f C   <- record this; run 1 had none"
          % mlx[0x5A])

# ---- 3. INA226
print("\n[3] INA226 0x40")
try:
    cfg, sh, bus = ina_rd(0x00), ina_rd(0x01), ina_rd(0x02)
    cal, mfg, die = ina_rd(0x05), ina_rd(0xFE), ina_rd(0xFF)
    shv = sh - 65536 if sh > 32767 else sh
    vb = bus * 0.00125
    print("    MFG 0x%04X  DIE 0x%04X  %s" % (mfg, die, "genuine" if (mfg == 0x5449 and die == 0x2260) else "?!"))
    print("    CFG 0x%04X  CAL 0x%04X" % (cfg, cal))
    print("    Vbus %.4f V   Vshunt %+.4f mV" % (vb, shv * 0.0025))
    if mfg == 0x5449 and die == 0x2260:
        GO.append("INA226")
    else:
        NG.append("INA226 id")
    if vb > 1.0:
        WARN.append("Vbus = %.2f V -- something is already connected to the load path" % vb)
except Exception as e:
    print("    FAIL %s" % e)
    NG.append("INA226")
os.close(fd)

# ---- 4. GPIO / relay
print("\n[4] Relay (GPIO)")
try:
    out = subprocess.check_output(['pinctrl', 'get', '5,6,13,19']).decode()
    print("    " + out.strip().replace("\n", "\n    "))
    st = {}
    for line in out.strip().split("\n"):
        p = line.split(':')[0].strip()
        st[p] = 'hi' if '| hi' in line else 'lo'
    if st.get('13') == 'hi':
        print("    -> master CH3 = OFF  (safe)")
        GO.append("relay safe")
    else:
        print("    -> master CH3 = ON  !! load path is live")
        NG.append("CH3 already ON -- turn off before connecting battery")
    print("    -> CH4 = %s  (%s)" % (st.get('19'), "mode 1" if st.get('19') == 'hi' else "mode 2"))
except Exception as e:
    print("    FAIL %s" % e)
    NG.append("pinctrl")

# ---- 5. loggers running?
print("\n[5] Running loggers")
try:
    out = subprocess.check_output(
        "pgrep -af '[t]hermal_log|[i]na_log|[m]lx_fast_log' || true",
        shell=True).decode().strip()
    if out:
        print("    " + out.replace("\n", "\n    "))
        NG.append("loggers already running -- kill them first")
    else:
        print("    none  (clean)")
        GO.append("no stale loggers")
except Exception as e:
    print("    FAIL %s" % e)

# ---- 6. scripts
print("\n[6] Scripts")
need = ['thermal_log_alarm.py', 'ina_log.py', 'mlx_fast_log.py']
home = os.path.expanduser('~')
for s in need:
    p = os.path.join(home, s)
    if os.path.exists(p):
        print("    %-24s %6d B  OK" % (s, os.path.getsize(p)))
    else:
        print("    %-24s MISSING" % s)
        NG.append("missing %s" % s)
if not [x for x in NG if 'missing' in x]:
    GO.append("scripts")

# ---- 7. disk
print("\n[7] Disk")
t, u, f = shutil.disk_usage(home)
print("    free %.1f GB / total %.1f GB" % (f / 1e9, t / 1e9))
print("    estimate ~4.6 MB per hour of run (ina 2.0 + mlx 2.4 + temp 0.11)")
if f < 500e6:
    NG.append("disk < 500 MB")
else:
    GO.append("disk")

leftovers = sorted(glob.glob(os.path.join(home, 'PB*_*.csv')))
if leftovers:
    tot = sum(os.path.getsize(p) for p in leftovers)
    print("    leftover run CSVs: %d files, %.1f MB" % (len(leftovers), tot / 1e6))
    for p in leftovers[:8]:
        print("       %s" % os.path.basename(p))
    if len(leftovers) > 8:
        print("       ... and %d more" % (len(leftovers) - 8))
    WARN.append("%d old run CSVs on the Pi (%.0f MB) -- copy to PC then delete"
                % (len(leftovers), tot / 1e6))

# name collision: would this run overwrite an existing file?
if len(sys.argv) > 1:
    pref = sys.argv[1]
    clash = sorted(glob.glob(os.path.join(home, pref + '_*.csv')))
    if clash:
        NG.append("output prefix '%s' already has %d CSV(s) -- rename or move them"
                  % (pref, len(clash)))

# ---- verdict
print("\n" + "=" * 62)
if NG:
    print(" NO-GO  --  %d blocker(s)" % len(NG))
    for x in NG:
        print("   X  " + x)
else:
    print(" GO  --  %d checks passed" % len(GO))
    print("   " + ", ".join(GO))
if WARN:
    print("\n note:")
    for x in WARN:
        print("   !  " + x)
print("=" * 62)
