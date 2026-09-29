# Sensor attachment check. Usage: python3 ~/sensorwatch.py [seconds]
# Hold the pack (or breathe on it) while this runs.
# Attached sensors follow your hand; unattached ones stay flat.
import os, sys, glob, fcntl, ctypes, time

SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 40.0
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


def mlx(addr):
    o = rd16(addr, 0x07) * 0.02 - 273.15
    a = rd16(addr, 0x06) * 0.02 - 273.15
    return o, a


# 2026-08-26 정정: 두 프로브의 배치가 문서와 반대였다. 9개 run 전부에서
# 부하 차단 후 식는 쪽이 28-0625650a2c2c 였다 (r3 -7.90, r6 -7.79 C).
# 식는 쪽 = 케이스에 붙은 쪽이므로 아래처럼 맞바꾼다. 프로브는 그대로 두고
# 상수만 고쳐 과거 run 과의 배치 일관성을 유지한다.
# 2026-09-04: ambient probe id changed 28-0625657fe542 -> 28-0625657fe542
#   the old id is no longer present on the 1-Wire bus
#   (sensorwatch reported amb = -99.000 before this fix).
CELL, AMB = '28-0625650a2c2c', '28-0625657fe542'


def ds(devid):
    try:
        t = open('/sys/bus/w1/devices/%s/w1_slave' % devid).read()
        return int(t.split('t=')[1]) / 1000.0
    except Exception:
        return None


print("=" * 70)
print(" SENSOR ATTACHMENT CHECK  --  %.0f s" % SEC)
print(" 팩을 손으로 감싸거나 입김을 부세요. 붙어 있으면 값이 따라 오릅니다.")
print("=" * 70)
print(" %-7s %8s %8s %8s   %8s %8s   %8s %8s"
      % ("t", "cell", "amb", "delta", "5a_obj", "5a_dif", "5b_obj", "5b_dif"))

t0 = time.time()
hist = {'cell': [], '5a': [], '5b': [], 'amb': []}
while time.time() - t0 < SEC:
    c, a = ds(CELL), ds(AMB)
    o5a, t5a = mlx(0x5A)
    o5b, t5b = mlx(0x5B)
    hist['cell'].append(c); hist['amb'].append(a)
    hist['5a'].append(o5a - t5a); hist['5b'].append(o5b - t5b)
    print(" %-7.1f %8.3f %8.3f %8.3f   %8.2f %8.3f   %8.2f %8.3f"
          % (time.time() - t0, c if c else -99, a if a else -99,
             (c - a) if (c and a) else -99, o5a, o5a - t5a, o5b, o5b - t5b))
    time.sleep(2.0)
os.close(fd)


def span(v):
    v = [x for x in v if x is not None]
    return (max(v) - min(v)) if v else 0.0


print()
print("=" * 70)
print(" %-24s %10s   %s" % ("채널", "변동폭", "판정"))
print("-" * 70)
res = [("DS18B20 cell", span(hist['cell']), 0.30),
       ("DS18B20 ambient", span(hist['amb']), 0.30),
       ("MLX 0x5A diff", span(hist['5a']), 0.50),
       ("MLX 0x5B diff", span(hist['5b']), 0.50)]
bad = 0
for name, s, thr in res:
    if name.endswith('ambient'):
        verdict = "OK (실온은 안 움직이는 게 정상)" if s < 1.0 else "!! 실온이 움직였다 - 팩에 너무 가깝다"
        if s >= 1.0:
            bad += 1
    else:
        verdict = "OK  대상을 보고 있다" if s >= thr else "!! 반응 없음 - 안 붙었거나 겨냥이 빗나감"
        if s < thr:
            bad += 1
    print(" %-24s %+9.3f   %s" % (name, s, verdict))
print("=" * 70)
print(" %s" % ("전부 정상 - run 시작해도 된다" if bad == 0
               else "%d개 채널 확인 필요 - 부착/겨냥을 고치고 다시 실행" % bad))
print("=" * 70)
