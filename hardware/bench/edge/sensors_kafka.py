#!/usr/bin/env python3
# ASCII only (source stays ASCII for pipe-safety; runtime output may be Korean).
"""sensors_kafka.py -- live sensor -> Kafka producer for the CellGuard demo.

    python3 ~/sensors_kafka.py --broker <LAN_IP>:9092
    python3 ~/sensors_kafka.py --broker <LAN_IP>:9092 --run-id LIVE_DEMO --interval 1.0
    python3 ~/sensors_kafka.py --dry-run            # no Kafka, just print

Reads the same six channels the verified loggers read, using the SAME register
settings and the SAME sanity filters, and publishes one message per interval to
the `battery-data` topic in the CONTRACT.md v1 shape with source="live".

Sensor code is lifted verbatim from the proven scripts so the live path and the
recorded runs cannot drift apart:
    INA226   <- ina_log.py       (CONFIG 0x4527, CAL 0x0A00, R010, discharge = -)
    MLX90614 <- mlx_fast_log.py  (mlx_sane(), temperature = max of the two IR)
    DS18B20  <- thermal_log_bulk.py (w1_slave sysfs, CELL_ID / AMBIENT_ID)

DS18B20 needs 750 ms per conversion, which does not fit a 1 s tick alongside
everything else, so it runs on its own thread and the main loop publishes the
most recent reading. INA226 and MLX are read inline -- they are sub-millisecond.

Pure ctypes + fcntl for I2C -- no smbus2 required.
"""
import argparse
import ctypes
import fcntl
import json
import os
import threading
import time
from datetime import datetime

# == I2C plumbing (from ina_log.py / mlx_fast_log.py) ======================
BUS = "/dev/i2c-1"
I2C_RDWR = 0x0707
I2C_M_RD = 0x0001


class _Msg(ctypes.Structure):
    _fields_ = [("addr", ctypes.c_uint16), ("flags", ctypes.c_uint16),
                ("len", ctypes.c_uint16), ("buf", ctypes.POINTER(ctypes.c_uint8))]


class _Data(ctypes.Structure):
    _fields_ = [("msgs", ctypes.POINTER(_Msg)), ("nmsgs", ctypes.c_uint32)]


def _msg(addr, flags, buf):
    return _Msg(addr=addr, flags=flags, len=len(buf),
                buf=ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint8)))


def _xfer(fd, msgs):
    arr = (_Msg * len(msgs))(*msgs)
    fcntl.ioctl(fd, I2C_RDWR, _Data(msgs=arr, nmsgs=len(msgs)))


# == INA226 (from ina_log.py) =============================================
INA_ADDR = 0x40
REG_CONFIG, REG_SHUNT, REG_BUS, REG_POWER, REG_CURRENT, REG_CAL = (
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05)
REG_MASK, REG_MFG, REG_DIE = 0x06, 0xFE, 0xFF

CONFIG_WANT = 0x4527      # AVG=16, VBUSCT/VSHCT = 1.1 ms, continuous shunt+bus
CAL_WANT = 0x0A00         # R010 shunt, Current_LSB = 0.0002 A
CURRENT_LSB = 0.0002
POWER_LSB = CURRENT_LSB * 25.0
BUS_LSB_V = 1.25e-3


def ina_read_u16(fd, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 2)()
    _xfer(fd, [_msg(INA_ADDR, 0, w), _msg(INA_ADDR, I2C_M_RD, r)])
    return (r[0] << 8) | r[1]


def ina_write_u16(fd, reg, val):
    w = (ctypes.c_uint8 * 3)(reg, (val >> 8) & 0xFF, val & 0xFF)
    _xfer(fd, [_msg(INA_ADDR, 0, w)])


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def read_ina(fd):
    """(voltage_v, current_a, power_w) or None. Discharge is negative."""
    bus_r = cur_r = pw_r = None
    for attempt in range(4):
        try:
            bus_r = ina_read_u16(fd, REG_BUS)
            cur_r = s16(ina_read_u16(fd, REG_CURRENT))
            pw_r = ina_read_u16(fd, REG_POWER)
            break
        except OSError:
            bus_r = None
            if attempt == 3:
                return None
            time.sleep(0.02)
    if bus_r is None:
        return None
    voltage = bus_r * BUS_LSB_V
    current = cur_r * CURRENT_LSB
    power = pw_r * POWER_LSB
    if power > 0 and current < 0:
        power = -power        # POWER register is unsigned; follow the current sign
    return voltage, current, power


# == MLX90614 (from mlx_fast_log.py) ======================================
MLX_ADDRS = [0x5A, 0x5B]
REG_TA, REG_TOBJ = 0x06, 0x07
MLX_T_MIN, MLX_T_MAX = -40.0, 150.0


