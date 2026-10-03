#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""INA 0.1초 로그에 전류적산 SOC를 붙여 통합 CSV를 만든다.

  SOC(t) = 100 x (1 - 누적Ah(t) / 총Ah)      <- 쿨롱 카운팅

주의 — 이 SOC는 **출력단 기준**이다.
  INA226이 부스트 컨버터 뒤(5V 출력)에 달려 있으므로 적산되는 것은 출력 전하다.
  셀이 실제로 쓴 전하가 아니다. 부스트 효율이 부하·셀전압에 따라 변하므로
  출력 SOC 50%가 셀 SOC 50%와 같지 않다.
  * 같은 팩의 run 끼리 비교 / run 내부 진행축 -> 유효
  * 셀의 진짜 SOC -> 아니다. 그건 18650(모드 1)에서만 나온다
  * 총Ah로 정규화하므로 run이 끝나야 계산된다 (실시간 BMS용이 아니다)

사용법:
  python add_soc.py <run디렉터리> [--every 1.0] [--out 파일명.csv]
"""
import csv
import glob
import os
import sys
from bisect import bisect_left
from datetime import datetime

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)

RUN = os.path.abspath(sys.argv[1])
EVERY = 1.0
OUT = None
for i, a in enumerate(sys.argv):
    if a == "--every":
        EVERY = float(sys.argv[i + 1])
    if a == "--out":
        OUT = sys.argv[i + 1]
if OUT is None:
    OUT = os.path.join(RUN, os.path.basename(RUN.rstrip("\\/")) + "_soc.csv")


def ts(s):
    return datetime.fromisoformat(s)


def files(pat):
    return sorted(p for p in glob.glob(os.path.join(RUN, pat))
                  if "aborted" not in os.path.basename(p))


def load(paths, cols):
    rows = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    t = ts(r["timestamp"])
                except Exception:
                    continue
                v = []
                for c in cols:
                    try:
                        v.append(float(r[c]))
                    except Exception:
                        v.append(None)
                rows.append((t,) + tuple(v))
    rows.sort(key=lambda x: x[0])
    return rows


ina = load(files("*_ina*.csv"), ["voltage_v", "current_a"])
ina = [r for r in ina if r[1] is not None and r[2] is not None]
if not ina:
    print("INA CSV를 찾지 못했다:", RUN)
    sys.exit(1)

temp = load(files("*_temp.csv"), ["ds18b20_c", "ds_ambient_c", "delta_c"])
mlx = load(files("*_mlx*.csv"), ["mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"])

# --- 방전 구간 ---
live = [r for r in ina if r[1] > 1.0]
peak = max((abs(r[2]) for r in live), default=0.0)
THR = max(0.1, 0.3 * peak)          # 저전류 시운전 구간을 배제 (analyze_run2와 동일 규칙)
disch = [r for r in live if abs(r[2]) >= THR]
t0, t1 = disch[0][0], disch[-1][0]

# --- 1차 통과: 누적 Ah/Wh 궤적 ---
cum_ah = cum_wh = 0.0
traj = []
prev = None
for (t, v, i) in disch:
    if prev is not None:
        dt = (t - prev[0]).total_seconds()
        if 0 < dt <= 1.0:                 # 기록 공백은 적산에서 제외
            cum_ah += abs(i) * dt / 3600.0
            cum_wh += abs(i) * prev[1] * dt / 3600.0
    traj.append((t, cum_ah, cum_wh, v, i))
    prev = (t, v, i)
TOT_AH, TOT_WH = cum_ah, cum_wh

# --- 온도/IR 최근접 조회 ---
t_keys = [r[0] for r in temp]
m_keys = [r[0] for r in mlx]


def nearest(rows, keys, t):
    if not rows:
        return None
    k = bisect_left(keys, t)
    cand = [x for x in (k - 1, k) if 0 <= x < len(rows)]
    if not cand:
        return None
    return rows[min(cand, key=lambda x: abs((keys[x] - t).total_seconds()))]


# --- 리샘플 후 기록 ---
hdr = ["timestamp", "elapsed_s", "soc_pct", "dod_ah", "dod_wh",
       "voltage_v", "current_a", "power_w", "energy_wh_cum",
       "ds_cell_c", "ds_ambient_c", "delta_c",
       "mlx5a_obj_c", "mlx5a_amb_c", "ir_diff_5a_c",
       "mlx5b_obj_c", "mlx5b_amb_c", "ir_diff_5b_c"]

n = 0
next_t = 0.0
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(hdr)
    for (t, ah, wh, v, i) in traj:
        el = (t - t0).total_seconds()
        if el + 1e-9 < next_t:
            continue
        next_t = el + EVERY
        soc = 100.0 * (1.0 - ah / TOT_AH) if TOT_AH else None
        tr = nearest(temp, t_keys, t)
        mr = nearest(mlx, m_keys, t)

        def g(row, k):
            return "" if row is None or row[k] is None else "%.4f" % row[k]

        d5a = d5b = ""
        if mr and mr[1] is not None and mr[2] is not None:
            d5a = "%.4f" % (mr[1] - mr[2])
        if mr and mr[3] is not None and mr[4] is not None:
            d5b = "%.4f" % (mr[3] - mr[4])
        w.writerow([t.isoformat(), "%.1f" % el, "%.4f" % soc, "%.5f" % ah, "%.4f" % wh,
                    "%.4f" % v, "%.4f" % i, "%.4f" % (v * abs(i)), "%.4f" % wh,
                    g(tr, 1), g(tr, 2), g(tr, 3),
                    g(mr, 1), g(mr, 2), d5a, g(mr, 3), g(mr, 4), d5b])
        n += 1

print("=" * 68)
print(" 전류적산 SOC 생성 — %s" % os.path.basename(RUN.rstrip("\\/")))
print("=" * 68)
print("  방전 구간   : %s -> %s  (%.3f h)" % (t0, t1, (t1 - t0).total_seconds() / 3600))
print("  총 적산     : %.4f Ah   %.3f Wh   <- SOC 100%%의 기준값" % (TOT_AH, TOT_WH))
print("  출력 행수   : %d 행  (%.1f초 간격)" % (n, EVERY))
print("  저장        : %s" % OUT)

print("\n[ SOC 눈금이 언제 지나갔는가 ]")
print("  %-6s %10s %10s %10s %9s %9s" % ("SOC", "경과h", "누적Ah", "누적Wh", "IR차분", "delta_c"))
for target in (100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0):
    want = TOT_AH * (100 - target) / 100.0
    hit = None
    for (t, ah, wh, v, i) in traj:
        if ah >= want:
            hit = (t, ah, wh)
            break
    if hit is None:
        hit = (traj[-1][0], traj[-1][1], traj[-1][2])
    t, ah, wh = hit
    # 단일 샘플은 튄다 -> 눈금 앞뒤 60초 창 평균
    def win_avg(rows, lo_i, hi_i):
        vals = []
        for r in rows:
            d = (r[0] - t).total_seconds()
            if -60 <= d <= 60 and r[lo_i] is not None and r[hi_i] is not None:
                vals.append(r[lo_i] - r[hi_i])
        return sum(vals) / len(vals) if vals else None

    def win_one(rows, idx):
        vals = [r[idx] for r in rows
                if -60 <= (r[0] - t).total_seconds() <= 60 and r[idx] is not None]
        return sum(vals) / len(vals) if vals else None

    ir = win_avg(mlx, 1, 2)
    dc = win_one(temp, 3)
    print("  %5d%% %10.3f %10.4f %10.3f %9s %9s"
          % (target, (t - t0).total_seconds() / 3600, ah, wh,
             "--" if ir is None else "%+.3f" % ir,
             "--" if dc is None else "%+.3f" % dc))

VMAX = max(r[1] for r in disch)
if VMAX < 4.5:
    print("")
    print("  * 맨 셀(모드 1)로 판별했다 — 최고 단자전압 %.3f V." % VMAX)
    print("    INA226이 셀 단자에 직결돼 있으므로 이 SOC 는 **셀의 진짜 SOC** 다.")
    print("    부스트 컨버터를 거치지 않아 단자전압이 SOC 를 직접 반영한다.")
    print("    주의: SOC 100% 는 「이 run 의 시작점」이지 절대 완충이 아니다.")
    print("          run 전에 빠져나간 전하가 있으면 그만큼 위쪽이 잘려 있다.")
else:
    print("")
    print("  ! 이 SOC 는 출력단(5V) 기준이다. 부스트 뒤에서 잰 전하라 셀 SOC 와 같지 않다.")
    print("    같은 팩의 run 비교와 run 내부 진행축으로는 유효하다.")
    print("    셀의 진짜 SOC 는 18650(모드 1)에서만 나온다.")
print("=" * 68)
