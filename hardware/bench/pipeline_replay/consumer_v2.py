#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""consumer_v2.py — Kafka(battery-data) → PostgreSQL 적재.

v1(pc_consumer/consumer.py) 대비 바뀐 것
  1) runs 테이블을 매니페스트에서 먼저 upsert (run 경계가 DB 에 남는다)
  2) run_id / elapsed_s / source 를 함께 적재
  3) ON CONFLICT DO NOTHING — 리플레이를 다시 돌려도 중복이 안 쌓인다
  4) 배치 커밋 — v1 의 건별 commit 은 17만 건에 몇 시간이 걸린다.
     --batch 1 로 주면 v1 과 같은 건별 커밋이 된다.

    python consumer_v2.py --broker 3.38.147.82:9092 --manifest runs_manifest.json
    python consumer_v2.py --broker ... --from-beginning --idle 30

사전에 schema_v2.sql 을 한 번 실행해 두어야 한다.
    psql -U battery_admin -d battery_ctrl_db -f schema_v2.sql
"""
import argparse
import datetime
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

RUN_UPSERT = """
INSERT INTO runs (run_id, battery, cell_type, mode, setpoint, started_at, ended_at,
                  duration_h, loaded_h, capacity_mah, energy_wh, mean_current_a, mean_power_w,
                  result, ds_swapped, note)
VALUES (%(run_id)s, %(battery)s, %(cell_type)s, %(mode)s, %(setpoint)s,
        %(started_at)s, %(ended_at)s, %(duration_h)s, %(loaded_h)s, %(capacity_mah)s,
        %(energy_wh)s, %(mean_current_a)s, %(mean_power_w)s,
        %(result)s, %(ds_swapped)s, %(note)s)
ON CONFLICT (run_id) DO UPDATE SET
  ended_at = EXCLUDED.ended_at, duration_h = EXCLUDED.duration_h,
  loaded_h = EXCLUDED.loaded_h,
  capacity_mah = EXCLUDED.capacity_mah, energy_wh = EXCLUDED.energy_wh,
  mean_current_a = EXCLUDED.mean_current_a, mean_power_w = EXCLUDED.mean_power_w,
  result = EXCLUDED.result, ds_swapped = EXCLUDED.ds_swapped, note = EXCLUDED.note;
"""

LOG_INSERT = """
INSERT INTO battery_logs
  (run_id, timestamp, elapsed_s, voltage, current, temperature, soc, source)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (run_id, timestamp) DO NOTHING