def mlx_sane(raw):
    """raw 16-bit -> Celsius, or None when the value cannot be trusted.

    0x7FFF is the stuck read that yields 382.19 C. The error flag is 0x8000, so
    a plain `raw & 0x8000` test misses it by one bit -- see CONTRACT.md item 5.
    """
    if raw & 0x8000 or raw == 0x7FFF:
        return None
    v = raw * 0.02 - 273.15
    return v if MLX_T_MIN <= v <= MLX_T_MAX else None


def mlx_read_reg(fd, addr, reg):
    w = (ctypes.c_uint8 * 1)(reg)
    r = (ctypes.c_uint8 * 3)()
    _xfer(fd, [_msg(addr, 0, w), _msg(addr, I2C_M_RD, r)])
    return mlx_sane(r[0] | (r[1] << 8))


def read_mlx(fd):
    """{0x5A: (obj, amb), 0x5B: (obj, amb)} with None for unreadable channels."""
    out = {}
    for a in MLX_ADDRS:
        try:
            out[a] = (mlx_read_reg(fd, a, REG_TOBJ), mlx_read_reg(fd, a, REG_TA))
        except OSError:
            out[a] = (None, None)
    return out


# == DS18B20 (from thermal_log_bulk.py) ===================================
W1_DIR = "/sys/bus/w1/devices"
# 2026-08-26: the two probes were swapped relative to the docs. The one that
# cooled when the load was cut is the surface probe -- that is 2c2c.
# 2026-09-04: ambient probe id changed 28-062565206490 -> 28-0625657fe542
#
# 2026-09-04, DEMO ONLY -- 28-0625657fe542 enumerates on the bus but returns
# t=85000, the power-on default, so its VCC is not connected. Rather than stop
# for a wiring fix, the one probe that reads is used as the room reference:
# nothing is under load here, so a "cell surface" reading would be room
# temperature anyway. The heat signal comes from the two IR sensors, which is
# what this demo actually shows.
#
# !! This remap lives in sensors_kafka.py alone. The discharge loggers
# (thermal_log_bulk.py / thermal_log_alarm.py / tempguard.py) keep the original
# mapping, so a real run is unaffected -- but fix the wiring before one:
# tempguard's DS cutoff needs a probe that is actually on the cell.
CELL_ID = None                    # no surface probe in this configuration
AMBIENT_ID = "28-0625650a2c2c"    # the probe that reads; used as room temp


def read_w1_slave(dev_id):
    """Celsius, or None. t=85000 is the power-on default, i.e. a failed read."""
    p = os.path.join(W1_DIR, dev_id, "w1_slave")
    try:
        with open(p) as fh:
            txt = fh.read()
    except (IOError, OSError):
        return None
    if "YES" not in txt or "t=" not in txt:
        return None
    try:
        milli = int(txt.rsplit("t=", 1)[1].strip())
    except ValueError:
        return None
    if milli == 85000:            # power-on default -- VCC is not reaching it
        return None
    return milli / 1000.0


class DsThread(threading.Thread):
    """DS18B20 conversion takes 750 ms per probe, so it gets its own thread.

    The main loop publishes whatever this last produced rather than blocking on
    a conversion it cannot fit inside a 1 s tick.
    """

    daemon = True

    def __init__(self):
        threading.Thread.__init__(self)
        self.cell = None
        self.ambient = None
        self.reads = 0
        self._stop = threading.Event()

    def run(self):
        while not self._stop.is_set():
            c = read_w1_slave(CELL_ID) if CELL_ID else None
            a = read_w1_slave(AMBIENT_ID) if AMBIENT_ID else None
            self.cell, self.ambient = c, a
            self.reads += 1
            self._stop.wait(0.05)

    def stop(self):
        self._stop.set()


def _r2(x):
    return None if x is None else round(x, 2)


def _f(x):
    return "  --  " if x is None else "%6.2f" % x


