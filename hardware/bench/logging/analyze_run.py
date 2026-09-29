#!/usr/bin/env python3
"""PB-20000 1A 방전 run 분석 — INA 2파트 + 온도 + IR을 읽어 요약 통계를 낸다.

사용법:
    python analyze_run.py <run디렉터리> [--label-mah 20000] [--label-v 3.7]
"""
import csv
import os
import sys
from datetime import datetime

d = sys.argv[1] if len(sys.argv) > 1 else "PB20000_r1_1A"
LABEL_MAH, LABEL_V = 20000.0, 3.7
for i, a in enumerate(sys.argv):
    if a == "--label-mah":
        LABEL_MAH = float(sys.argv[i + 1])
    if a == "--label-v":
        LABEL_V = float(sys.argv[i + 1])

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = d if os.path.isabs(d) else os.path.join(HERE, d)


def ts(s):
    return datetime.fromisoformat(s)


def load_ina(paths):
    rows = []
    for p in paths:
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    rows.append((ts(r["timestamp"]), float(r["voltage_v"]),
                                 float(r["current_a"]), int(r.get("ovf") or 0)))
                except Exception:
                    continue
    rows.sort(key=lambda x: x[0])
    return rows


ina = load_ina([os.path.join(RUN, "PB20000_r1_1A_ina.csv"),
                os.path.join(RUN, "PB20000_r1_1A_ina_part2.csv")])

print("=" * 66)
print(" PB-20000  1A 정전류 방전 분석")
print("=" * 66)

# --- 방전 구간만 (전압 1V 이상, 전류 절대값 0.1A 이상) ---
disch = [r for r in ina if r[1] > 1.0 and abs(r[2]) > 0.1]
t0, t1 = disch[0][0], disch[-1][0]
wall = (t1 - t0).total_seconds()

ah = wh = 0.0
prev = None
gap_s = 0.0
gaps = []
for (t, v, i, o) in disch:
    if prev is not None:
        dt = (t - prev[0]).total_seconds()
        if 0 < dt <= 1.0:
            ah += abs(i) * dt / 3600.0
            wh += abs(i) * prev[1] * dt / 3600.0
        elif dt > 1.0:
            gaps.append((prev[0], t, dt))
            gap_s += dt
    prev = (t, v, i, o)

vs = [r[1] for r in disch]
cs = [abs(r[2]) for r in disch]
ovf = sum(r[3] for r in disch)

print("\n[ 시간 ]")
print("  시작        : %s" % t0)
print("  종료        : %s" % t1)
print("  총 경과     : %.0f s  (%.3f h)" % (wall, wall / 3600))
print("  기록 공백   : %.0f s  (%.2f 분, %d구간)" % (gap_s, gap_s / 60, len(gaps)))
for a, b, dt in gaps:
    print("     %s -> %s  (%.0f s)" % (a.strftime("%H:%M:%S"), b.strftime("%H:%M:%S"), dt))
print("  샘플        : %d" % len(disch))

print("\n[ 전기 ]")
print("  평균 전류   : %.4f A   (최소 %.4f / 최대 %.4f)" % (sum(cs) / len(cs), min(cs), max(cs)))
print("  평균 전압   : %.4f V   (최소 %.4f / 최대 %.4f)" % (sum(vs) / len(vs), min(vs), max(vs)))
print("  OVF         : %d" % ovf)

# 공백 구간을 평균 전류로 보정
ah_gap = sum(cs) / len(cs) * gap_s / 3600.0
wh_gap = ah_gap * (sum(vs) / len(vs))
print("\n[ 용량 · 에너지 ]  (5V 출력 기준)")
print("  적분값      : %.4f Ah   %.3f Wh   (기록된 구간만)" % (ah, wh))
print("  공백 보정   : +%.4f Ah  +%.3f Wh  (평균전류 x 공백시간)" % (ah_gap, wh_gap))
print("  ---------------------------------------------")
print("  총계        : %.4f Ah   %.3f Wh" % (ah + ah_gap, wh + wh_gap))

