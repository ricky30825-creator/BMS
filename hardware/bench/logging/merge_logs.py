"""ATORCH CL24 방전기 로그와 라즈베리파이 온도 로그를 타임스탬프로 병합한다.

방전기는 1초 간격, 온도 로거는 약 3.6초 간격이므로
온도 샘플 하나마다 가장 가까운 방전기 행을 붙인다(허용 오차 TOL_SEC).

사용법:
    python merge_logs.py
"""
import csv
import os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
LOAD_CSV = r"C:\Users\<USER>\Desktop\보조배터리데이터.csv"
OUT_CSV = os.path.join(HERE, "merged_discharge.csv")
TOL_SEC = 3  # 온도 샘플과 방전기 행의 최대 시각 차이

# (파일명, 구간 이름)
THERMAL_FILES = [
    ("discharge_20260808.csv", "1A_mlx_misaimed"),
    ("run_1A_baseline.csv", "1A"),
    ("run_2A.csv", "2A"),
    ("run_2.5A.csv", "2.5A"),
]


def load_discharger(path):
    """{초단위 datetime: 행} 형태로 방전기 로그를 읽는다.

    파일 앞 3줄은 ATORCH 헤더 배너이고 4번째 줄이 실제 컬럼명이다.
    """
    table = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for _ in range(4):  # 배너 3줄 + 컬럼명 1줄
            f.readline()
        for row in csv.reader(f):
            if len(row) < 11 or not row[0]:
                continue
            try:
                ts = datetime.strptime(row[0], "%Y-%m-%d_%H:%M:%S")
            except ValueError:
                continue
            table[ts] = row
    return table


def nearest(table, ts):
    """ts 로부터 ±TOL_SEC 안에서 가장 가까운 방전기 행."""
    from datetime import timedelta

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
    table = load_discharger(LOAD_CSV)
    print("방전기 로그: %d 행 (%s ~ %s)" % (len(table), min(table), max(table)))

    out_rows = []
    stats = []

    for fname, phase in THERMAL_FILES:
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            print("건너뜀 (없음): %s" % fname)
            continue

        matched = unmatched = 0
        with open(path, encoding="utf-8") as f:
            for rec in csv.DictReader(f):
                try:
                    ts = datetime.fromisoformat(rec["timestamp"])
                except (ValueError, KeyError):
                    continue
                load = nearest(table, ts)
                if load:
                    matched += 1
                else:
                    unmatched += 1
                out_rows.append(
                    [
                        ts.isoformat(sep=" "),
                        phase,
                        rec.get("elapsed_s", ""),
                        num(load, 1) if load else "",   # VOLTAGE(V)
                        num(load, 2) if load else "",   # CURRENT(A)
                        num(load, 3) if load else "",   # POWER(W)
                        num(load, 5) if load else "",   # E_QUANTITY(Wh)
                        num(load, 6) if load else "",   # E_CAPACITY(mAh)
                        rec.get("ds18b20_c", ""),
                        rec.get("mlx5b_obj_c", ""),
                        rec.get("mlx5b_amb_c", ""),
                        num(load, 9) if load else "",   # MOS_TEMP
                        num(load, 10) if load else "",  # FAN_SPEED
                    ]
                )
        stats.append((phase, matched, unmatched))

    out_rows.sort(key=lambda r: r[0])

    with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "timestamp",
                "phase",
                "elapsed_s",
                "voltage_v",
                "current_a",
                "power_w",
                "energy_wh",
                "capacity_mah",
                "ds18b20_c",
                "mlx_object_c",
                "mlx_ambient_c",
                "load_mos_temp_c",
                "load_fan_rpm",
            ]
        )
        w.writerows(out_rows)

    print("\n구간별 매칭:")
    for phase, m, u in stats:
        total = m + u
        rate = 100.0 * m / total if total else 0.0
        print("  %-16s 매칭 %4d / %4d  (%.1f%%)" % (phase, m, total, rate))

    print("\n출력: %s  (%d 행)" % (OUT_CSV, len(out_rows)))


if __name__ == "__main__":
    main()