# == main =================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", default="<LAN_IP>:9092",
                    help="Kafka bootstrap server (the PC running docker compose)")
    ap.add_argument("--topic", default="battery-data")
    ap.add_argument("--run-id", default="LIVE_DEMO",
                    help="must exist in the runs table (consumer --live-run creates it)")
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--duration", type=float, default=0.0,
                    help="stop after this many seconds (0 = until Ctrl+C)")
    ap.add_argument("--dry-run", action="store_true",
                    help="read sensors and print, but do not connect to Kafka")
    args = ap.parse_args()

    fd = os.open(BUS, os.O_RDWR)
    ina_write_u16(fd, REG_CONFIG, CONFIG_WANT)
    ina_write_u16(fd, REG_CAL, CAL_WANT)
    time.sleep(0.1)
    cfg, cal = ina_read_u16(fd, REG_CONFIG), ina_read_u16(fd, REG_CAL)
    mfg, die = ina_read_u16(fd, REG_MFG), ina_read_u16(fd, REG_DIE)

    bar = "=" * 78
    print(bar)
    print(" CellGuard live producer   sensor -> Kafka   (%.2f s)" % args.interval)
    print(bar)
    print(" broker  : %s   topic=%s" % (args.broker, args.topic))
    print(" run_id  : %s   source=live" % args.run_id)
    ok_ina = (cfg == CONFIG_WANT and cal == CAL_WANT
              and mfg == 0x5449 and die == 0x2260)
    print(" INA226  : CONFIG=0x%04X CAL=0x%04X MFG=0x%04X DIE=0x%04X  %s"
          % (cfg, cal, mfg, die, "OK" if ok_ina else "<< CHECK"))

    mlx0 = read_mlx(fd)
    for a in MLX_ADDRS:
        o = mlx0[a][0]
        print(" MLX 0x%02X: %s" % (a, "OK  TOBJ=%.2f C" % o if o is not None
                                   else "<< NOT RESPONDING"))

    ds = DsThread()
    ds.start()
    # Two probes at 750 ms each, so a full sweep is ~1.5 s plus sysfs overhead.
    # Wait for the values rather than a fixed sleep -- a banner that says
    # "NO READ" for probes that are in fact fine is the kind of thing that gets
    # believed. Give up after 5 s and report honestly.
    _t = time.time()
    while time.time() - _t < 5.0:
        pending = [(CELL_ID, ds.cell), (AMBIENT_ID, ds.ambient)]
        if all(v is not None for pid, v in pending if pid):
            break
        time.sleep(0.1)
    if CELL_ID:
        print(" DS cell : %s  %s"
              % (CELL_ID, "OK  %.2f C" % ds.cell if ds.cell is not None
                 else "<< NO READ"))
    else:
        print(" DS cell : (none) -- surface probe not in use, see CELL_ID note")
    print(" DS amb  : %s  %s"
          % (AMBIENT_ID, "OK  %.2f C" % ds.ambient if ds.ambient is not None
             else "<< NO READ"))

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
        print(" DRY RUN -- not connecting to Kafka")
    print(" stop    : Ctrl+C")
    print(bar)

    t0 = time.time()
    n = sent = 0
    dod_ah = dod_wh = 0.0
    t_prev = t0
    try:
        while True:
            tick = t0 + n * args.interval
            now = time.time()
            if tick > now:
                time.sleep(tick - now)
            n += 1

            t = time.time()
            ina = read_ina(fd)
            mlx = read_mlx(fd)
            if ina is None:
                print("   [INA226 read failed x4 -- skipping sample %d]" % n)
                continue
            voltage, current, power = ina

            # Depth of discharge, rectangle integration; at 1 Hz the difference
            # from a trapezoid rule is far below the sensor noise.
            dt_h = (t - t_prev) / 3600.0
            t_prev = t
            dod_ah += abs(current) * dt_h
            dod_wh += abs(power) * dt_h

            objs = [mlx[a][0] for a in MLX_ADDRS if mlx[a][0] is not None]
            # temperature is max(), never the mean -- one IR is usually aimed off
            # target and reads room temperature, which a mean would average in.
            surface = max(objs) if objs else None

            rec = {
                "timestamp": datetime.fromtimestamp(t).isoformat(
                    timespec="milliseconds"),
                "voltage": round(voltage, 4),
                "current": round(current, 4),
                "temperature": None if surface is None else round(surface, 2),
                "soc": None,        # coulomb counting needs the run total; live has none
                "run_id": args.run_id,
                "elapsed_s": round(t - t0, 3),
                "source": "live",
                "_ext": {
                    "power_w": round(power, 4),
                    "ds_cell_c": ds.cell,
                    "ds_ambient_c": ds.ambient,
                    "mlx5a_obj_c": _r2(mlx[0x5A][0]), "mlx5a_amb_c": _r2(mlx[0x5A][1]),
                    "mlx5b_obj_c": _r2(mlx[0x5B][0]), "mlx5b_amb_c": _r2(mlx[0x5B][1]),
                    "dod_ah": round(dod_ah, 5), "dod_wh": round(dod_wh, 5),
                },
            }

            if producer is not None:
                producer.send(args.topic, key="cell_A", value=rec)
                sent += 1

            print("%s  t+%-7.0f %7.4f V %+8.4f A %+7.3f W | IR %s/%s surf %s"
                  "  DS %s/%s  -> %d"
                  % (datetime.fromtimestamp(t).strftime("%H:%M:%S"), t - t0,
                     voltage, current, power,
                     _f(mlx[0x5A][0]), _f(mlx[0x5B][0]), _f(surface),
                     _f(ds.cell), _f(ds.ambient), sent))

            if args.duration and (t - t0) >= args.duration:
                print("\n-- duration reached --")
                break
    except KeyboardInterrupt:
        print("\n-- interrupted --")
    finally:
        if producer is not None:
            producer.flush()
            producer.close()
        ds.stop()
        os.close(fd)
        el = time.time() - t0
        print("\n" + bar)
        print(" samples %d - sent %d - %.1f s  (DS conversions %d)"
              % (n, sent, el, ds.reads))
        print(bar)


if __name__ == "__main__":
    main()
