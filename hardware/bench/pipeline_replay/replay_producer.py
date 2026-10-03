#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""replay_producer.py — 이미 측정해 둔 run 을 Kafka 로 다시 흘려보낸다.

하드웨어를 켜지 않고도 실제 데이터로 Kafka → Consumer → PostgreSQL → 대시보드
전 구간을 돌릴 수 있다. 18 run · 176,533 표본이 대상이다.

    # 무엇이 실릴지 먼저 본다 (Kafka 없이)
    python replay_producer.py --dry-run

    # 60배속으로 전부 (10.9시간 run 이 11분에 끝난다)
    python replay_producer.py --broker 3.38.147.82:9092 --speed 60

    # 특정 run 만, 실시간 속도로
    python replay_producer.py --broker ... --speed 1 --runs 18650_b1_1A_20260831

    # 최대한 빠르게 벌크 적재
    python replay_producer.py --broker ... --speed 0 --every 5

메시지는 v1(7월 설계산출물) 5필드 계약을 그대로 유지하고 키를 덧붙인 형태다.
v1 Consumer 는 추가 키를 무시하므로 그대로 동작한다.

    {"timestamp": "...", "voltage": 5.02, "current": -0.99,
     "temperature": 31.35, "soc": 84.2,
     "run_id": "...", "elapsed_s": 1234.0, "source": "replay",
     "_ext": {...}}

