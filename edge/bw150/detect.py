#!/usr/bin/env python3
"""BW150 연결 확인 도구 — 추출 가이드 §9의 B1~B4를 소거한다.

⚠️ 실물 확인 결과(2026-08-06): BW150은 CH340G 시리얼이 아니라 **USB HID**다.
   VID 0x0483 (STMicroelectronics) / PID 0x5750, 벤더 정의 usage page 0xFF02,
   입력·출력 리포트 각각 64바이트, 리포트 ID 없음.
   그래서 기본 경로는 HID이며, 시리얼은 --serial 로만 시도한다.

사용법:
    python3 detect.py                       # 장치를 찾아 상태를 알려준다
    python3 detect.py --read                # HID 입력 리포트를 읽는다
    python3 detect.py --read --raw          # 파싱 없이 hex만
    python3 detect.py --probe               # 스트림을 깨우는 명령 후보들을 시험 (읽기 전용만)
    python3 detect.py --serial /dev/cu.XXX  # 시리얼판일 때

프로토콜 근거는 docs/hardware/bw150_data_extraction_guide.md §3-1.
바이트 오프셋은 DL24 계열에서 나온 명세라 BW150에서 확정된 게 아니다.
이 스크립트의 목적은 "맞는지 확인하는 것"이지 "맞다고 가정하는 것"이 아니다.
"""

from __future__ import annotations

import argparse
import sys
import time

VID, PID = 0x0483, 0x5750
MAGIC = b"\xff\x55"
FRAME_LEN = {0x01: 36, 0x02: 8, 0x11: 10}
DEVICE_TYPE = {0x01: "AC 미터", 0x02: "DC 미터/부하", 0x03: "USB 미터"}


# ── 프레임 해석 ────────────────────────────────────────────────────────────

def checksum(payload: bytes) -> int:
    """frame[2:-1]을 넣는다 — 매직 헤더와 체크섬 바이트를 뺀 나머지 전부."""
    return (sum(payload) & 0xFF) ^ 0x44


def u16(b: bytes, i: int) -> int:
    return (b[i] << 8) | b[i + 1]


def u24(b: bytes, i: int) -> int:
    return (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]


def u32(b: bytes, i: int) -> int:
    return (u16(b, i) << 16) | u16(b, i + 2)


def parse_report(f: bytes) -> dict:
    """type 0x01 리포트 프레임을 푼다. 전력·저항은 프레임에 없어 계산한다."""
    voltage = u24(f, 4) * 0.1
    current = u24(f, 7) * 0.001
    return {
        "device_type": f[3],
        "voltage_v": voltage,
        "current_a": current,
        "power_w": voltage * current,
        "capacity_ah": u24(f, 10) * 0.01,
        "energy_wh": u32(f, 13) * 10.0,
        "temp_c": u16(f, 24),
        "runtime_s": u16(f, 26) * 3600 + f[28] * 60 + f[29],
        "off_17_20": f[17:21].hex(" "),  # 정체 미확인 (가이드 §9 B5)
    }


def px100(cmd: int, d1: int = 0, d2: int = 0) -> bytes:
    """호스트→기기 제어 프레임. 텔레메트리와 다른 프로토콜이다. 체크섬 없음."""
    return bytes((0xB1, 0xB2, cmd, d1, d2, 0xB6))


def atorch_cmd(cmd: int, adu: int = 0x02, data: int = 0) -> bytes:
    """FF 55 11 … 명령 프레임(10바이트). 리셋·버튼용이지 부하 ON/OFF가 아니다."""
    body = bytes((0x11, adu, cmd,
                  (data >> 16) & 0xFF, (data >> 8) & 0xFF, data & 0xFF, 0x00))
    return MAGIC + body + bytes((checksum(body),))


