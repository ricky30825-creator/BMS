#!/usr/bin/env python3
"""BW150 BLE 상시 수집기 → CSV.

가이드 §6 스키마로 CSV를 쓴다. 정본은 docs/hardware/bw150_data_extraction_guide.md.

## 설계 원칙 — 원본 hex를 반드시 함께 남긴다

**모든 행에 원본 프레임 hex를 그대로 남긴다.** 아직 정체를 모르는 바이트가 남아 있어
(§9), 나중에 밝혀지면 과거 데이터를 재해석할 수 있어야 한다.

확정된 필드(2026-08-06, 전류 1.0A↔0.5A 전환으로 검증):
- `[4:7]` = **전압** ×0.1 → V   (기본값 `--assume v`가 이것이다)
- `[7:10]` = **전류** ×0.001 → A

## 누적값은 우리가 직접 적산한다

기기의 누적 Cap·Ene가 BLE 프레임에 없으므로, **전류(1mA 분해능)와 우리 타임스탬프로
직접 적분한다.** 이게 오히려 기기 적산값보다 신뢰할 만하다.

사용법:
    python3 logger.py --out data/run1.csv --note "18650 #1, CC 1.0A, 만충 시작"
    python3 logger.py --out data/run1.csv --hours 3 --assume v
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ADDR_HINTS = ("bw150", "atorch", "dl24")
CH_NOTIFY = "0000ffe1-0000-1000-8000-00805f9b34fb"
MAGIC = b"\xff\x55"
FRAME_LEN = 36

COLUMNS = [
    # 계약(mode1_backend_spec §9)과 같은 이름 — 조립 후 합치기 위해
    "timestamp", "session_id", "voltage_v", "current_a", "power_w",
    "soc_pct", "temp_contact", "temp_ir_surface", "pressure_raw",
    "gas_raw", "acoustic_raw",
    # BW150 고유 / 파생
    "bw_energy_wh", "bw_capacity_mah", "bw_resistance_ohm",
    "bw_elapsed_s", "bw_mode", "bw_load_on",
    "bw_field47_raw", "bw_voltage_assumed_from",
    "test_phase", "raw_hex",
]


def u24(b: bytes, i: int) -> int:
    return (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]


def parse(frame: bytes) -> dict:
    """확정된 것만 해석한다. 미확정 필드는 raw로 넘긴다."""
    return {
        "device_type": frame[3],
        "current_a": u24(frame, 7) * 0.001,   # ✅ 확정 (§3-2)
        "field47_raw": u24(frame, 4),         # ❓ 전압·전력·저항 미결
    }


def voltage_from(field47_raw: int, current_a: float, assume: str) -> float | None:
    """`[4:7]`의 정체가 미결이라 가정별로 전압을 낸다.

    셋 다 ×0.1 스케일이며, 전류가 1.0A 근처면 세 해석이 거의 같은 값을 준다.
    다른 전류에서는 크게 갈리므로 `--assume`을 반드시 의식적으로 고른다.
    """
    scaled = field47_raw * 0.1
    if assume == "v":
        return scaled
    if assume == "p":
        return scaled / current_a if current_a > 0.001 else None
    if assume == "r":
        return scaled * current_a
    return None


class Session:
    def __init__(self, out: Path, note: str, assume: str, phase: str,
                 mode: str = "CC"):
        self.out = out
        self.note = note
        self.assume = assume
        self.phase = phase
        self.mode = mode
        self.session_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.started = time.time()
        self.rows = 0
        self.cap_mah = 0.0       # 우리가 적산
        self.energy_wh = 0.0     # 우리가 적산
        self.last_t: float | None = None
        self.buf = bytearray()

        out.parent.mkdir(parents=True, exist_ok=True)
        self.fh = out.open("w", newline="")
        self.w = csv.DictWriter(self.fh, fieldnames=COLUMNS)
        self.w.writeheader()

        side = out.with_suffix(".meta.json")
        side.write_text(json.dumps({
            "session_id": self.session_id,
            "note": note,
            "voltage_assumed_from": assume,
            "test_phase": phase,
            "bw_mode": mode,
            "started_utc": datetime.now(timezone.utc).isoformat(),
            "source": "BW150 BLE ffe1",
            "warning": "[4:7] 필드 정체 미확정 — raw_hex로 재해석 가능",
        }, ensure_ascii=False, indent=2))

    def feed(self, data: bytes):
        self.buf.extend(data)
        while True:
            i = self.buf.find(MAGIC)
            if i < 0:
                del self.buf[:-1]
                return
            if i:
                del self.buf[:i]
            if len(self.buf) < FRAME_LEN:
                return
            frame = bytes(self.buf[:FRAME_LEN])
            del self.buf[:FRAME_LEN]
            self._row(frame)

    def _row(self, frame: bytes):
        now = time.time()
        d = parse(frame)
        i_a = d["current_a"]
        v = voltage_from(d["field47_raw"], i_a, self.assume)

        # 우리가 직접 적산 — 기기 누적값이 프레임에 없다
        if self.last_t is not None:
            dt_h = (now - self.last_t) / 3600.0
            self.cap_mah += i_a * 1000.0 * dt_h
            if v is not None:
                self.energy_wh += v * i_a * dt_h
        self.last_t = now

        self.w.writerow({
            "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(
                timespec="milliseconds"),
            "session_id": self.session_id,
            # 계약 규약: 방전은 음수 (§6-2). BW150은 방전 전용이라 항상 음수다.
            "voltage_v": round(v, 3) if v is not None else "",
            "current_a": round(-i_a, 4),
            "power_w": round(-v * i_a, 4) if v is not None else "",
            "soc_pct": "", "temp_contact": "", "temp_ir_surface": "",
            "pressure_raw": "", "gas_raw": "", "acoustic_raw": "",
            "bw_energy_wh": round(self.energy_wh, 5),
            "bw_capacity_mah": round(self.cap_mah, 3),
            "bw_resistance_ohm": round(v / i_a, 3) if v and i_a > 0.001 else "",
            "bw_elapsed_s": round(now - self.started, 1),
            "bw_mode": self.mode,
            "bw_load_on": i_a > 0.005,
            "bw_field47_raw": d["field47_raw"],
            "bw_voltage_assumed_from": self.assume,
            "test_phase": self.phase,
            "raw_hex": frame.hex(),
        })
        self.rows += 1
        if self.rows % 30 == 1:
            self.fh.flush()
            vs = f"{v:6.2f}V" if v is not None else "  --  "
            print(f"  {self.rows:6d}행  {vs}  {i_a:6.3f}A  "
                  f"{self.cap_mah:8.1f}mAh  {self.energy_wh:7.3f}Wh")

    def close(self):
        self.fh.flush()
        self.fh.close()
        print(f"\n{self.rows}행 저장 → {self.out}")
        print(f"적산 용량 {self.cap_mah:.1f} mAh,  에너지 {self.energy_wh:.3f} Wh")
        if self.rows:
            print(f"메타데이터 → {self.out.with_suffix('.meta.json')}")


async def find_device(timeout: float = 15.0):
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    best = None
    for _addr, (dev, adv) in found.items():
        name = (dev.name or adv.local_name or "").lower()
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if any(h in name for h in ADDR_HINTS) or any(u.startswith("0000ffe0") for u in uuids):
            if best is None or adv.rssi > best[1]:
                best = (dev, adv.rssi)
    return best


async def run(sess: Session, hours: float) -> int:
    from bleak import BleakClient

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(s, stop.set)
        except NotImplementedError:
            pass

    deadline = time.time() + hours * 3600
    attempt = 0
    while time.time() < deadline and not stop.is_set():
        best = await find_device()
        if not best:
            attempt += 1
            print(f"  기기를 못 찾음 (시도 {attempt}) — 10초 후 재시도")
            try:
                await asyncio.wait_for(stop.wait(), timeout=10)
            except asyncio.TimeoutError:
                pass
            continue
        dev, rssi = best
        print(f"연결 (rssi={rssi})")
        try:
            async with BleakClient(dev, timeout=25.0) as c:
                print("✅ 수집 시작 — Ctrl-C로 종료\n")
                attempt = 0
                await c.start_notify(CH_NOTIFY, lambda _ch, d: sess.feed(bytes(d)))
                while c.is_connected and time.time() < deadline and not stop.is_set():
                    await asyncio.sleep(1)
        except Exception as e:
            print(f"  연결 끊김: {e} — 재연결한다")
            await asyncio.sleep(3)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="BW150 BLE 수집기")
    ap.add_argument("--out", type=Path, required=True, help="CSV 경로")
    ap.add_argument("--note", default="", help="세션 조건 (셀 ID·전류·시작 SOC 등)")
    ap.add_argument("--hours", type=float, default=12.0, help="최대 수집 시간")
    ap.add_argument("--assume", choices=("v", "p", "r"), default="v",
                    help="[4:7]을 전압(v)/전력(p)/저항(r) 중 무엇으로 볼지 (§9 B16 미결)")
    ap.add_argument("--phase", default="NORMAL",
                    help="test_phase 라벨 — NORMAL / ABNORMAL_* / BRT 등")
    ap.add_argument("--mode", default="CC",
                    help="BW150 동작 모드 라벨 — CC / CR / BRT / PT / CT")
    args = ap.parse_args()

    try:
        import bleak  # noqa: F401
    except ImportError:
        sys.exit("bleak이 없다.  pip install bleak")

    if not args.note:
        print("⚠️ --note 없이 수집하면 나중에 이 데이터가 무슨 조건인지 알 수 없다.\n")

    sess = Session(args.out, args.note, args.assume, args.phase, args.mode)
    try:
        return asyncio.run(run(sess, args.hours))
    except KeyboardInterrupt:
        return 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