run 메타데이터는 Kafka 가 아니라 runs_manifest.json 으로 나간다.
consumer_v2.py --manifest 로 읽어 runs 테이블에 upsert 한다.
"""
import argparse
import csv
import glob
import io
import json
import os
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)          # 라즈베리파이5테스트/

# DS18B20 두 채널이 뒤바뀌어 기록된 마지막 시점.
# 2026-08-26 15:44 에 thermal_log_*.py 의 CELL_ID/AMBIENT_ID 상수를 맞바꿨다.
# 그 이전 run 은 CSV 의 ds_cell_c 가 실제로는 공기 중 값이다.
DS_FIX_TIME = datetime(2026, 8, 26, 15, 44)

# 문서화된 run 결과. collapsed = CP 되먹임 붕괴 (이상탐지 양성 라벨)
RESULTS = {
    "PB20000_c8_14W_20260826": ("collapsed", "포트 정격 3.83A 도달 후 2.7h 붕괴"),
    "PB10000_c2_10W_20260826": ("collapsed", "정격의 111% — 36분 만에 붕괴"),
    "PB5000_c3_10W_20260826":  ("collapsed", "정격의 141% — 2.5분 만에 붕괴"),
    "PB20000_c4_14W_20260825": ("aborted",   "시험 중단, c8 로 재실행"),
    "18650_b1_1A_20260831": ("completed",
        "이 run 이전에 131.16 mAh 가 이미 빠져 있었다. "
        "완충(4.2035V) 기준 총 용량은 2362.0 mAh 이고 여기 적힌 값은 이 run 분만이다."),
}

BATTERY_OF = {"18650_b1": "BAT01", "18650_b2": "BAT02", "18650_b3": "BAT03"}

# MLX90614 스턱 리드 방어.
#   raw 가 0x7FFF 이면 382.19 C 가 나오는데, 에러 플래그는 0x8000 이라
#   `raw & 0x8000` 검사를 한 비트 차이로 빠져나간다. 실제로 PB20000_c4 에서
#   6 건이 이 값으로 기록됐고, max(5a,5b) 규칙이 그것을 골라 올렸다.
T_MIN, T_MAX = -40.0, 150.0        # 배터리 시험에서 물리적으로 가능한 범위


def sane_temp(v):
    """범위 밖이면 값이 아니라 결측으로 본다."""
    return v if (v is not None and T_MIN <= v <= T_MAX) else None


def parse_run(folder):
    """폴더명에서 run 메타데이터를 뽑는다. 예: PB20000_c1_10W_20260826"""
    parts = folder.split("_")
    if folder.startswith("18650"):
        tag, setpoint = parts[1], parts[2]
        battery = BATTERY_OF.get("18650_" + tag, "BAT??")
        cell_type = "cell"
    else:
        pack, tag, setpoint = parts[0], parts[1], parts[2]
        battery = "PB-" + pack[2:]
        cell_type = "pack"
    mode = "CP" if tag.startswith("c") else "CC"
    return battery, cell_type, mode, setpoint, tag


def load_run(folder):
    """_soc.csv 를 읽어 (메타, 행목록) 을 돌려준다."""
    d = os.path.join(BASE, folder)
    hits = glob.glob(os.path.join(d, "*_soc.csv"))
    if not hits:
        return None, None
    rows = []
    with io.open(hits[0], encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    if not rows:
        return None, None

    t0 = datetime.fromisoformat(rows[0]["timestamp"])
    t1 = datetime.fromisoformat(rows[-1]["timestamp"])
    swapped = t0 < DS_FIX_TIME
    battery, cell_type, mode, setpoint, tag = parse_run(folder)
    result, note = RESULTS.get(folder, ("completed", ""))

    def fnum(row, key):
        try:
            return float(row[key])
        except (KeyError, ValueError, TypeError):
            return None

    dur_h = (t1 - t0).total_seconds() / 3600.0

    # 실제로 부하가 걸린 시간 — 기록 공백(>5초)은 빼고 센다.
    # duration_h 는 공백을 포함하므로 r3b 처럼 중간에 끊긴 run 에서 2배 넘게 벌어진다.
    loaded_s = 0.0
    prev_el = None
    for r in rows:
        el = fnum(r, "elapsed_s")
        if el is None:
            continue
        if prev_el is not None and 0 < el - prev_el <= 5.0:
            loaded_s += el - prev_el
        prev_el = el
    cap = fnum(rows[-1], "dod_ah")
    ene = fnum(rows[-1], "dod_wh")
    cur = [abs(fnum(r, "current_a")) for r in rows if fnum(r, "current_a") is not None]
    pwr = [abs(fnum(r, "power_w")) for r in rows if fnum(r, "power_w") is not None]

    meta = {
        "run_id": folder,
        "battery": battery,
        "cell_type": cell_type,
        "mode": mode,
        "setpoint": setpoint,
        "started_at": t0.isoformat(),
        "ended_at": t1.isoformat(),
        "duration_h": round(dur_h, 4),
        "loaded_h": round(loaded_s / 3600.0, 4),
        "capacity_mah": round(cap * 1000, 1) if cap else None,
        "energy_wh": round(ene, 4) if ene else None,
        "mean_current_a": round(sum(cur) / len(cur), 4) if cur else None,
        "mean_power_w": round(sum(pwr) / len(pwr), 4) if pwr else None,
        "result": result,
        "ds_swapped": swapped,
        "note": note,
        "sample_count": len(rows),
    }
    return meta, rows


def to_record(row, meta):
    """CSV 한 줄 → Kafka 메시지 한 건."""
    def f(key):
        try:
            v = row[key]
            return float(v) if v not in ("", None) else None
        except (KeyError, ValueError, TypeError):
            return None

    ds_cell, ds_amb = f("ds_cell_c"), f("ds_ambient_c")
    if meta["ds_swapped"]:
        # 원본이 반대로 기록된 run — 여기서 되돌린다. DB 는 항상 정방향이 된다.
        ds_cell, ds_amb = ds_amb, ds_cell

    a = sane_temp(f("mlx5a_obj_c"))
    b = sane_temp(f("mlx5b_obj_c"))
    ds_cell, ds_amb = sane_temp(ds_cell), sane_temp(ds_amb)
    hot = [x for x in (a, b) if x is not None]
    temperature = max(hot) if hot else None   # 평균이 아니라 핫스팟

    return {
        # ── v1 5필드 계약 ──
        "timestamp": row["timestamp"],
        "voltage": f("voltage_v"),
        "current": f("current_a"),
        "temperature": round(temperature, 3) if temperature is not None else None,
        "soc": f("soc_pct"),
        # ── v2 추가 ──
        "run_id": meta["run_id"],
        "elapsed_s": f("elapsed_s"),
        "source": "replay",
        "_ext": {
            "power_w": f("power_w"),
            "ds_cell_c": ds_cell,
            "ds_ambient_c": ds_amb,
            "mlx5a_obj_c": a,
            "mlx5b_obj_c": b,
            "mlx5a_amb_c": f("mlx5a_amb_c"),
            "mlx5b_amb_c": f("mlx5b_amb_c"),
            "dod_ah": f("dod_ah"),
            "dod_wh": f("dod_wh"),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", default=None, help="EC2 퍼블릭IP:9092")
    ap.add_argument("--topic", default="battery-data")
    ap.add_argument("--key", default="cell_A", help="파티션 키 (v1 계약 기본값)")
    ap.add_argument("--speed", type=float, default=60.0,
                    help="배속. 1=실시간, 0=대기 없이 최대 속도 (기본 60)")
    ap.add_argument("--every", type=int, default=1, help="N행마다 1건만 전송")
    ap.add_argument("--runs", nargs="*", default=None, help="특정 run 만")
    ap.add_argument("--dry-run", action="store_true", help="Kafka 없이 미리보기")
    ap.add_argument("--manifest", default=os.path.join(HERE, "runs_manifest.json"))
    args = ap.parse_args()

    folders = sorted(d for d in os.listdir(BASE)
                     if os.path.isdir(os.path.join(BASE, d))
                     and glob.glob(os.path.join(BASE, d, "*_soc.csv")))
    if args.runs:
        folders = [d for d in folders if d in args.runs]
        if not folders:
            sys.exit("해당 run 이 없다: %s" % args.runs)

    metas, data = [], []
    for d in folders:
        m, rows = load_run(d)
        if m is None:
            print("  ! %s — _soc.csv 없음, 건너뜀" % d)
            continue
        metas.append(m)
        data.append((m, rows))
    metas.sort(key=lambda m: m["started_at"])
    data.sort(key=lambda x: x[0]["started_at"])

    # 매니페스트는 덮어쓰지 않고 병합한다.
    # --runs 로 한 run 만 돌렸을 때 통째로 덮어쓰면 나머지 17 run 의 메타데이터가
    # 사라지고, 그 상태로 consumer 를 돌리면 runs 테이블이 비어 적재가 통째로 막힌다.
    merged = {}
    if os.path.exists(args.manifest):
        try:
            with io.open(args.manifest, encoding="utf-8") as f:
                for m in json.load(f):
                    merged[m["run_id"]] = m
        except (ValueError, KeyError, TypeError):
            merged = {}          # 깨진 파일이면 이번 것만 남긴다
    for m in metas:
        merged[m["run_id"]] = m
    out = sorted(merged.values(), key=lambda m: m["started_at"])
    with io.open(args.manifest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total = sum(len(r) for _, r in data)
    sending = sum(len(r[::args.every]) for _, r in data)
    print("=" * 78)
    print(" REPLAY  —  run %d개 · 원본 %d행 · 전송 %d건 (every=%d)"
          % (len(data), total, sending, args.every))
    print(" 토픽 %s   배속 %s   매니페스트 %s"
          % (args.topic, "최대" if args.speed == 0 else "x%g" % args.speed,
             os.path.basename(args.manifest)))
    print("=" * 78)
    print(" %-28s %-10s %-4s %-6s %-11s %8s %s"
          % ("run_id", "battery", "mode", "설정", "결과", "행", "DS"))
    print("-" * 78)
    for m in metas:
        print(" %-28s %-10s %-4s %-6s %-11s %8d %s"
              % (m["run_id"], m["battery"], m["mode"], m["setpoint"],
                 m["result"], m["sample_count"], "되돌림" if m["ds_swapped"] else "-"))
    print("-" * 78)

    if args.dry_run:
        m, rows = data[0]
        print("\n첫 메시지 예시 (%s):" % m["run_id"])
        print(json.dumps(to_record(rows[0], m), ensure_ascii=False, indent=2))
        print("\n--dry-run 이라 전송하지 않았다.")
        return

    if not args.broker:
        sys.exit("--broker 를 지정하거나 --dry-run 을 쓸 것")

    from kafka import KafkaProducer
    producer = KafkaProducer(
        bootstrap_servers=args.broker,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
        acks="all", retries=5, linger_ms=50,
    )
    key = args.key.encode("utf-8")

    sent = 0
    t_start = time.time()
    try:
        for m, rows in data:
            sub = rows[::args.every]
            print("\n▶ %s  (%d건)" % (m["run_id"], len(sub)))
            prev_el = None
            for i, row in enumerate(sub):
                rec = to_record(row, m)
                el = rec["elapsed_s"] or 0.0
                if args.speed > 0 and prev_el is not None:
                    wait = (el - prev_el) / args.speed
                    if 0 < wait < 30:
                        time.sleep(wait)
                prev_el = el
                producer.send(args.topic, key=key, value=rec)
                sent += 1
                if (i + 1) % 500 == 0:
                    producer.flush()
                    print("   %6d/%d  t+%.0fs  %.4fV %+.4fA %s℃"
                          % (i + 1, len(sub), el, rec["voltage"] or 0,
                             rec["current"] or 0, rec["temperature"]))
            producer.flush()
            print("   완료 %d건" % len(sub))
    except KeyboardInterrupt:
        print("\n-- 중단 --")
    finally:
        producer.flush()
        producer.close()
        print("\n총 %d건 전송, %.1f초" % (sent, time.time() - t_start))
        print("다음: python consumer_v2.py --broker %s --manifest %s"
              % (args.broker, os.path.basename(args.manifest)))


if __name__ == "__main__":
    main()
