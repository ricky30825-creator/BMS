#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sensors_kafka_v2.py -- live sensor frames on the battery-raw-metrics contract.

    python3 ~/sensors_kafka_v2.py --dry-run
    python3 ~/sensors_kafka_v2.py --broker <LAN_IP>:19092

This replaces the v1 `battery-data` payload. Nothing here reads sensors: the
proven I2C/1-Wire code is imported from sensors_kafka.py so there is exactly
one implementation of it. v1 is kept because pipeline_replay still speaks it.

Why the defaults are what they are
----------------------------------
  * port 19092, not 9092. docker-compose.local.yml binds 9092 to 127.0.0.1
    only (the LOCALHOST listener, for processes on the PC). The Pi must use
    the LAN listener on 19092, which binds 0.0.0.0.
  * topic battery-raw-metrics, not battery-data. KAFKA_AUTO_CREATE_TOPICS_ENABLE
    is "false", so an unknown topic is rejected rather than created.
  * message key = device_id. KAFKA_PARTITION_KEY_RULES.rawMetrics == "device_id".
    Keying by anything else scatters one device across partitions and breaks
    per-device ordering.

The contract is enforced twice
------------------------------
The backend parses with a zod `.strict()` schema, so ONE unexpected key or one
wrong type rejects the whole frame -- and it does so on the server, where we
would only see it as silence. validate_frame() below mirrors those rules so a
mismatch fails here, loudly, with the field name. Keep it in sync with
backend/src/kafka.ts if the contract moves.

Mode 2 (power bank) invariants the backend enforces:
    temp_contact        must be null   ("mode 2 has no contact temperature sensor")
    temp_points.contact must be null
    pressure_raw        must be null
    acoustic_raw        must be null   (both modes -- sensor not in the build)
    temp_ir_surface     must EQUAL max(non-null temp_points.ir), by !== .
                        So round the points first, then take the max of the
                        rounded values. Rounding after the max can differ in
                        the last bit and every frame gets rejected.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sensors_kafka import (            # noqa: E402  -- proven sensor layer
    BUS, MLX_ADDRS, AMBIENT_ID, CELL_ID,
    CONFIG_WANT, CAL_WANT,
    REG_CONFIG, REG_CAL, REG_MFG, REG_DIE,
    ina_read_u16, ina_write_u16,
    read_ina, read_mlx, DsThread,
)

CONTRACT_VERSION = 1          # backend/src/kafka.ts KAFKA_CONTRACT_VERSION
RAW_TOPIC = "battery-raw-metrics"
DIAG_PHASES = {"P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "CAPACITY",
               "S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"}
FRAME_KEYS = {
    "version", "device_id", "mode", "timestamp", "voltage_v", "current_a",
    "power_w", "soc_pct", "temp_contact", "temp_ir_surface", "temp_points",
    "gas_raw", "pressure_raw", "acoustic_raw", "age_ms",
}
OPTIONAL_KEYS = {"diag_phase", "load_target_a", "temp_ambient"}