RETURNING log_id;
"""

EXT_INSERT = """
INSERT INTO battery_logs_ext
  (log_id, power_w, ds_cell_c, ds_ambient_c, mlx5a_obj_c, mlx5b_obj_c,
   mlx5a_amb_c, mlx5b_amb_c, dod_ah, dod_wh)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (log_id) DO NOTHING;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", required=True)
    ap.add_argument("--topic", default="battery-data")
    ap.add_argument("--group", default="sensor-metric-writer-v2")
    ap.add_argument("--manifest", default=os.path.join(HERE, "runs_manifest.json"))
    ap.add_argument("--from-beginning", action="store_true",
                    help="토픽 처음부터 다시 읽는다 (리플레이 적재용)")
    ap.add_argument("--idle", type=float, default=30.0,
                    help="이 시간(초) 동안 메시지가 없으면 종료. 0=계속 대기")
    ap.add_argument("--batch", type=int, default=500, help="커밋 묶음 크기 (1=건별)")
    ap.add_argument("--no-ext", action="store_true", help="확장 테이블 적재 생략")
    ap.add_argument("--live-run", metavar="RUN_ID",
                    help="라이브 수집용 run 행을 만들어 둔다. battery_logs 는 runs 를 "
                         "FK 로 참조하므로 이 행이 없으면 파이가 보낸 표본이 전부 막힌다. "
                         "매니페스트에 없는 run_id 라 별도로 넣어준다")
    ap.add_argument("--pg-host", default="localhost")
    ap.add_argument("--pg-port", type=int, default=5433,
                    help="Docker 스택은 5433 (네이티브 5432 와 충돌 방지)")
    ap.add_argument("--pg-db", default="battery_ctrl_db")
    ap.add_argument("--pg-user", default="battery_admin")
    ap.add_argument("--pg-password",
                    default=os.environ.get("PG_PASSWORD", "cellguard_dev"))
    args = ap.parse_args()

    import psycopg2
    from kafka import KafkaConsumer

    conn = psycopg2.connect(host=args.pg_host, port=args.pg_port,
                            dbname=args.pg_db, user=args.pg_user,
                            password=args.pg_password)
    cur = conn.cursor()

    # ── 1. run 메타데이터 먼저 ────────────────────────────────────────
    if os.path.exists(args.manifest):
        with io.open(args.manifest, encoding="utf-8") as f:
            metas = json.load(f)
        for m in metas:
            m.pop("sample_count", None)
            cur.execute(RUN_UPSERT, m)
        conn.commit()
        print("runs 테이블: %d개 upsert" % len(metas))
    else:
        print("!! 매니페스트가 없다: %s" % args.manifest)
        print("   run 행이 없으면 battery_logs 의 FK 제약에 걸린다.")
        sys.exit(1)

    # ── 1-b. 라이브 run ───────────────────────────────────────────────
    # 파이가 실시간으로 보내는 표본은 매니페스트에 없는 run_id 를 쓴다.
    # result='live' 는 completed/collapsed/aborted 와 일부러 구분한 값이다 —
    # 진행 중이라 결과가 없고, v_collapsed_runs 같은 라벨 뷰에 섞이면 안 된다.
    # 요약 통계 칸(capacity_mah 등)은 run 이 끝나야 나오므로 NULL 로 둔다.
    if args.live_run:
        _now = datetime.datetime.now()
        cur.execute(RUN_UPSERT, {
            "run_id": args.live_run, "battery": "LIVE", "cell_type": "live",
            "mode": "LIVE", "setpoint": "-",
            "started_at": _now, "ended_at": _now,
            "duration_h": None, "loaded_h": None, "capacity_mah": None,
            "energy_wh": None, "mean_current_a": None, "mean_power_w": None,
            "result": "live", "ds_swapped": False,
            "note": "라즈베리파이 실시간 수집 (sensors_kafka.py). 요약값은 산출하지 않는다.",
        })
        conn.commit()
        print("라이브 run 준비: %s" % args.live_run)

    # ── 2. 스트림 적재 ────────────────────────────────────────────────
    consumer = KafkaConsumer(
        args.topic,
        bootstrap_servers=args.broker,
        group_id=args.group,
        auto_offset_reset="earliest" if args.from_beginning else "latest",
        enable_auto_commit=True,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        consumer_timeout_ms=int(args.idle * 1000) if args.idle else float("inf"),
    )
    print("구독 시작 — topic=%s  offset=%s  batch=%d"
          % (args.topic, "earliest" if args.from_beginning else "latest", args.batch))

    n = skipped = 0
    pending = 0
    t0 = time.time()
    per_run = {}
    try:
        for msg in consumer:
            r = msg.value
            if r.get("voltage") is None or r.get("current") is None:
                skipped += 1
                continue
            def sane(v):
                return v if (v is not None and -40.0 <= v <= 150.0) else None

            cur.execute(LOG_INSERT, (
                r.get("run_id"), r["timestamp"], r.get("elapsed_s"),
                r["voltage"], r["current"], sane(r.get("temperature")),
                r.get("soc"), r.get("source", "live"),
            ))
            got = cur.fetchone()
            if got is None:            # 이미 있는 (run_id, timestamp) — 중복
                skipped += 1
                continue
            log_id = got[0]
            e = r.get("_ext") or {}
            if not args.no_ext and e:
                cur.execute(EXT_INSERT, (
                    log_id, e.get("power_w"), e.get("ds_cell_c"), e.get("ds_ambient_c"),
                    sane(e.get("mlx5a_obj_c")), sane(e.get("mlx5b_obj_c")),
                    e.get("mlx5a_amb_c"), e.get("mlx5b_amb_c"),
                    e.get("dod_ah"), e.get("dod_wh"),
                ))
            n += 1
            pending += 1
            per_run[r.get("run_id")] = per_run.get(r.get("run_id"), 0) + 1
            if pending >= args.batch:
                conn.commit()
                pending = 0
                print("  %7d건  (%.0f건/초)  최근 run=%s"
                      % (n, n / max(1e-6, time.time() - t0), r.get("run_id")))
    except KeyboardInterrupt:
        print("\n-- 중단 --")
    finally:
        conn.commit()
        cur.close()
        conn.close()
        consumer.close()
        el = time.time() - t0
        print("\n" + "=" * 60)
        print(" 적재 %d건 · 건너뜀 %d건 · %.1f초 (%.0f건/초)"
              % (n, skipped, el, n / max(1e-6, el)))
        for rid, c in sorted(per_run.items()):
            print("   %-30s %7d" % (rid, c))
        print("=" * 60)


if __name__ == "__main__":
    main()
