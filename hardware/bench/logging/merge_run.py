"""ATORCH CL24 방전기 로그 + 라즈베리파이 온도 로그를 타임스탬프로 병합한다 (범용판).

사용법:
    python merge_run.py <방전기CSV> <온도CSV> [출력CSV]

예:
    python merge_run.py "C:\\Users\\...\\battery load data.csv" run_18650_1A.csv merged_18650_1A.csv

방전기는 1초 간격, 온도 로거는 약 3.6초 간격이므로
온도 샘플 하나마다 ±TOL_SEC 안에서 가장 가까운 방전기 행을 붙인다.
"""
import csv
import os
import sys
from datetime import datetime, timedelta

TOL_SEC = 3


def load_discharger(path):
    """{초단위 datetime: 행}. 앞 3줄은 ATORCH 배너, 4번째 줄이 컬럼명이다."""
    table = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        head = [f.readline() for _ in range(4)]
        if "DATE" not in "".join(head):
            f.seek(0)  # 배너가 없는 파일이면 처음부터
            f.readline()
        for row in csv.reader(f):
            if len(row) < 11 or not row[0]:
                continue
            try:
                ts = datetime.strptime(row[0].strip(), "%Y-%m-%d_%H:%M:%S")
            except ValueError:
                continue
            table[ts] = row
    return table


def nearest(table, ts):
    for delta in range(TOL_SEC + 1):
        for sign in (0,) if delta == 0 else (-1, 1):
            hit = table.get(ts + timedelta(seconds=sign * delta))
            if hit:
                return hit
    return None


def num(row, idx):
    try:
        return "%.4f" % float(row[idx])
    except (ValueError, IndexError, TypeError):
        return ""


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)

    load_csv, thermal_csv = sys.argv[1], sys.argv[2]
    out_csv = sys.argv[3] if len(sys.argv) > 3 else "merged_run.csv"
    if not os.path.isabs(out_csv):
        out_csv = os.path.join(os.path.dirname(os.path.abspath(thermal_csv)), out_csv)

    table = load_discharger(load_csv)
    if not table:
        raise SystemExit("방전기 로그에서 읽을 행이 없다: " + load_csv)
    print("방전기 로그 %d행  (%s ~ %s)" % (len(table), min(table), max(table)))

    out_rows, matched, unmatched = [], 0, 0
    t0 = None
    with open(thermal_csv, encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            try:
                ts = datetime.fromisoformat(rec["timestamp"])
            except (ValueError, KeyError):
                continue
            if t0 is None:
                t0 = ts
            load = nearest(table, ts)
            if load:
                matched += 1
            else:
                unmatched += 1
            out_rows.append([
                ts.isoformat(sep=" "),
                round((ts - t0).total_seconds() / 60.0, 3),
                num(load, 1) if load else "",   # VOLTAGE(V)
                num(load, 2) if load else "",   # CURRENT(A)
                num(load, 3) if load else "",   # POWER(W)
                num(load, 5) if load else "",   # E_QUANTITY(Wh)
                num(load, 6) if load else "",   # E_CAPACITY(mAh)
                rec.get("ds18b20_c", ""),       # 셀 표면
                rec.get("ds_ambient_c", ""),    # 실온 (센서 1개만 쓴 예전 파일이면 빈칸)
                rec.get("delta_c", ""),         # 셀 - 실온
                rec.get("mlx5b_obj_c", ""),     # 비접촉 대상온도
                num(load, 9) if load else "",   # MOS_TEMP
                num(load, 10) if load else "",  # FAN_SPEED
            ])

    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "elapsed_min", "voltage_v", "current_a", "power_w",
                    "energy_wh", "capacity_mah", "ds_cell_c", "ds_ambient_c", "delta_c",
                    "mlx_object_c", "load_mos_temp_c", "load_fan_rpm"])
        w.writerows(out_rows)

    total = matched + unmatched
    print("온도 샘플 %d개 중 %d개 매칭 (%.1f%%)" % (total, matched, 100.0 * matched / total if total else 0))
    if unmatched:
        print("  미매칭 %d개 — 로드가 꺼져 있던 구간이면 정상이다" % unmatched)
    print("출력: %s  (%d행)" % (out_csv, len(out_rows)))


if __name__ == "__main__":
    main()
