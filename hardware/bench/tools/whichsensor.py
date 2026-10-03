# Identify which physical sensor is which channel.
# Usage: python3 ~/whichsensor.py [seconds]
#
# Warm one sensor at a time with a finger; this prints the trace and then
# reports which channel moved and when. Pure python (ctypes+fcntl), no deps.
import os, sys, glob, fcntl, ctypes, time

SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0
DT = 0.5
I2C_RDWR = 0x0707


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


def mlx_obj(addr):
    # Single I2C reads glitch about 1% of the time on this bus (one sample at
    # 53 C between neighbours at 27 C). Three reads + median kills that without
    # hiding a real change, which lasts seconds.
    got = []
    for _ in range(3):
        try:
            v = rd16(addr, 0x07)
            if not (v & 0x8000):
                got.append(v * 0.02 - 273.15)
        except Exception:
            pass
        time.sleep(0.002)
    if not got:
        return None
    got.sort()
    return got[len(got) // 2]


DS = sorted(os.path.basename(p) for p in glob.glob('/sys/bus/w1/devices/28-*'))


def ds(devid):
    try:
        t = open('/sys/bus/w1/devices/%s/w1_slave' % devid).read()
        if 'YES' not in t:
            return None
        v = int(t.split('t=')[1]) / 1000.0
        return None if abs(v - 85.0) < 0.01 else v
    except Exception:
        return None


CH = [('MLX 0x5A', lambda: mlx_obj(0x5A)),
      ('MLX 0x5B', lambda: mlx_obj(0x5B))] + \
     [('DS %s' % d, (lambda dd: (lambda: ds(dd)))(d)) for d in DS]

print("=" * 78)
print(" WHICH SENSOR IS WHICH  --  %.0f s, sampling every %.1f s" % (SEC, DT))
print(" Warm ONE sensor at a time with a finger. Remember which one you touched.")
print("=" * 78)
hdr = " %-7s" % "t(s)"
for name, _ in CH:
    hdr += " %16s" % name
print(hdr)

t0 = time.time()
hist = [[] for _ in CH]
times = []
while True:
    el = time.time() - t0
    if el > SEC:
        break
    row = " %-7.1f" % el
    for k, (name, fn) in enumerate(CH):
        v = fn()
        hist[k].append(v)
        row += " %16s" % ("--" if v is None else "%.2f" % v)
    times.append(el)
    print(row, flush=True)
    time.sleep(max(0.0, DT - ((time.time() - t0) - el)))
os.close(fd)


def clean(xs):
    return [x for x in xs if x is not None]


def pct(xs, q):
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


print()
print("=" * 78)
print(" %-18s %9s %9s %9s %14s   %s"
      % ("channel", "base", "max", "rise", "above-thr window", "verdict"))
print("-" * 78)
# Baseline = 20th percentile, not the median. A held finger can occupy MOST of
# the window -- in one check it covered 58% of samples, which dragged the median
# up INTO the touched period and reported a +4.5 C excursion as +0.68 C.
# The 20th percentile still finds the resting level as long as the sensor is
# untouched for at least a fifth of the run, and it survives slow room drift the
# way a first-10s baseline does not.
res = []
for k, (name, _) in enumerate(CH):
    allv = clean(hist[k])
    if len(allv) < 5:
        print(" %-18s %9s %9s %9s %14s   NO DATA" % (name, "--", "--", "--", "--"))
        continue
    b = pct(allv, 0.20)
    mx = max(allv)
    idx = max(range(len(hist[k])), key=lambda i: -999 if hist[k][i] is None else hist[k][i])
    rise = mx - b
    thr = 0.8 if name.startswith('MLX') else 0.3
    hits = [times[i] for i in range(len(hist[k]))
            if hist[k][i] is not None and hist[k][i] - b >= thr]
    win = "%.0f~%.0f s" % (hits[0], hits[-1]) if hits else "-"
    touched = len(hits) >= 3          # at least ~1.5 s, not a single noise spike
    res.append((name, rise, times[idx], win, touched))
    print(" %-18s %9.2f %9.2f %+9.2f %14s   %s"
          % (name, b, mx, rise, win, "<<< TOUCHED" if touched else "quiet"))
print("=" * 78)

for kind in ("MLX", "DS"):
    grp = [r for r in res if r[0].startswith(kind)]
    hot = [r for r in grp if r[4]]
    if len(hot) == 1:
        print(" %-3s ->  %s  is the one you touched  (+%.2f C, %s)"
              % (kind, hot[0][0], hot[0][1], hot[0][3]))
    elif len(hot) > 1:
        print(" %-3s ->  more than one moved; touch only ONE at a time:" % kind)
        for r in hot:
            print("          %-18s +%.2f C  %s" % (r[0], r[1], r[3]))
    elif grp:
        top = max(grp, key=lambda r: r[1])
        print(" %-3s ->  nothing moved enough. Largest was %s at +%.2f C (t=%.0f s)."
              % (kind, top[0], top[1], top[2]))
        print("          Hold it closer/longer, or touch the metal probe directly.")
print("=" * 78)
