#!/usr/bin/env python3
"""방전 시험용 온도 로거 (bulk read 판) — DS18B20 ×2 + MLX90614 ×2.

`thermal_log_alarm.py`의 개선판이다. 원본은 DS18B20을 **순차로** 읽어 센서당 750ms,
두 개면 1.5초가 깔려 실측 간격이 약 2.6초였다. 이 판은 커널의 `therm_bulk_read`로
**두 센서를 동시에 변환**시켜 750ms 한 번으로 끝낸다 → 실측 약 0.85초.

    python3 thermal_log_bulk.py [간격초] [출력.csv] [중단온도] [--warn 5] [--rate 5]

원본과 CSV 열·경보 규칙이 같으므로 그대로 갈아끼울 수 있다.

왜 0.1초가 아닌가: DS18B20의 12비트 변환은 **750ms가 하드웨어 사양**이라 더는 못 줄인다.
9비트로 낮추면 93.75ms가 되지만 해상도가 0.5℃로 떨어져 delta_c(0.06℃ 단위)를 못 본다.
0.1초가 필요한 IR은 `mlx_fast_log.py`가, 전압·전류는 `ina_log.py`가 따로 맡는다.
"""
import ctypes
import csv
import fcntl
import glob
import os
import sys
import time
from collections import deque
from datetime import datetime

# ── 센서 ID ─────────────────────────────────────────────
# 2026-08-26 정정: 두 프로브의 배치가 문서와 반대였다. 9개 run 전부에서
# 부하 차단 후 식는 쪽이 28-0625650a2c2c 였다 (r3 -7.90, r6 -7.79 C).
# 식는 쪽 = 케이스에 붙은 쪽이므로 아래처럼 맞바꾼다. 프로브는 그대로 두고
# 상수만 고쳐 과거 run 과의 배치 일관성을 유지한다.
CELL_ID = "28-0625650a2c2c"      # 셀 표면 — 경보와 종지 판정의 기준
# 2026-09-04: ambient probe id changed 28-0625657fe542 -> 28-0625657fe542
#   the old id is no longer present on the 1-Wire bus
#   (sensorwatch reported amb = -99.000 before this fix).
AMBIENT_ID = "28-0625657fe542"   # 공기 중 — 실온 기준 채널
MLX_ADDRS = [0x5A, 0x5B]

W1_DIR = "/sys/bus/w1/devices"
BULK = os.path.join(W1_DIR, "w1_bus_master1", "therm_bulk_read")
I2C_BUS = "/dev/i2c-1"
I2C_RDWR, I2C_M_RD = 0x0707, 0x0001
REG_TA, REG_TOBJ = 0x06, 0x07
RETRIES = 3
BELL = "\a"

# ── 인자 ────────────────────────────────────────────────
POS, OPT = [], {"warn": 5.0, "rate": 5.0}
_it = iter(sys.argv[1:])
for a in _it:
    if a == "--warn":
        OPT["warn"] = float(next(_it))
    elif a == "--rate":
        OPT["rate"] = float(next(_it))
    elif a in ("-h", "--help"):
        print(__doc__)
        raise SystemExit(0)
    else:
        POS.append(a)

INTERVAL = float(POS[0]) if len(POS) > 0 else 1.0
OUTPATH = POS[1] if len(POS) > 1 else os.path.expanduser("~/thermal_log.csv")
STOP_TEMP = float(POS[2]) if len(POS) > 2 else None
WARN_TEMP = STOP_TEMP - OPT["warn"] if STOP_TEMP is not None else None
RATE_LIMIT = OPT["rate"]


# ── DS18B20 (bulk) ──────────────────────────────────────
BULK_WHY = ""


def bulk_supported():
    """읽기만 되는지가 아니라 **쓰기까지** 되는지 확인한다.

    `therm_bulk_read`는 기본이 root:root 644라, 읽기는 되고 쓰기는 막힌다.
    그걸 구분하지 않으면 실행 중에 매번 조용히 실패해 값이 통째로 빈다.
    """
    global BULK_WHY
    if not os.path.exists(BULK):
        BULK_WHY = "커널에 therm_bulk_read 없음"
        return False
    try:
        with open(BULK) as f:
            if f.read().strip() == "-1":
                BULK_WHY = "드라이버가 미지원(-1)"
                return False
    except OSError as e:
        BULK_WHY = "읽기 실패(%s)" % e.strerror
        return False
    try:
        with open(BULK, "w") as f:      # 실제로 써 본다
            f.write("trigger")
    except OSError as e:
        BULK_WHY = "쓰기 권한 없음(%s) — 아래 setup 안내 참조" % e.strerror
        return False
    return True


