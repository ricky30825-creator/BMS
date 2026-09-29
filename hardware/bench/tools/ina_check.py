# INA226 quick path check. Usage: python3 ~/ina_check.py [seconds] [label]
import os, sys, fcntl, time

SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 15.0
LBL = sys.argv[2] if len(sys.argv) > 2 else "TEST"
SHUNT = 0.01
CUR_LSB = 0.0002          # CAL 0x0A00 with R010
I2C_SLAVE = 0x0703

f = os.open('/dev/i2c-1', os.O_RDWR)
fcntl.ioctl(f, I2C_SLAVE, 0x40)


def wr(reg, val):
    os.write(f, bytes([reg, (val >> 8) & 0xFF, val & 0xFF]))


def rd(reg):
    os.write(f, bytes([reg]))
    d = os.read(f, 2)
    return (d[0] << 8) | d[1]


def s16(v):
    return v - 65536 if v > 32767 else v


wr(0x00, 0x4527)          # avg16, 1.1ms bus/shunt, continuous
wr(0x05, 0x0A00)          # CAL for R010
time.sleep(0.1)
print("CONFIG=0x%04X  CAL=0x%04X" % (rd(0x00), rd(0x05)))
print()
print(" %-8s %9s %11s %10s %10s %9s" % ("t", "Vbus V", "Vshunt mV", "I_reg A", "I_calc A", "P W"))

t0 = time.time()
vs, isr, ics, ps = [], [], [], []
while time.time() - t0 < SEC:
    vb = rd(0x02) * 0.00125
    sv = s16(rd(0x01)) * 0.0025          # mV
    ir = s16(rd(0x04)) * CUR_LSB
    ic = sv / 1000.0 / SHUNT
    pw = rd(0x03) * CUR_LSB * 25
    vs.append(vb); isr.append(ir); ics.append(ic); ps.append(pw)
    print(" %-8.1f %9.4f %11.4f %10.4f %10.4f %9.4f"
          % (time.time() - t0, vb, sv, ir, ic, pw))
    time.sleep(1.0)
os.close(f)


def avg(x):
    return sum(x) / len(x)


V, IR, IC, P = avg(vs), avg(isr), avg(ics), avg(ps)
mism = abs(IR) - abs(IC)

print()
print("=" * 58)
print(" %s" % LBL)
print("=" * 58)
print("  Vbus     %8.4f V" % V)
print("  I_reg    %8.4f A   (Current register)" % IR)
print("  I_calc   %8.4f A   (Vshunt / 0.01)" % IC)
print("  mismatch %8.4f A" % mism)
print("  Power    %8.4f W" % P)
print()
ok = True
if V > 4.5:
    print("  [OK] battery present, %.3f V at INA" % V)
elif V > 1.0:
    print("  [??] only %.3f V -- C-type sink board may not be negotiating 5V" % V)
    ok = False
else:
    print("  [NG] %.4f V -- no battery on the path (check CH3/CH4, wiring)" % V)
    ok = False

if abs(IR) > 0.05:
    print("  [OK] current flowing, %.4f A" % IR)
elif V > 4.5:
    print("  [--] 0 A -- battery connected but load is OFF (turn BW150 output on)")
else:
    print("  [NG] no current")

if abs(IR) > 0.05:
    if abs(mism) < 0.02:
        print("  [OK] register vs shunt agree (%.4f A) -- CAL and R010 correct" % mism)
    else:
        print("  [NG] mismatch %.4f A -- check SHUNT_OHMS / CAL" % mism)
        ok = False

if abs(IR) > 0.05:
    if IR < 0:
        print("  [OK] discharge = negative, same convention as ina_log.py (run 1 / run 3)")
    else:
        print("  [!!] discharge reads POSITIVE -- ina_log.py logs negative. VIN/VOUT swapped?")
print("=" * 58)