label_wh = LABEL_MAH / 1000.0 * LABEL_V
print("\n[ 라벨 대비 ]")
print("  라벨        : %.0f mAh @ %.1f V = %.1f Wh  (셀 기준)" % (LABEL_MAH, LABEL_V, label_wh))
print("  실측 에너지 : %.1f Wh  ->  라벨의 %.1f %%" % (wh + wh_gap, (wh + wh_gap) / label_wh * 100))
print("  실측 용량   : %.0f mAh @5V  ->  라벨 mAh의 %.1f %%"
      % ((ah + ah_gap) * 1000, (ah + ah_gap) * 1000 / LABEL_MAH * 100))

# --- 컷오프 과도 ---
print("\n[ 방전 종료 컷오프 ]")
last_ok = disch[-1]
after = [r for r in ina if r[0] > last_ok[0]][:25]
print("  마지막 정상 : %s  %.4f V  %+.4f A" % (last_ok[0].strftime("%H:%M:%S.%f")[:-3],
                                               last_ok[1], last_ok[2]))
for (t, v, i, o) in after[:8]:
    print("    +%6.2f s   %.4f V  %+.4f A" % ((t - last_ok[0]).total_seconds(), v, i))

# --- 온도 ---
tp = os.path.join(RUN, "PB20000_r1_1A_temp.csv")
if os.path.exists(tp):
    trows = []
    with open(tp, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                trows.append((ts(r["timestamp"]), float(r["ds18b20_c"]),
                              float(r["ds_ambient_c"]), float(r["delta_c"])))
            except Exception:
                continue
    inrun = [r for r in trows if t0 <= r[0] <= t1]
    print("\n[ 온도 ]  (방전 구간 %d행)" % len(inrun))
    cell = [r[1] for r in inrun]; amb = [r[2] for r in inrun]; dl = [r[3] for r in inrun]
    print("  셀          : %.2f -> %.2f  (최대 %.2f)" % (cell[0], cell[-1], max(cell)))
    print("  실온        : %.2f -> %.2f  (최소 %.2f / 최대 %.2f)" % (amb[0], amb[-1], min(amb), max(amb)))
    print("  delta_c     : %.2f -> %.2f  (최대 %.2f / 최소 %.2f)" % (dl[0], dl[-1], max(dl), min(dl)))
    P = sum(cs) / len(cs) * (sum(vs) / len(vs))
    print("  평균 부하   : %.3f W" % P)
    print("  R_th (최대) : %.3f C/W   <- delta_c 최대값 기준" % (max(dl) / P))
    print("  * 실온이 %.2f C 움직였다 -> delta_c 단독 해석 금지 (CLAUDE.md 참조)"
          % (max(amb) - min(amb)))

# --- IR 2존 ---
mp = os.path.join(RUN, "PB20000_r1_1A_mlx01.csv")
if os.path.exists(mp):
    a_hi = b_hi = n = 0
    first_flip = None
    prev_win = None
    with open(mp, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                t = ts(r["timestamp"])
                a = float(r["mlx5a_obj_c"]); b = float(r["mlx5b_obj_c"])
            except Exception:
                continue
            if not (t0 <= t <= t1):
                continue
            n += 1
            win = "A" if a > b else "B"
            if win == "A":
                a_hi += 1
            else:
                b_hi += 1
            if prev_win == "A" and win == "B" and first_flip is None:
                first_flip = t
            prev_win = win
    print("\n[ IR 2존 ]  (방전 구간 %d행)" % n)
    print("  0x5A 우세   : %d행 (%.1f %%)" % (a_hi, a_hi / n * 100))
    print("  0x5B 우세   : %d행 (%.1f %%)" % (b_hi, b_hi / n * 100))
    if first_flip:
        print("  최초 역전   : %s  (t+%.2f h)" % (first_flip.strftime("%H:%M:%S"),
                                                  (first_flip - t0).total_seconds() / 3600))
print("\n" + "=" * 66)