def utc_iso_z(ts):
    """ISO8601 UTC with a Z suffix and millisecond precision.

    zod uses .datetime({offset: false}) plus a refine that the string ends in
    "Z". isoformat() on an aware datetime gives "+00:00", which fails both.
    """
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return "%s.%03dZ" % (dt.strftime("%Y-%m-%dT%H:%M:%S"), dt.microsecond // 1000)


def _r(x, nd=4):
    return None if x is None else round(x, nd)


def build_frame(device_id, mode, ts, ina, mlx, ages, ambient=None):
    """Assemble one battery-raw-metrics frame. Returns a plain dict."""
    voltage = current = power = None
    if ina is not None:
        voltage, current, power = ina

    # Round first, then take the max -- see the module docstring.
    ir_points = [_r(mlx[a][0], 2) for a in MLX_ADDRS]
    present = [v for v in ir_points if v is not None]
    ir_surface = max(present) if present else None

    return {
        "version": CONTRACT_VERSION,
        "device_id": device_id,
        "mode": mode,
        "timestamp": utc_iso_z(ts),
        "voltage_v": _r(voltage, 4),
        "current_a": _r(current, 4),
        "power_w": _r(power, 4),
        # Coulomb counting needs a full-charge reference this process does not
        # have. null is a valid value; a fabricated number is not.
        "soc_pct": None,
        # Mode 2 has no contact probe. Mode 1 would carry three points here.
        "temp_contact": None,
        "temp_ir_surface": ir_surface,
        "temp_points": {"contact": None, "ir": ir_points},
        # Room temperature. Not a cell point, so it stays out of
        # temp_points and out of the max() that feeds temp_ir_surface.
        # Optional in the contract [2026-09-25]; null = not measured.
        "temp_ambient": _r(ambient, 2),
        "gas_raw": None,
        "pressure_raw": None,
        "acoustic_raw": None,
        "age_ms": ages,
    }


def validate_frame(f):
    """Mirror of the backend zod schema. Returns a list of problems."""
    errs = []
    keys = set(f)
    unknown = keys - FRAME_KEYS - OPTIONAL_KEYS
    missing = FRAME_KEYS - keys
    if unknown:
        errs.append("unknown key(s): %s  (.strict() rejects the whole frame)"
                    % ", ".join(sorted(unknown)))
    if missing:
        errs.append("missing key(s): %s" % ", ".join(sorted(missing)))
    if errs:
        return errs

    if f["version"] != CONTRACT_VERSION:
        errs.append("version must be the number %d" % CONTRACT_VERSION)
    if not isinstance(f["device_id"], str) or not f["device_id"]:
        errs.append("device_id must be a non-empty string")
    if f["mode"] not in (1, 2):
        errs.append("mode must be 1 or 2")

    t = f["timestamp"]
    if not isinstance(t, str) or not t.endswith("Z") or "+" in t:
        errs.append("timestamp must be ISO8601 UTC ending in Z, got %r" % t)

    ta = f.get("temp_ambient")
    if ta is not None and not isinstance(ta, (int, float)):
        errs.append("temp_ambient must be a finite number or null")

    for k in ("voltage_v", "current_a", "power_w", "temp_contact",
              "temp_ir_surface", "gas_raw", "pressure_raw", "acoustic_raw"):
        v = f[k]
        if v is not None and not isinstance(v, (int, float)):
            errs.append("%s must be a finite number or null" % k)

    soc = f["soc_pct"]
    if soc is not None and not (isinstance(soc, (int, float)) and 0 <= soc <= 100):
        errs.append("soc_pct must be null or 0..100")

    tp = f["temp_points"]
    if not isinstance(tp, dict) or set(tp) != {"contact", "ir"}:
        errs.append("temp_points must have exactly contact and ir")
    else:
        if tp["contact"] is not None and len(tp["contact"]) != 3:
            errs.append("temp_points.contact must be null or exactly 3 points")
        if not isinstance(tp["ir"], list) or len(tp["ir"]) < 1:
            errs.append("temp_points.ir needs at least one point")
        else:
            present = [v for v in tp["ir"] if v is not None]
            expected = max(present) if present else None
            if f["temp_ir_surface"] != expected:
                errs.append("temp_ir_surface (%r) must equal max(non-null ir) (%r)"
                            % (f["temp_ir_surface"], expected))

    age = f["age_ms"]
    if not isinstance(age, dict):
        errs.append("age_ms must be an object")
    else:
        for k, v in age.items():
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                errs.append("age_ms.%s must be a non-negative integer" % k)

    mode = f["mode"]
    if mode == 2:
        if f["temp_contact"] is not None:
            errs.append("mode 2 requires temp_contact = null")
        if isinstance(tp, dict) and tp.get("contact") is not None:
            errs.append("mode 2 requires temp_points.contact = null")
        if f["pressure_raw"] is not None:
            errs.append("mode 2 requires pressure_raw = null")
    elif mode == 1:
        if f["gas_raw"] is not None:
            errs.append("mode 1 requires gas_raw = null")
        if isinstance(tp, dict) and tp.get("contact") is None:
            errs.append("mode 1 requires three contact temperature points")
    if f["acoustic_raw"] is not None:
        errs.append("acoustic_raw must be null (sensor not in this build)")

    if "diag_phase" in f and f["diag_phase"] not in DIAG_PHASES:
        errs.append("diag_phase %r is not in the contract enum" % f["diag_phase"])
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", default="<LAN_IP>:19092",
                    help="Kafka bootstrap. The Pi uses the LAN listener (19092); "
                         "9092 is bound to the PC's loopback and is unreachable.")
    ap.add_argument("--topic", default=RAW_TOPIC)
    ap.add_argument("--device-id", default="rpi5-01",
                    help="Also the Kafka message key (partition rule).")
    ap.add_argument("--mode", type=int, default=2, choices=(1, 2))
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--duration", type=float, default=0.0)
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and print frames, do not connect to Kafka")
    ap.add_argument("--print-every", type=int, default=1)
    args = ap.parse_args()

    fd = os.open(BUS, os.O_RDWR)
    ina_write_u16(fd, REG_CONFIG, CONFIG_WANT)
    ina_write_u16(fd, REG_CAL, CAL_WANT)
    time.sleep(0.1)
    cfg, cal = ina_read_u16(fd, REG_CONFIG), ina_read_u16(fd, REG_CAL)
    mfg, die = ina_read_u16(fd, REG_MFG), ina_read_u16(fd, REG_DIE)

    bar = "=" * 78
    print(bar)
    print(" CellGuard edge producer v2   contract battery-raw-metrics v%d"
          % CONTRACT_VERSION)
    print(bar)
    print(" broker    : %s" % args.broker)
    print(" topic     : %s   key=%s" % (args.topic, args.device_id))
    print(" device_id : %s   mode=%d" % (args.device_id, args.mode))
    ok_ina = (cfg == CONFIG_WANT and cal == CAL_WANT
              and mfg == 0x5449 and die == 0x2260)
    print(" INA226    : CONFIG=0x%04X CAL=0x%04X MFG=0x%04X DIE=0x%04X  %s"
          % (cfg, cal, mfg, die, "OK" if ok_ina else "<< CHECK"))
    mlx0 = read_mlx(fd)
    for a in MLX_ADDRS:
        o = mlx0[a][0]
        print(" MLX 0x%02X  : %s" % (a, "OK  TOBJ=%.2f C" % o if o is not None
                                     else "<< NOT RESPONDING"))
    print(" DS        : cell=%s  ambient=%s" % (CELL_ID, AMBIENT_ID))
    print("             ambient -> temp_ambient (contract optional, 2026-09-25)")

    ds = DsThread()
    ds.start()

    producer = None
    if not args.dry_run:
        from kafka import KafkaProducer
        print(" connecting to Kafka ...")
        producer = KafkaProducer(
            bootstrap_servers=args.broker,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks=1, linger_ms=0, retries=3,
        )
        print(" connected.")
    else:
        print(" DRY RUN -- validating frames, not connecting")
    print(" stop      : Ctrl+C")
    print(bar)

    t0 = time.time()
    n = sent = rejected = 0
    try:
        while True:
            tick = time.time()
            t_ina = time.time()
            ina = read_ina(fd)
            t_mlx = time.time()
            mlx = read_mlx(fd)
            now = time.time()
            ages = {
                "voltage_v": int((now - t_ina) * 1000),
                "current_a": int((now - t_ina) * 1000),
                "temp_ir_surface": int((now - t_mlx) * 1000),
            }
            frame = build_frame(args.device_id, args.mode, now, ina, mlx, ages,
                                  ds.ambient)
            n += 1

            errs = validate_frame(frame)
            if errs:
                rejected += 1
                print("\n!! frame %d fails the contract -- NOT sent" % n)
                for e in errs:
                    print("   - %s" % e)
                print("   %s" % json.dumps(frame, ensure_ascii=False))
            else:
                if producer is not None:
                    producer.send(args.topic, key=args.device_id, value=frame)
                    sent += 1
                elif n % args.print_every == 0:
                    print(json.dumps(frame, ensure_ascii=False))

            if producer is not None and n % args.print_every == 0:
                print("%s  t+%-7.0f %s V %s A %s W | IR surf %s  amb(DS) %s -> %d"
                      % (datetime.fromtimestamp(now).strftime("%H:%M:%S"),
                         now - t0, frame["voltage_v"], frame["current_a"],
                         frame["power_w"], frame["temp_ir_surface"],
                         ds.ambient, sent))

            if args.duration and (now - t0) >= args.duration:
                print("\n-- duration reached --")
                break
            time.sleep(max(0.0, args.interval - (time.time() - tick)))
    except KeyboardInterrupt:
        print("\n-- interrupted --")
    finally:
        if producer is not None:
            producer.flush()
            producer.close()
        ds.stop()
        os.close(fd)
        print(bar)
        print(" frames %d   sent %d   contract-rejected %d   %.1f s"
              % (n, sent, rejected, time.time() - t0))
        print(bar)


if __name__ == "__main__":
    main()
