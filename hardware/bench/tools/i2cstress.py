# I2C read reliability test. Usage: python3 ~/i2cstress.py [seconds]
#
# A loose contact does not look loose. It reads fine most of the time and
# fails a few percent of the time -- which is invisible to the eye and fatal
# to a 5-hour run. This hammers every device and reports the failure rate.
import os, sys, glob, fcntl, ctypes, time

SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
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


DS = sorted(os.path.basename(p) for p in glob.glob('/sys/bus/w1/devices/28-*'))
TARGETS = [("MLX 0x5A", 0x5A, 0x07), ("MLX 0x5B", 0x5B, 0x07),
           ("INA226 0x40", 0x40, 0x02), ("ADS1115 0x48", 0x48, 0x00)]

ok = {n: 0 for n, _, _ in TARGETS}
bad = {n: 0 for n, _, _ in TARGETS}
firstbad = {}
dsok = {d: 0 for d in DS}
dsbad = {d: 0 for d in DS}

print("=" * 66)
print(" I2C / 1-WIRE 안정성 시험  --  %.0f 초" % SEC)
print(" 접촉 불량은 눈에 안 보인다. 실패율로 잡는다.")
print("=" * 66)

t0 = time.time()
last = 0
while time.time() - t0 < SEC:
    el = time.time() - t0
    for name, addr, reg in TARGETS:
        try:
            rd16(addr, reg)
            ok[name] += 1
        except Exception as e:
            bad[name] += 1
            firstbad.setdefault(name, (el, str(e)))
    if el - last >= 5.0:
        last = el
        s = " %5.0fs " % el
        for name, _, _ in TARGETS:
            t = ok[name] + bad[name]
            s += " %s %d/%d" % (name.split()[-1], bad[name], t)
        print(s, flush=True)
    time.sleep(0.02)

# DS18B20 은 변환이 750ms 라 따로, 짧게
for d in DS:
    for _ in range(3):
        try:
            t = open('/sys/bus/w1/devices/%s/w1_slave' % d).read()
            if 'YES' in t and 't=' in t:
                v = int(t.split('t=')[1]) / 1000.0
                if abs(v - 85.0) < 0.01:
                    dsbad[d] += 1      # 85.0 = 전원 실패 초기값
                else:
                    dsok[d] += 1
            else:
                dsbad[d] += 1
        except Exception:
            dsbad[d] += 1
os.close(fd)

print()
print("=" * 66)
print(" %-14s %8s %8s %9s   %s" % ("채널", "성공", "실패", "실패율", "판정"))
print("-" * 66)
worst = 0.0
for name, _, _ in TARGETS:
    t = ok[name] + bad[name]
    rate = 100.0 * bad[name] / t if t else 0.0
    worst = max(worst, rate)
    if rate == 0:
        v = "완전 정상"
    elif rate < 0.5:
        v = "간헐 (주의)"
    else:
        v = "<<< 접촉 불량"
    print(" %-14s %8d %8d %8.2f%%   %s" % (name, ok[name], bad[name], rate, v))
for d in DS:
    t = dsok[d] + dsbad[d]
    rate = 100.0 * dsbad[d] / t if t else 0.0
    print(" %-14s %8d %8d %8.2f%%   %s"
          % (d[-6:], dsok[d], dsbad[d], rate, "정상" if rate == 0 else "<<< 확인"))
print("=" * 66)
for name, (el, msg) in firstbad.items():
    print(" %s 첫 실패 t=%.1fs : %s" % (name, el, msg))
if worst == 0:
    print(" 전 채널 무결함. 이 시험 동안은 접촉 문제가 없었다.")
else:
    print(" 실패가 하나라도 있으면 5시간 run 에서는 수백 번 난다.")
    print(" 점퍼를 양쪽 다 다시 꽂고, 안 되면 브레드보드 구멍을 바꾼다.")
print("=" * 66)
