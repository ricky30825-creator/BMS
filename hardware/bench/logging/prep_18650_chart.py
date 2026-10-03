"""merged_18650_1A.csv 에서 18650 차트용 요약 데이터(JSON)를 만든다.

방전기 누적 카운터(E_CAPACITY / E_QUANTITY)는 로그 도중 한 번 리셋되므로,
끝값−시작값이 아니라 **증가분만 합산**해서 실제 방출량을 구한다.
"""
import csv
import json
import os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "merged_18650_1A.csv")
OUT = os.path.join(HERE, "chart_data_18650.json")
TARGET_POINTS = 260


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


rows = []
with open(SRC, encoding="utf-8-sig") as fh:
    for r in csv.DictReader(fh):
        rows.append({
            "ts": datetime.fromisoformat(r["timestamp"]),
            "m": float(r["elapsed_min"]),
            "v": f(r["voltage_v"]),
            "i": f(r["current_a"]),
            "p": f(r["power_w"]),
            "cap": f(r["capacity_mah"]),
            "wh": f(r["energy_wh"]),
            "ds": f(r["ds18b20_c"]),
        })

# 누적 카운터의 증가분만 합산 (로그 도중 리셋되므로 끝값−시작값은 못 쓴다).
# 병합 파일은 3.6초 간격이라 경계 증가분이 새므로 방전기 원본(1초 간격)에서 센다.
RAW = r"C:\Users\<USER>\Desktop\18650 방전데이터.csv"

drawn_mah = drawn_wh = 0.0
prev_cap = prev_wh = None
with open(RAW, encoding="utf-8", errors="replace") as fh:
    for _ in range(4):
        fh.readline()
    for r in csv.reader(fh):
        if len(r) < 11 or not r[0]:
            continue
        try:
            wh, cap = float(r[5]), float(r[6])
        except ValueError:
            continue
        if prev_cap is not None and cap >= prev_cap:
            drawn_mah += cap - prev_cap
        if prev_wh is not None and wh >= prev_wh:
            drawn_wh += wh - prev_wh
        prev_cap, prev_wh = cap, wh

ds_vals = [r for r in rows if r["ds"] is not None]
v_vals = [r for r in rows if r["v"] is not None]

summary = {
    "ds_start": ds_vals[0]["ds"],
    "ds_end": ds_vals[-1]["ds"],
    "ds_rise": round(ds_vals[-1]["ds"] - ds_vals[0]["ds"], 3),
    "ds_rate_c_per_h": round((ds_vals[-1]["ds"] - ds_vals[0]["ds"]) / (rows[-1]["m"] / 60.0), 2),
    "v_start": v_vals[0]["v"],
    "v_end": v_vals[-1]["v"],
    "v_drop": round(v_vals[0]["v"] - v_vals[-1]["v"], 3),
    "elec_from_min": round(v_vals[0]["m"], 2),
    "elec_to_min": round(v_vals[-1]["m"], 2),
    "drawn_mah": round(drawn_mah, 1),
    "drawn_wh": round(drawn_wh, 3),
    "current_a": round(sum(abs(r["i"]) for r in rows if r["i"] is not None) / len(v_vals), 3),
    "power_w": round(sum(r["p"] for r in rows if r["p"] is not None) / len(v_vals), 2),
}

step = max(1, len(rows) // TARGET_POINTS)
points = []
for idx, r in enumerate(rows):
    keep = idx % step == 0 or idx == len(rows) - 1
    # 전기 데이터가 시작되는 지점은 반드시 남긴다
    if not keep and idx > 0 and (rows[idx - 1]["v"] is None) != (r["v"] is None):
        keep = True
    if keep:
        points.append({
            "m": round(r["m"], 3),
            "clock": r["ts"].strftime("%H:%M:%S"),
            "ds": round(r["ds"], 3) if r["ds"] is not None else None,
            "v": round(r["v"], 3) if r["v"] is not None else None,
            "p": round(r["p"], 2) if r["p"] is not None else None,
        })

payload = {
    "start_clock": rows[0]["ts"].strftime("%Y-%m-%d %H:%M:%S"),
    "end_clock": rows[-1]["ts"].strftime("%H:%M:%S"),
    "total_minutes": round(rows[-1]["m"], 1),
    "total_samples": len(rows),
    "summary": summary,
    "points": points,
}

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

print("원본 %d행 -> 차트 포인트 %d개" % (len(rows), len(points)))
print("온도  %.3f -> %.3f C  (+%.2f C, %.2f C/h)"
      % (summary["ds_start"], summary["ds_end"], summary["ds_rise"], summary["ds_rate_c_per_h"]))
print("전압  %.3f -> %.3f V  (-%.3f V)  [%.1f~%.1f분 구간만 계측]"
      % (summary["v_start"], summary["v_end"], summary["v_drop"],
         summary["elec_from_min"], summary["elec_to_min"]))
print("방출  %.1f mAh / %.3f Wh   (평균 %.3f A, %.2f W)"
      % (summary["drawn_mah"], summary["drawn_wh"], summary["current_a"], summary["power_w"]))
print("출력:", OUT)
