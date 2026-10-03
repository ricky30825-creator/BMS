import csv
P = "/home/<USER>/PB5000_r3b_1A_ina.csv"
rows = []
for r in csv.DictReader(open(P)):
    try:
        rows.append((r["timestamp"], float(r["elapsed_s"]), float(r["voltage_v"]),
                     float(r["current_a"])))
    except Exception:
        pass
print("rows %d   duration %.1f s (%.3f h)" % (len(rows), rows[-1][1], rows[-1][1] / 3600))

# 중간 끊김 탐지
runs = []
prev = None
for t, e, v, i in rows:
    st = abs(i) >= 0.5
    if prev is None or st != prev:
        runs.append([st, e, e]); prev = st
    else:
        runs[-1][2] = e
print("\n[구간]")
for st, a, b in runs:
    if b - a > 1.0:
        print("  %-4s %9.1f ~ %9.1f s   (%.2f 분)"
              % ("방전" if st else "정지", a, b, (b - a) / 60))

# 마지막 60초 전압 궤적
print("\n[종료 직전 60초]")
end = rows[-1][1]
sel = [x for x in rows if end - x[1] <= 60]
step = max(1, len(sel) // 20)
for x in sel[::step]:
    print("  t-%5.1f s   %7.4f V  %+8.4f A" % (end - x[1], x[2], x[3]))

# 전체 전압 추이
print("\n[10분 간격 전압]")
for m in range(0, int(end / 60) + 1, 10):
    s = [x for x in rows if abs(x[1] - m * 60) < 3]
    if s:
        print("  %3d 분   %7.4f V  %+8.4f A" % (m, s[0][2], s[0][3]))
