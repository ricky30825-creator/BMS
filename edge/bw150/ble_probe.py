#!/usr/bin/env python3
"""BW150 BLE 캡처·필드 탐색 도구.

USB HID 경로는 입력 리포트가 안 흘러서(가이드 §3-1a) **BLE가 실제로 동작하는 경로**다.
2026-08-06 실측: `BW150_BLE` 광고, 서비스 `0000ffe0`, 특성 `ffe1`(notify+write) /
`ffe2`(write). `FF 55 01 02` 36바이트 프레임이 초당 약 1회 들어온다.

⚠️ 공개 문서(DL24 계열)의 바이트 레이아웃·체크섬이 **이 기기에서 검증되지 않았다.**
   그래서 이 도구의 목적은 "문서대로 파싱"이 아니라 **어느 바이트가 무엇에 반응하는지
   실측으로 알아내는 것**이다.

사용법:
    python3 ble_probe.py --scan
    python3 ble_probe.py --watch                 # 실시간 + 변하는 바이트 표시
    python3 ble_probe.py --capture 120 --out a.jsonl --note "CC 1.0A 방전"
    python3 ble_probe.py --analyze a.jsonl b.jsonl   # 캡처들을 비교해 필드 추정
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

NAME_HINTS = ("bw150", "atorch", "dl24")
SVC = "0000ffe0-0000-1000-8000-00805f9b34fb"
CH_NOTIFY = "0000ffe1-0000-1000-8000-00805f9b34fb"
CH_WRITE = "0000ffe2-0000-1000-8000-00805f9b34fb"
MAGIC = b"\xff\x55"


def need_bleak():
    try:
        from bleak import BleakClient, BleakScanner  # noqa: F401
    except ImportError:
        sys.exit("bleak이 없다.  pip install bleak")


async def find_device(timeout: float = 15.0):
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    best = None
    for addr, (dev, adv) in found.items():
        name = (dev.name or adv.local_name or "").lower()
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if any(h in name for h in NAME_HINTS) or any(u.startswith("0000ffe0") for u in uuids):
            if best is None or adv.rssi > best[1]:
                best = (dev, adv.rssi, dev.name or adv.local_name)
    return best


async def cmd_scan() -> int:
    print("BLE 스캔...")
    best = await find_device()
    if not best:
        print("BW150을 못 찾았다.")
        print("  - 기기 전원이 켜져 있는가")
        print("  - 스마트폰 앱이 이미 물고 있으면 맥이 못 붙는다. 앱 연결을 끊을 것")
        return 1
    dev, rssi, name = best
    print(f"✅ {name}  {dev.address}  rssi={rssi}")
    if rssi < -85:
        print("   ⚠️ 신호가 약하다. 기기를 맥 가까이 옮기면 연결이 안정된다.")
    return 0


class Collector:
    """FF55 프레임을 모으고 바이트별 변화를 추적한다."""

    def __init__(self) -> None:
        self.frames: list[tuple[float, bytes]] = []
        self.buf = bytearray()

    def feed(self, data: bytes):
        self.buf.extend(data)
        while True:
            i = self.buf.find(MAGIC)
            if i < 0:
                del self.buf[:-1]
                return
            if i:
                del self.buf[:i]
            if len(self.buf) < 36:
                return
            frame = bytes(self.buf[:36])
            del self.buf[:36]
            self.frames.append((time.time(), frame))
            yield frame

    def varying(self) -> list[int]:
        """값이 한 번이라도 바뀐 바이트 위치."""
        if len(self.frames) < 2:
            return []
        first = self.frames[0][1]
        out = set()
        for _, f in self.frames[1:]:
            for i in range(36):
                if f[i] != first[i]:
                    out.add(i)
        return sorted(out)


async def stream(handler, seconds: float) -> int:
    from bleak import BleakClient
    best = await find_device()
    if not best:
        print("BW150을 못 찾았다. --scan 으로 먼저 확인할 것.")
        return 1
    dev, rssi, name = best
    print(f"연결: {name} rssi={rssi}")
    async with BleakClient(dev, timeout=25.0) as c:
        print("✅ 연결됨\n")
        await c.start_notify(CH_NOTIFY, handler)
        await asyncio.sleep(seconds)
        try:
            await c.stop_notify(CH_NOTIFY)
        except Exception:
            pass
    return 0


async def cmd_watch(seconds: float) -> int:
    col = Collector()
    prev = {}

    def on_data(_ch, data: bytearray):
        for f in col.feed(bytes(data)):
            n = len(col.frames)
            changed = [i for i in range(36) if i in prev and prev[i] != f[i]]
            for i in range(36):
                prev[i] = f[i]
            mark = "".join("^" if i in changed else " " for i in range(36))
            print(f"[{n:4d}] {f.hex(' ')}")
            if changed:
                print(f"       {' '.join(mark[i] * 2 for i in range(36))}  변함: {changed}")

    rc = await stream(on_data, seconds)
    if col.frames:
        print(f"\n프레임 {len(col.frames)}개.  전체 기간 중 변한 바이트: {col.varying()}")
        print("고정 바이트는 상수/설정값, 변하는 바이트가 실측값이다.")
    return rc


async def cmd_capture(seconds: float, out: Path, note: str) -> int:
    col = Collector()

    def on_data(_ch, data: bytearray):
        for f in col.feed(bytes(data)):
            n = len(col.frames)
            if n % 10 == 1 or n <= 3:
                print(f"  {n:4d}개  {f.hex(' ')}")

    print(f"{seconds:.0f}초 캡처 → {out}")
    if note:
        print(f"조건: {note}\n")
    rc = await stream(on_data, seconds)

    with out.open("w") as fh:
        fh.write(json.dumps({"_meta": {
            "note": note, "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "count": len(col.frames)}}) + "\n")
        for ts, f in col.frames:
            fh.write(json.dumps({"t": round(ts, 3), "hex": f.hex()}) + "\n")

    print(f"\n프레임 {len(col.frames)}개 저장.  변한 바이트: {col.varying()}")
    return rc if col.frames else 1


def load(path: Path):
    meta, frames = {}, []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        if "_meta" in o:
            meta = o["_meta"]
        else:
            frames.append(bytes.fromhex(o["hex"]))
    return meta, frames


def cmd_analyze(paths: list[Path]) -> int:
    caps = []
    for p in paths:
        meta, frames = load(p)
        if not frames:
            print(f"{p}: 프레임 없음")
            continue
        caps.append((p.name, meta.get("note", ""), frames))

    if not caps:
        return 1

    print("=== 캡처별 요약 ===")
    for name, note, frames in caps:
        first = frames[0]
        varying = sorted({i for f in frames for i in range(36) if f[i] != first[i]})
        print(f"\n{name}  ({note or '조건 미기록'})  프레임 {len(frames)}개")
        print(f"  대표 프레임: {first.hex(' ')}")
        print(f"  변하는 바이트: {varying}")

    if len(caps) >= 2:
        print("\n=== 캡처 간 차이 (조건이 다르면 여기가 그 조건에 반응하는 필드다) ===")
        base_name, _, base = caps[0]
        for name, note, frames in caps[1:]:
            diff = [i for i in range(36) if base[0][i] != frames[0][i]]
            print(f"\n{base_name} ↔ {name}: 다른 바이트 {diff}")
            for i in diff:
                print(f"   [{i:2d}]  0x{base[0][i]:02x} → 0x{frames[0][i]:02x}")

    print("\n=== 다중바이트 필드 후보 (연속 변화 구간) ===")
    for name, note, frames in caps:
        first = frames[0]
        varying = sorted({i for f in frames for i in range(36) if f[i] != first[i]})
        runs, cur = [], []
        for i in varying:
            if cur and i == cur[-1] + 1:
                cur.append(i)
            else:
                if cur:
                    runs.append(cur)
                cur = [i]
        if cur:
            runs.append(cur)
        if runs:
            print(f"  {name}: " + ", ".join(f"[{r[0]}..{r[-1]}]" for r in runs))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="BW150 BLE 캡처·필드 탐색")
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--capture", type=float, metavar="SECONDS")
    ap.add_argument("--out", type=Path, default=Path("capture.jsonl"))
    ap.add_argument("--note", default="", help="캡처 조건 메모 (분석에 꼭 필요하다)")
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--analyze", nargs="+", type=Path, metavar="FILE")
    args = ap.parse_args()

    if args.analyze:
        return cmd_analyze(args.analyze)

    need_bleak()
    if args.scan:
        return asyncio.run(cmd_scan())
    if args.capture:
        return asyncio.run(cmd_capture(args.capture, args.out, args.note))
    if args.watch:
        return asyncio.run(cmd_watch(args.seconds))
    return asyncio.run(cmd_scan())


if __name__ == "__main__":
    sys.exit(main())
