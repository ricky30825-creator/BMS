#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""세 18650 run 을 공통 SOC 격자에 올려 하나의 비교표로 만든다.

각 run 의 *_soc.csv 를 읽어 SOC 100 -> 0 을 0.5% 간격으로 선형보간한다.
전압은 그 SOC 에서의 단자 전압, IR 은 max(5a, 5b) 핫스팟이다.

  python soc_compare.py
"""
import csv
import os

BASE = r"C:\Users\<USER>\Desktop\라즈베리파이5테스트"
RUNS = [
    ("b1", "18650_b1_1A_20260831", "1A"),
    ("b2", "18650_b2_2A_20260831", "2A"),
    ("b3", "18650_b3_3A_20260831", "3A"),
]
STEP = 0.5
OUT = os.path.join(BASE, "18650_SOC비교_20260831.csv")


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def load(folder):
    p = os.path.join(BASE, folder, folder + "_soc.csv")
    rows = []
    with open(p, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            soc = num(r["soc_pct"])
            v = num(r["voltage_v"])
            if soc is None or v is None:
                continue
            a, b = num(r["mlx5a_obj_c"]), num(r["mlx5b_obj_c"])
            ir = max([x for x in (a, b) if x is not None], default=None)
            rows.append((soc, v, ir, num(r["current_a"]), num(r["dod_ah"])))
    rows.sort(key=lambda x: -x[0])          # 100 -> 0
    return rows


def interp(rows, target, idx):
    """SOC=target 에서의 값. rows 는 SOC 내림차순."""
    lo = None
    for r in rows:
        if r[0] >= target:
            lo = r
        else:
            hi = r
            if lo is None:
                return None
            if r[idx] is None or lo[idx] is None:
                return None
            span = lo[0] - hi[0]
            if span <= 0:
                return lo[idx]
            f = (lo[0] - target) / span
            return lo[idx] + (hi[idx] - lo[idx]) * f
    return lo[idx] if lo else None


data = {}
for key, folder, label in RUNS:
    data[key] = load(folder)
    print("%s (%s): %d rows, SOC %.2f -> %.2f"
          % (key, label, len(data[key]), data[key][0][0], data[key][-1][0]))

hdr = ["soc_pct"]
for key, _, label in RUNS:
    hdr += [key + "_" + label + "_voltage_v"]
for key, _, label in RUNS:
    hdr += [key + "_" + label + "_ir_c"]
for key, _, label in RUNS:
    hdr += [key + "_" + label + "_dod_ah"]

n = 0
with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(hdr)
    steps = int(round(100.0 / STEP))
    for i in range(steps + 1):
        soc = 100.0 - i * STEP
        row = ["%.1f" % soc]
        for idx in (1, 2, 4):
            for key, _, _l in RUNS:
                v = interp(data[key], soc, idx)
                row.append("" if v is None else "%.4f" % v)
        w.writerow(row)
        n += 1

print("\n저장: %s  (%d 행, %.1f%% 간격)" % (OUT, n, STEP))
print("\n  soc    b1 1A     b2 2A     b3 3A      (단자 전압 V)")
for soc in (100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0):
    vals = [interp(data[k], float(soc), 1) for k, _, _l in RUNS]
    print("  %3d%%  %s" % (soc, "  ".join(
        "  --  " if v is None else "%8.4f" % v for v in vals)))
print("\n  soc    b1 1A     b2 2A     b3 3A      (IR 핫스팟 C)")
for soc in (100, 80, 60, 40, 20, 0):
    vals = [interp(data[k], float(soc), 2) for k, _, _l in RUNS]
    print("  %3d%%  %s" % (soc, "  ".join(
        "  --  " if v is None else "%8.3f" % v for v in vals)))