def bulk_trigger():
    with open(BULK, "w") as f:
        f.write("trigger")


def bulk_ready(timeout=1.2):
    """변환 완료까지 기다린다. 파일이 1이면 완료, 0이면 진행 중."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with open(BULK) as f:
                if f.read().strip() == "1":
                    return True
        except OSError:
            return False
        time.sleep(0.02)
    return False


def read_temperature_file(dev_id):
    """`temperature`는 변환을 새로 걸지 않고 스크래치패드 값만 읽는다."""
    p = os.path.join(W1_DIR, dev_id, "temperature")
    try:
        with open(p) as f:
            return int(f.read().strip()) / 1000.0
    except (OSError, ValueError):
        return None


def read_w1_slave(dev_id):
    """폴백 — 변환을 직접 걸고 CRC까지 확인하는 원본 방식."""
    p = os.path.join(W1_DIR, dev_id, "w1_slave")
    try:
        with open(p) as f:
            txt = f.read()
    except OSError:
        return None
    if "YES" not in txt.split("\n")[0]:
        return None
    i = txt.find("t=")
    if i < 0:
        return None
    try:
        v = int(txt[i + 2:].split()[0]) / 1000.0
    except ValueError:
        return None
    return None if abs(v - 85.0) < 0.001 else v   # 85.0 = 변환 실패(전원 미인가)


# ── MLX90614 ────────────────────────────────────────────
class _Msg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16),
                ("len", ctypes.c_uint16), ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _Data(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_Msg)), ("nmsgs", ctypes.c_uint32)]


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


def mlx_read(fd, addr, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 3)()
    arr = (_Msg * 2)(
        _Msg(addr=addr, flags=0, len=1,
             buf=ctypes.cast(w, ctypes.POINTER(ctypes.c_uint8))),
        _Msg(addr=addr, flags=I2C_M_RD, len=3,
             buf=ctypes.cast(r, ctypes.POINTER(ctypes.c_uint8))))
    fcntl.ioctl(fd, I2C_RDWR, _Data(msgs=arr, nmsgs=2))
    return mlx_sane(r[0] | (r[1] << 8))


def mlx_pair(fd, addr):
    for _ in range(RETRIES):
        try:
            return mlx_read(fd, addr, REG_TOBJ), mlx_read(fd, addr, REG_TA)
        except OSError:
            time.sleep(0.01)
    return None, None


# ── 기동 점검 ────────────────────────────────────────────
found = sorted(os.path.basename(p) for p in glob.glob(os.path.join(W1_DIR, "28-*")))
USE_BULK = bulk_supported()
fd = os.open(I2C_BUS, os.O_RDWR)

bar = "=" * 72
print(bar)
print(" 온도 로거 (bulk read 판)")
print(" 저장     : %s" % OUTPATH)
print(" DS18B20  : 버스에서 %d개 발견 — %s" % (len(found), ", ".join(found) or "없음"))
print("   셀 표면: %s %s" % (CELL_ID, "OK" if CELL_ID in found else "<< 버스에 없음! 확인 필요"))
print("   실온   : %s %s" % (AMBIENT_ID, "OK" if AMBIENT_ID in found else "<< 버스에 없음! 확인 필요"))
if USE_BULK:
    print(" 동시변환 : 사용 (therm_bulk_read) — 센서가 늘어도 750ms 그대로 → 약 0.85초")
else:
    print(" 동시변환 : 미사용 → 순차 읽기로 폴백 (약 2.6초)")
    print("            사유: %s" % BULK_WHY)
    print("            켜려면 한 번만: sudo bash ~/enable_w1_bulk.sh")
for a in MLX_ADDRS:
    o, _ = mlx_pair(fd, a)
    print(" MLX 0x%02X : %s" % (a, ("OK  TOBJ=%.2f℃" % o) if o is not None else "<< 응답 없음!"))
print(" 간격     : %.2f초" % INTERVAL)
if STOP_TEMP is not None:
    print(" 중단온도 : %.1f도   (주의 %.1f도부터)" % (STOP_TEMP, WARN_TEMP))
    print(" 급상승   : 1분에 %.1f도 이상" % RATE_LIMIT)
print(" 중단     : Ctrl+C")
print(bar)

new = not os.path.exists(OUTPATH) or os.path.getsize(OUTPATH) == 0
f = open(OUTPATH, "a", newline="")
w = csv.writer(f)
if new:
    w.writerow(["timestamp", "elapsed_s", "ds18b20_c", "ds_ambient_c", "delta_c",
                "mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"])

hist = deque()
t0 = time.time()
n = 0
missing = 0
warned = stopped = False
peak = None
last_intervals = deque(maxlen=20)
prev_t = None


def fmt(x):
    return "" if x is None else round(x, 3)


try:
    while True:
        tick = t0 + n * INTERVAL
        now = time.time()
        if tick > now:
            time.sleep(tick - now)
        n += 1

        # --- DS18B20 : 한 번의 변환으로 둘 다 ---
        if USE_BULK:
            try:
                bulk_trigger()
                bulk_ready()
                ds = read_temperature_file(CELL_ID)
                amb = read_temperature_file(AMBIENT_ID)
                if ds is not None and abs(ds - 85.0) < 0.001:
                    ds = None
                if amb is not None and abs(amb - 85.0) < 0.001:
                    amb = None
            except OSError:
                ds = amb = None
        else:
            ds = read_w1_slave(CELL_ID)
            amb = read_w1_slave(AMBIENT_ID)

        vals = {}
        for a in MLX_ADDRS:
            vals[a] = mlx_pair(fd, a)

        t = time.time()
        el = t - t0
        if prev_t is not None:
            last_intervals.append(t - prev_t)
        prev_t = t

        if ds is None:
            missing += 1
        delta = (ds - amb) if (ds is not None and amb is not None) else None

        w.writerow([datetime.fromtimestamp(t).isoformat(timespec="seconds"),
                    round(el, 1), fmt(ds), fmt(amb), fmt(delta),
                    fmt(vals[0x5A][0]), fmt(vals[0x5A][1]),
                    fmt(vals[0x5B][0]), fmt(vals[0x5B][1])])
        if n % 10 == 0:
            f.flush()

        # --- 3단 경보 (셀 절대온도 기준) ---
        alarm = ""
        if ds is not None:
            peak = ds if peak is None else max(peak, ds)
            hist.append((t, ds))
            while hist and t - hist[0][0] > 60:
                hist.popleft()
            if STOP_TEMP is not None:
                if ds >= STOP_TEMP and not stopped:
                    stopped = True
                    alarm = BELL * 3 + "  << 중단온도 도달! 즉시 로드를 끄시오"
                elif ds >= WARN_TEMP and not warned:
                    warned = True
                    alarm = BELL + "  << 주의 온도"
                if len(hist) > 1 and ds - min(v for _, v in hist) >= RATE_LIMIT:
                    alarm = BELL * 2 + "  << 급상승 (1분 %.1f도)" % (ds - min(v for _, v in hist))

        ir = max([v for v in (vals[0x5A][0], vals[0x5B][0]) if v is not None] or [None])
        print("%s  t+%-8.1f 셀=%6s  실온=%6s  차=%6s  IR=%6s  (n=%d, 결측 %d)%s"
              % (datetime.fromtimestamp(t).strftime("%H:%M:%S"), el,
                 "%.2f" % ds if ds is not None else "  --",
                 "%.2f" % amb if amb is not None else "  --",
                 "%+.2f" % delta if delta is not None else "  --",
                 "%.2f" % ir if ir is not None else "  --",
                 n, missing, alarm))
except KeyboardInterrupt:
    print("\n-- 중단 --")
finally:
    f.flush()
    f.close()
    os.close(fd)
    avg = sum(last_intervals) / len(last_intervals) if last_intervals else 0
    print("샘플 %d개  결측 %d개  실측 간격 %.2f초  최고 셀온도 %s  파일 %s"
          % (n, missing, avg, ("%.2f℃" % peak) if peak is not None else "--", OUTPATH))
