#!/usr/bin/env python3
"""방전 시험용 온도 로거 (경보판) — DS18B20 + MLX90614를 CSV로 기록하고
   중단온도 도달 / 급상승 시 소리와 배너로 경고한다.

ETS 온도프로브가 없어 전자부하의 자동 온도차단이 동작하지 않으므로,
이 경보는 사람이 화면을 보는 것을 '보조'한다. 대체하지 않는다.

사용법:
    python3 thermal_log_alarm.py                       # 1초, ~/thermal_log.csv, 경보 없음
    python3 thermal_log_alarm.py 1 run.csv 60          # 중단온도 60도
    python3 thermal_log_alarm.py 1 run.csv 55 --rate 5 # 급상승 기준 5도/분 (기본값)

인자:
    1) 측정 간격(초). 0을 주면 변환시간만큼(약 1초)의 자연 주기
    2) 저장 파일 경로
    3) 중단온도(도). 생략하면 경보 없이 기록만
    --rate N  : 1분당 N도 이상 오르면 급상승 경고 (기본 5.0)
    --warn N  : 중단온도보다 N도 낮은 지점부터 주의 경고 (기본 5.0)

중단하려면 Ctrl+C.
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

I2C_RDWR = 0x0707
I2C_M_RD = 0x0001
I2C_DEV = "/dev/i2c-1"
MLX_ADDRS = [0x5A, 0x5B]
RETRIES = 3
BELL = "\a"

# ── DS18B20 역할 지정 ──────────────────────────────────────
# 2026-08-09 손으로 잡아 판별한 결과:
#   28-0625650a2c2c = 새 센서 (판별 시 손에 잡힘)
#   28-0625657fe542 = 기존 센서 (오늘 내내 배터리에 부착)
# 물리적으로 옮겨 달면 이 두 줄만 바꾸면 된다.
# 2026-08-26 정정: 두 프로브의 배치가 문서와 반대였다. 9개 run 전부에서
# 부하 차단 후 식는 쪽이 28-0625650a2c2c 였다 (r3 -7.90, r6 -7.79 C).
# 식는 쪽 = 케이스에 붙은 쪽이므로 아래처럼 맞바꾼다. 프로브는 그대로 두고
# 상수만 고쳐 과거 run 과의 배치 일관성을 유지한다.
# 2026-09-24: 28-0625657fe542 revived after rewiring (its 85.0 C was a VCC fault,
#   not a dead part) and was re-attached to the pack surface.
#   Surface/safety judgement still belongs to MLX; this probe feeds the
#   cell_temp_c feature that ai/model/preprocess.py requires.
CELL_ID = None                   # 2026-09-20: 셀 표면 DS 없음 — IR 이 표면을 맡는다
# 2026-09-04: ambient probe id changed 28-0625657fe542 -> 28-0625657fe542
#   the old id is no longer present on the 1-Wire bus
#   (sensorwatch reported amb = -99.000 before this fix).
AMBIENT_ID = "28-0625650a2c2c"   # 2026-09-20: 살아남은 프로브를 실온으로


# ── 인자 파싱 ───────────────────────────────────────────────
def parse_args(argv):
    pos, opts = [], {"rate": 5.0, "warn": 5.0}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--rate":
            opts["rate"] = float(argv[i + 1]); i += 2
        elif a == "--warn":
            opts["warn"] = float(argv[i + 1]); i += 2
        else:
            pos.append(a); i += 1
    return pos, opts


POS, OPT = parse_args(sys.argv[1:])
INTERVAL = float(POS[0]) if len(POS) > 0 else 1.0
OUTPATH = POS[1] if len(POS) > 1 else os.path.expanduser("~/thermal_log.csv")
STOP_TEMP = float(POS[2]) if len(POS) > 2 else None
WARN_TEMP = STOP_TEMP - OPT["warn"] if STOP_TEMP is not None else None
RATE_LIMIT = OPT["rate"]


# ── I2C (MLX90614) ─────────────────────────────────────────
class I2CMsg(ctypes.Structure):
    _fields_ = [
        ("addr", ctypes.c_uint16),
        ("flags", ctypes.c_uint16),
        ("len", ctypes.c_uint16),
        ("buf", ctypes.POINTER(ctypes.c_ubyte)),
    ]


class I2CRdwr(ctypes.Structure):
    _fields_ = [
        ("msgs", ctypes.POINTER(I2CMsg)),
        ("nmsgs", ctypes.c_uint32),
    ]


def read_word(fd, addr, reg):
    wbuf = (ctypes.c_ubyte * 1)(reg)
    rbuf = (ctypes.c_ubyte * 3)()
    msgs = (I2CMsg * 2)()
    msgs[0].addr = addr
    msgs[0].flags = 0
    msgs[0].len = 1
    msgs[0].buf = ctypes.cast(wbuf, ctypes.POINTER(ctypes.c_ubyte))
    msgs[1].addr = addr
    msgs[1].flags = I2C_M_RD
    msgs[1].len = 3
    msgs[1].buf = ctypes.cast(rbuf, ctypes.POINTER(ctypes.c_ubyte))
    data = I2CRdwr()
    data.msgs = ctypes.cast(msgs, ctypes.POINTER(I2CMsg))
    data.nmsgs = 2
    fcntl.ioctl(fd, I2C_RDWR, data)
    return rbuf[0] | (rbuf[1] << 8)


def read_mlx_once(fd, addr):
    try:
        raw_obj = read_word(fd, addr, 0x07)
        if raw_obj & 0x8000:          # 최상위 비트 = 에러 플래그
            return None, None
        raw_amb = read_word(fd, addr, 0x06)
        return raw_obj * 0.02 - 273.15, raw_amb * 0.02 - 273.15
    except OSError:
        return None, None


def read_mlx(fd, addr):
    for _ in range(RETRIES):
        obj, amb = read_mlx_once(fd, addr)
        if obj is not None:
            return obj, amb
    return None, None


# ── 1-Wire (DS18B20) ───────────────────────────────────────
def read_one_ds(path):
    """센서 하나를 한 번 읽는다. CRC 실패·85.0도(변환 실패)는 None."""
    try:
        with open(path) as f:
            lines = f.readlines()
        if len(lines) < 2 or not lines[0].strip().endswith("YES"):
            return None
        t = int(lines[1].split("t=")[-1]) / 1000.0
        if t == 85.0:                 # 전원투입 초기값 = 변환 실패
            return None
        return t
    except (OSError, ValueError, IndexError):
        return None


def read_ds_by_id(sensor_id):
    """지정한 ID의 센서를 읽는다. 실패하면 재시도."""
    path = "/sys/bus/w1/devices/%s/w1_slave" % sensor_id
    for _ in range(RETRIES):
        t = read_one_ds(path)
        if t is not None:
            return t
    return None


def list_ds_ids():
    return sorted(os.path.basename(p) for p in glob.glob("/sys/bus/w1/devices/28-*"))


# ── 경보 ────────────────────────────────────────────────────
def banner(text, bells=3):
    line = "*" * 72
    sys.stdout.write(BELL * bells)
    print("\n" + line)
    print("*** " + text)
    print(line + "\n")
    sys.stdout.flush()


def main():
    try:
        fd = os.open(I2C_DEV, os.O_RDWR)
    except OSError:
        fd = None                     # I2C가 없어도 DS18B20 기록은 계속한다

    new_file = not os.path.exists(OUTPATH)
    started = time.time()
    samples = 0
    ds_missing = 0
    history = deque()                 # (시각, 온도) — 급상승 판정용
    stop_fired = False
    warn_fired = False

    found = list_ds_ids()
    has_cell = CELL_ID in found
    has_amb = AMBIENT_ID in found

    print("=" * 72)
    print(" 온도 로거 (경보판)")
    print(" 저장     : %s" % OUTPATH)
    print(" DS18B20  : 버스에서 %d개 발견 — %s" % (len(found), ", ".join(found) if found else "없음"))
    print("   셀 표면: %s %s" % (CELL_ID, "OK" if has_cell else "<< 버스에 없음! 확인 필요"))
    print("   실온   : %s %s" % (AMBIENT_ID, "OK" if has_amb else "<< 버스에 없음! 확인 필요"))
    if not has_cell:
        print("   ※ 셀 센서가 없으면 경보가 동작하지 않습니다. 배선을 확인하세요.")
    print(" 간격     : %.2f초  (DS18B20 변환 750ms + 재시도 %d회 포함)" % (INTERVAL, RETRIES))
    if STOP_TEMP is not None:
        print(" 중단온도 : %.1f도   (주의 %.1f도부터)" % (STOP_TEMP, WARN_TEMP))
        print(" 급상승   : 1분에 %.1f도 이상" % RATE_LIMIT)
    else:
        print(" 경보     : 없음 (기록만)")
    print(" 중단     : Ctrl+C")
    print("=" * 72)
    sys.stdout.flush()

    with open(OUTPATH, "a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            # ds18b20_c 는 셀 표면 센서. 기존 merge_run.py 와의 호환을 위해 이름을 유지한다.
            w.writerow(["timestamp", "elapsed_s", "ds18b20_c", "ds_ambient_c", "delta_c",
                        "mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"])
            f.flush()

        try:
            while True:
                now = datetime.now()
                elapsed = round(time.time() - started, 1)

                ds = read_ds_by_id(CELL_ID)
                amb_ds = read_ds_by_id(AMBIENT_ID)
                delta = ds - amb_ds if (ds is not None and amb_ds is not None) else None

                vals = {}
                for addr in MLX_ADDRS:
                    vals[addr] = read_mlx(fd, addr) if fd is not None else (None, None)

                row = [now.isoformat(timespec="seconds"), elapsed,
                       "" if ds is None else round(ds, 3),
                       "" if amb_ds is None else round(amb_ds, 3),
                       "" if delta is None else round(delta, 3)]
                for addr in MLX_ADDRS:
                    obj, a = vals[addr]
                    row.append("" if obj is None else round(obj, 2))
                    row.append("" if a is None else round(a, 2))
                w.writerow(row)
                f.flush()

                samples += 1
                if ds is None:
                    ds_missing += 1

                # ── 상태 판정 ──
                status = ""
                if ds is not None and STOP_TEMP is not None:
                    history.append((time.time(), ds))
                    while history and time.time() - history[0][0] > 60:
                        history.popleft()

                    if ds >= STOP_TEMP:
                        status = "[중단온도 도달]"
                        if not stop_fired:
                            banner("중단온도 %.1f도 도달 (현재 %.2f도) — 즉시 로드를 끄십시오"
                                   % (STOP_TEMP, ds), bells=5)
                            stop_fired = True
                        else:
                            sys.stdout.write(BELL * 2)
                    elif ds >= WARN_TEMP:
                        status = "[주의]"
                        if not warn_fired:
                            banner("주의 — %.2f도, 중단온도 %.1f도까지 %.2f도 남음"
                                   % (ds, STOP_TEMP, STOP_TEMP - ds), bells=1)
                            warn_fired = True

                    if len(history) >= 2:
                        dt = history[-1][0] - history[0][0]
                        dT = history[-1][1] - history[0][1]
                        if dt >= 30 and dT / (dt / 60.0) >= RATE_LIMIT:
                            status = "[급상승]"
                            banner("급상승 — 최근 %.0f초에 %.2f도 (기준 %.1f도/분) — 즉시 확인"
                                   % (dt, dT, RATE_LIMIT), bells=5)
                            history.clear()

                def fmt(v, w=6, d=2):
                    return " " * (w - 2) + "--" if v is None else "%*.*f" % (w, d, v)

                print("%s  t+%-8.1f 셀=%s  실온=%s  차=%s  IR=%s  (n=%d, 결측 %d) %s"
                      % (now.strftime("%H:%M:%S"), elapsed,
                         fmt(ds), fmt(amb_ds), fmt(delta, 6, 2),
                         fmt(vals[0x5B][0]), samples, ds_missing, status))
                sys.stdout.flush()

                if INTERVAL > 0:
                    time.sleep(INTERVAL)

        except KeyboardInterrupt:
            print("\n중단. 총 %d개 기록 (DS18B20 결측 %d개, %.1f%%) -> %s"
                  % (samples, ds_missing,
                     100.0 * ds_missing / samples if samples else 0.0, OUTPATH))


if __name__ == "__main__":
    main()
