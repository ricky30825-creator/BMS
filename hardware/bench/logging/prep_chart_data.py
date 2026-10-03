"""merged_discharge.csv 에서 차트용 요약 데이터(JSON)를 만든다."""
import csv
import json
import os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "merged_discharge.csv")
OUT = os.path.join(HERE, "chart_data.json")

PHASES = ["1A", "2A", "2.5A"]  # 오조준 구간(1A_mlx_misaimed)은 제외
TARGET_POINTS = 260


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


rows = []
with open(SRC, encoding="utf-8-sig") as fh:
    for r in csv.DictReader(fh):
        if r["phase"] not in PHASES:
            continue
        rows.append(
            {
                "ts": datetime.fromisoformat(r["timestamp"]),
                "phase": r["phase"],
                "p": f(r["power_w"]),
                "v": f(r["voltage_v"]),
                "i": f(r["current_a"]),
                "ds": f(r["ds18b20_c"]),
                "obj": f(r["mlx_object_c"]),
                "amb": f(r["mlx_ambient_c"]),
            }
        )

rows.sort(key=lambda r: r["ts"])
t0 = rows[0]["ts"]

# 구간별 요약 (다운샘플 전 원본 기준)
summary = []
for ph in PHASES:
    sub = [r for r in rows if r["phase"] == ph]
    ds = [r["ds"] for r in sub if r["ds"] is not None]
    pw = [r["p"] for r in sub if r["p"] is not None]
    dur_min = (sub[-1]["ts"] - sub[0]["ts"]).total_seconds() / 60.0
    rise = ds[-1] - ds[0] if len(ds) >= 2 else 0.0
    summary.append(
        {
            "phase": ph,
            "samples": len(sub),
            "minutes": round(dur_min, 1),
            "power_w": round(sum(pw) / len(pw), 2) if pw else None,
            "ds_start": round(ds[0], 3) if ds else None,
            "ds_end": round(ds[-1], 3) if ds else None,
            "rise_c": round(rise, 2),
            "rate_c_per_h": round(rise / (dur_min / 60.0), 2) if dur_min > 0 else None,
            "start_min": round((sub[0]["ts"] - t0).total_seconds() / 60.0, 2),
            "end_min": round((sub[-1]["ts"] - t0).total_seconds() / 60.0, 2),
        }
    )

# 다운샘플 — 구간 경계를 보존하려고 구간별로 균등 추출
step = max(1, len(rows) // TARGET_POINTS)
points = []
for idx, r in enumerate(rows):
    keep = idx % step == 0 or idx == len(rows) - 1
    if not keep and idx > 0 and rows[idx - 1]["phase"] != r["phase"]:
        keep = True  # 구간이 바뀌는 지점은 반드시 남긴다
    if keep:
        points.append(
            {
                "m": round((r["ts"] - t0).total_seconds() / 60.0, 3),
                "clock": r["ts"].strftime("%H:%M:%S"),
                "ph": r["phase"],
                "p": round(r["p"], 2) if r["p"] is not None else None,
                "ds": round(r["ds"], 3) if r["ds"] is not None else None,
                "obj": round(r["obj"], 2) if r["obj"] is not None else None,
                "amb": round(r["amb"], 2) if r["amb"] is not None else None,
            }
        )

payload = {
    "start_clock": t0.strftime("%Y-%m-%d %H:%M:%S"),
    "end_clock": rows[-1]["ts"].strftime("%H:%M:%S"),
    "total_minutes": round((rows[-1]["ts"] - t0).total_seconds() / 60.0, 1),
    "total_samples": len(rows),
    "summary": summary,
    "points": points,
}

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

print("원본 %d행 -> 차트 포인트 %d개" % (len(rows), len(points)))
print("기간: %s ~ %s (%.1f분)" % (payload["start_clock"], payload["end_clock"], payload["total_minutes"]))
for s in summary:
    print(
        "  %-5s %5.1f분  %5.2fW  DS %.3f->%.3f  (+%.2fC, %.2fC/h)"
        % (s["phase"], s["minutes"], s["power_w"] or 0, s["ds_start"], s["ds_end"], s["rise_c"], s["rate_c_per_h"] or 0)
    )
print("출력:", OUT)