class FrameSync:
    """바이트 스트림에서 FF 55 프레임을 뽑아낸다. HID·시리얼 공용."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, chunk: bytes):
        self.buf.extend(chunk)
        while True:
            i = self.buf.find(MAGIC)
            if i < 0:
                del self.buf[:-1]
                return
            if i:
                del self.buf[:i]
            if len(self.buf) < 4:
                return
            need = FRAME_LEN.get(self.buf[2])
            if need is None:
                del self.buf[:2]
                continue
            if len(self.buf) < need:
                return
            frame = bytes(self.buf[:need])
            del self.buf[:need]
            yield frame


# ── HID 경로 ───────────────────────────────────────────────────────────────

def open_hid():
    try:
        import hid
    except ImportError:
        sys.exit("hidapi가 없다.  pip install hidapi")
    h = hid.device()
    h.open(VID, PID)
    return h


def hid_write(h, payload: bytes) -> int:
    """리포트 ID 없는 장치라 macOS hidapi는 앞에 0x00을 붙여야 한다."""
    return h.write(bytes([0x00]) + payload + bytes(64 - len(payload)))


def cmd_info() -> int:
    try:
        import hid
    except ImportError:
        sys.exit("hidapi가 없다.  pip install hidapi")

    found = [d for d in hid.enumerate() if (d["vendor_id"], d["product_id"]) == (VID, PID)]
    if not found:
        print("BW150 (VID 0x0483 / PID 0x5750) 을 못 찾았다.\n")
        print("확인 순서:")
        print("  1. BW150 화면이 켜져 있는가 — 자체 전원이 필요하다")
        print("     (DC5.5 잭 12V, 또는 CC 포트에 USB 5V/2A·QC/PD 12V)")
        print("  2. 케이블을 'HID computer online' 포트에 꽂았는가")
        print("     — 전원용 CC 포트와 다른 포트다")
        print("  3. 동봉된 'Computer Online cable'을 쓰고 있는가")
        print("     — 충전 전용 케이블은 데이터 선이 없어 아무것도 안 잡힌다")
        print("\n  USB 장치 전체 확인:")
        print("     ioreg -p IOUSB -w0 -l | grep -i 'product name'")
        return 1

    d = found[0]
    print("✅ BW150 발견 (USB HID)")
    print(f"   제품   : {d['product_string']}")
    print(f"   제조사 : {d['manufacturer_string']}")
    print(f"   VID/PID: 0x{d['vendor_id']:04x} / 0x{d['product_id']:04x}")
    print(f"   usage  : page 0x{d['usage_page']:04x} / 0x{d['usage']:02x} (벤더 정의)")
    print("\n다음: python3 detect.py --read")
    return 0


def cmd_read(seconds: float, raw: bool) -> int:
    h = open_hid()
    print(f"열림: {h.get_manufacturer_string()} | {h.get_product_string()}")
    print(f"{seconds:.0f}초 동안 입력 리포트를 읽는다. Ctrl-C로 중단.\n")

    h.set_nonblocking(0)
    sync = FrameSync()
    reports = frames = bad_crc = 0
    seen_types: dict[int, int] = {}
    first_type_shown = False
    deadline = time.time() + seconds

    try:
        while time.time() < deadline:
            data = h.read(64, timeout_ms=500)
            if not data:
                continue
            reports += 1
            chunk = bytes(data)
            if raw and reports <= 20:
                print(f"  리포트 {reports:3d}: {chunk.hex(' ')}")

            for frame in sync.feed(chunk):
                frames += 1
                mtype = frame[2]
                seen_types[mtype] = seen_types.get(mtype, 0) + 1
                ok = checksum(frame[2:-1]) == frame[-1]
                if not ok:
                    bad_crc += 1

                if raw or not ok or mtype != 0x01:
                    print(f"  [{'OK ' if ok else 'CRC✗'}] type=0x{mtype:02x} "
                          f"{frame.hex(' ')}")
                    continue

                d = parse_report(frame)
                if not first_type_shown:
                    first_type_shown = True
                    dt = d["device_type"]
                    warn = "" if dt == 0x02 else "  ⚠️ DC(0x02)가 아니다 — 파서 확인 필요"
                    print(f"  [B1] 디바이스 타입 = 0x{dt:02x} "
                          f"({DEVICE_TYPE.get(dt, '미상')}){warn}")
                print(f"  V={d['voltage_v']:7.3f}  I={d['current_a']:7.3f}  "
                      f"P={d['power_w']:8.3f}W  Ah={d['capacity_ah']:8.2f}  "
                      f"Wh={d['energy_wh']:9.1f}  T={d['temp_c']:3d}C  "
                      f"t={d['runtime_s']:6d}s  [17:21]={d['off_17_20']}")
    except KeyboardInterrupt:
        print("\n중단.")
    finally:
        h.close()

    print(f"\n--- 결과 ---\n리포트 {reports},  프레임 {frames},  체크섬 실패 {bad_crc}")
    if seen_types:
        print("메시지 타입별: " +
              ", ".join(f"0x{t:02x}×{n}" for t, n in sorted(seen_types.items())))

    if reports == 0:
        print("\n❌ 입력 리포트가 하나도 안 왔다. 장치는 열리는데 데이터를 안 보낸다.")
        print("   가장 흔한 원인: **BW150이 측정 화면에 있지 않다.**")
        print("   본체에서 측정 모드(CC 등)로 들어가 Start를 누른 뒤 다시 시도할 것.")
        print("   그래도 안 오면 --probe 로 깨우기 명령을 시험한다.")
        return 1
    if frames == 0:
        print("\n⚠️ 리포트는 오는데 FF 55 프레임이 없다.")
        print("   --raw 로 원본 hex를 떠서 가이드 §3-1의 레이아웃과 대조할 것.")
        return 1
    print("\n✅ 프레임 파싱 성공.")
    return 0


def cmd_probe() -> int:
    """스트림을 깨우는 명령 후보를 시험한다. 파괴적 명령(리셋)은 넣지 않는다."""
    candidates = [
        ("빈 리포트",              b""),
        ("PX100 0x10 출력상태",    px100(0x10)),
        ("PX100 0x11 전압",        px100(0x11)),
        ("PX100 0x12 전류",        px100(0x12)),
        ("PX100 0x16 MOS온도",     px100(0x16)),
        ("PX100 0x17 설정전류",    px100(0x17)),
        ("Atorch FF5511 ADU=02",   atorch_cmd(0x00, adu=0x02)),
        ("Atorch FF5511 ADU=03",   atorch_cmd(0x00, adu=0x03)),
    ]
    print("⚠️ 리셋·버튼 명령은 제외했다 (데이터가 지워지거나 화면이 바뀐다).\n")
    hit = False
    for label, payload in candidates:
        h = open_hid()
        h.set_nonblocking(0)
        try:
            hid_write(h, payload)
        except Exception as e:
            print(f"{label:24s} write 오류: {e}")
            h.close()
            continue
        got = []
        t0 = time.time()
        while time.time() - t0 < 1.5:
            d = h.read(64, timeout_ms=300)
            if d:
                got.append(bytes(d))
        h.close()
        if got:
            hit = True
            print(f"{label:24s} ✅ 수신 {len(got)}개")
            for g in got[:2]:
                print(f"{'':26s}{g.hex(' ')}")
        else:
            print(f"{label:24s} — 응답 없음")

    if not hit:
        print("\n어느 명령에도 반응이 없다.")
        print("→ 본체를 측정 모드로 두고 Start를 누른 뒤 --read 를 다시 시도할 것.")
        return 1
    return 0


# ── 시리얼 경로 (시리얼판일 때만) ──────────────────────────────────────────

def cmd_serial(port: str, seconds: float, raw: bool) -> int:
    try:
        import serial
    except ImportError:
        sys.exit("pyserial이 없다.  pip install pyserial")
    print(f"{port} 9600 8N1 로 연다...")
    ser = serial.Serial(port, 9600, timeout=1)
    sync = FrameSync()
    frames = 0
    deadline = time.time() + seconds
    try:
        while time.time() < deadline:
            chunk = ser.read(64)
            if not chunk:
                continue
            for frame in sync.feed(chunk):
                frames += 1
                ok = checksum(frame[2:-1]) == frame[-1]
                if raw or not ok or frame[2] != 0x01:
                    print(f"  [{'OK ' if ok else 'CRC✗'}] {frame.hex(' ')}")
                    continue
                d = parse_report(frame)
                print(f"  V={d['voltage_v']:7.3f}  I={d['current_a']:7.3f}  "
                      f"Ah={d['capacity_ah']:8.2f}  Wh={d['energy_wh']:9.1f}")
    except KeyboardInterrupt:
        print("\n중단.")
    finally:
        ser.close()
    print(f"\n프레임 {frames}개")
    return 0 if frames else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="BW150 연결 확인 (기본 경로는 USB HID)")
    ap.add_argument("--read", action="store_true", help="HID 입력 리포트를 읽는다")
    ap.add_argument("--probe", action="store_true", help="스트림 깨우기 명령 시험")
    ap.add_argument("--serial", metavar="PORT", help="시리얼판일 때의 포트")
    ap.add_argument("--seconds", type=float, default=10.0, help="읽는 시간 (기본 10초)")
    ap.add_argument("--raw", action="store_true", help="파싱 없이 hex만 출력")
    args = ap.parse_args()

    if args.serial:
        return cmd_serial(args.serial, args.seconds, args.raw)
    if args.probe:
        return cmd_probe()
    if args.read:
        return cmd_read(args.seconds, args.raw)
    return cmd_info()


if __name__ == "__main__":
    sys.exit(main())
