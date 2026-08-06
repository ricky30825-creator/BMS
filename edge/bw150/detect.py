#!/usr/bin/env python3
"""BW150 연결 확인 도구 — 추출 가이드 §9의 B1~B4를 소거한다.

사용법:
    python3 detect.py                      # 포트 후보를 찾아 알려준다
    python3 detect.py --port /dev/cu.XXX   # 연결해서 프레임을 읽는다
    python3 detect.py --port ... --raw     # 파싱 없이 hex만 (파싱이 실패할 때)
    python3 detect.py --port ... --ping    # PX-100 제어 명령이 통하는지 시험 (B3)

프로토콜 근거는 docs/hardware/bw150_data_extraction_guide.md §3-1.
BW150 직접 캡처가 아니라 DL24 계열에서 나온 명세이므로, 이 스크립트의 목적은
"맞는지 확인하는 것"이지 "맞다고 가정하는 것"이 아니다.
"""

from __future__ import annotations

import argparse
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial이 없다.  pip install pyserial")

MAGIC = b"\xff\x55"
FRAME_LEN = {0x01: 36, 0x02: 8, 0x11: 10}
DEVICE_TYPE = {0x01: "AC 미터", 0x02: "DC 미터/부하", 0x03: "USB 미터"}

# 이 문자열이 포트 이름/설명에 있으면 BW150 후보로 본다
HINTS = ("wchusbserial", "usbserial", "ch340", "ch910", "SLAB", "usbmodem")


def find_ports():
    """연결 가능성이 있는 시리얼 포트를 (후보, 그 외)로 나눠 돌려준다."""
    likely, others = [], []
    for p in list_ports.comports():
        blob = f"{p.device} {p.description} {p.manufacturer or ''}".lower()
        if "bluetooth-incoming" in blob or "debug-console" in blob:
            continue
        (likely if any(h.lower() in blob for h in HINTS) else others).append(p)
    return likely, others


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
        "resistance_ohm": (voltage / current) if current else None,
        "capacity_ah": u24(f, 10) * 0.01,
        "energy_wh": u32(f, 13) * 10.0,
        "temp_c": u16(f, 24),
        "runtime_s": u16(f, 26) * 3600 + f[28] * 60 + f[29],
        "off_17_20": f[17:21].hex(" "),  # 정체 미확인 (가이드 §9 B5)
    }


def px100(cmd: int, d1: int = 0, d2: int = 0) -> bytes:
    """호스트→기기 제어 프레임. 텔레메트리와 다른 프로토콜이다. 체크섬 없음."""
    return bytes((0xB1, 0xB2, cmd, d1, d2, 0xB6))


def cmd_list_ports() -> int:
    likely, others = find_ports()
    if likely:
        print("BW150 후보 포트:")
        for p in likely:
            print(f"  {p.device}   {p.description}")
        print(f"\n다음: python3 detect.py --port {likely[0].device}")
        return 0

    print("USB 시리얼 포트를 못 찾았다.\n")
    if others:
        print("연결된 다른 포트(후보는 아님):")
        for p in others:
            print(f"  {p.device}   {p.description}")
        print()
    print("확인 순서:")
    print("  1. BW150에 자체 전원이 들어갔는가 — 화면이 켜져 있어야 한다.")
    print("     (DC5.5 잭 12V, 또는 CC 포트에 USB 5V/2A·QC/PD 12V)")
    print("  2. 케이블을 'HID computer online' 포트에 꽂았는가 —")
    print("     전원용 CC 포트와 다른 포트다.")
    print("  3. 동봉된 'Computer Online cable'을 쓰고 있는가 — 충전 전용")
    print("     케이블은 데이터 선이 없어 아무것도 안 잡힌다.")
    print("  4. 그래도 없으면 시리얼이 아니라 진짜 HID일 수 있다:")
    print("     system_profiler SPUSBDataType | grep -A6 -i 'hid\\|ch34\\|atorch'")
    print("     이때는 BLE 경로로 우회한다 (가이드 §3-2).")
    return 1


def cmd_read(port: str, seconds: float, raw: bool, ping: bool) -> int:
    print(f"{port} 9600 8N1 로 연다...")
    try:
        ser = serial.Serial(port, 9600, timeout=1)
    except serial.SerialException as e:
        print(f"열기 실패: {e}")
        return 1

    if ping:
        print("\n[B3] PX-100 제어 명령 시험 — 부하 ON(B1 B2 01 01 00 B6) 전송")
        print("     ⚠️ 배터리가 물려 있으면 실제로 방전이 시작된다.")
        ser.reset_input_buffer()
        ser.write(px100(0x01, 0x01, 0x00))
        time.sleep(0.5)
        resp = ser.read(8)
        if resp == b"\x6f" or resp.startswith(b"\x6f"):
            print(f"     ✅ ACK 0x6F 수신 — PX-100 제어가 통한다. resp={resp.hex(' ')}")
        elif resp:
            print(f"     ⚠️ 응답은 왔으나 0x6F가 아니다: {resp.hex(' ')}")
            print("        (텔레메트리 프레임이 섞였을 수 있다. --raw로 다시 볼 것)")
        else:
            print("     ❌ 응답 없음 — 제어는 본체 버튼/Tuya로 하고 시리얼은 읽기 전용.")
        print("     부하 OFF 전송")
        ser.write(px100(0x01, 0x00, 0x00))
        time.sleep(0.3)
        ser.reset_input_buffer()

    print(f"\n{seconds:.0f}초 동안 읽는다. Ctrl-C로 중단.\n")
    buf = bytearray()
    stats = {"frames": 0, "bad_crc": 0, "bytes": 0}
    seen_types: dict[int, int] = {}
    deadline = time.time() + seconds

    try:
        while time.time() < deadline:
            chunk = ser.read(64)
            if not chunk:
                continue
            stats["bytes"] += len(chunk)
            buf.extend(chunk)

            while True:
                i = buf.find(MAGIC)
                if i < 0:
                    del buf[:-1]  # 매직의 앞바이트만 남긴다
                    break
                if i:
                    del buf[:i]
                if len(buf) < 4:
                    break

                mtype = buf[2]
                need = FRAME_LEN.get(mtype)
                if need is None:
                    print(f"  알 수 없는 메시지 타입 0x{mtype:02x} — 1바이트 건너뜀")
                    del buf[:2]
                    continue
                if len(buf) < need:
                    break

                frame = bytes(buf[:need])
                del buf[:need]
                seen_types[mtype] = seen_types.get(mtype, 0) + 1

                ok = checksum(frame[2:-1]) == frame[-1]
                if not ok:
                    stats["bad_crc"] += 1
                stats["frames"] += 1

                if raw or not ok or mtype != 0x01:
                    flag = "OK " if ok else "CRC✗"
                    print(f"[{flag}] type=0x{mtype:02x} {frame.hex(' ')}")
                    continue

                d = parse_report(frame)
                if stats["frames"] == 1 or d["device_type"] != 0x02:
                    dt = d["device_type"]
                    print(f"  [B1] 디바이스 타입 = 0x{dt:02x} "
                          f"({DEVICE_TYPE.get(dt, '미상')})"
                          f"{'' if dt == 0x02 else '  ⚠️ DC(0x02)가 아니다 — 파서 확인 필요'}")
                print(
                    f"  V={d['voltage_v']:7.3f}  I={d['current_a']:7.3f}  "
                    f"P={d['power_w']:8.3f}W  "
                    f"Ah={d['capacity_ah']:8.2f}  Wh={d['energy_wh']:9.1f}  "
                    f"T={d['temp_c']:3d}C  t={d['runtime_s']:6d}s  "
                    f"[17:21]={d['off_17_20']}"
                )
    except KeyboardInterrupt:
        print("\n중단.")
    finally:
        ser.close()

    print("\n--- 결과 ---")
    print(f"수신 바이트 {stats['bytes']},  프레임 {stats['frames']},  "
          f"체크섬 실패 {stats['bad_crc']}")
    if seen_types:
        print("메시지 타입별: " +
              ", ".join(f"0x{t:02x}×{n}" for t, n in sorted(seen_types.items())))

    if stats["frames"] == 0:
        print("\n❌ 프레임이 하나도 안 잡혔다.")
        if stats["bytes"]:
            print("   바이트는 오는데 FF 55 동기가 안 된다 → 보율이 9600이 아닐 수 있다.")
        else:
            print("   아무 바이트도 안 온다 → 포트가 틀렸거나 데이터 선이 없는 케이블이다.")
        return 1
    if stats["bad_crc"] == stats["frames"]:
        print("\n❌ 전부 체크섬 실패 — 체크섬 규칙이 이 기기에서 다르다.")
        print("   --raw 로 hex를 떠서 가이드 §3-1과 대조할 것.")
        return 1

    print("\n✅ 프레임 파싱 성공.")
    print("   다음에 확인할 것:")
    print("   - [B2] 알려진 전류로 방전하며 Ah 값이 시간에 따라 늘어나는지")
    print("          (늘어나면 누적 용량이 맞다. 순간 전력처럼 보이면 파서가 틀린 것)")
    print("   - [B3] --ping 으로 PX-100 제어 확인")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="BW150 연결 확인")
    ap.add_argument("--port", help="시리얼 포트 (생략하면 후보를 찾아 알려준다)")
    ap.add_argument("--seconds", type=float, default=10.0, help="읽는 시간 (기본 10초)")
    ap.add_argument("--raw", action="store_true", help="파싱 없이 hex만 출력")
    ap.add_argument("--ping", action="store_true", help="PX-100 제어 명령 시험 (B3)")
    args = ap.parse_args()

    if not args.port:
        return cmd_list_ports()
    return cmd_read(args.port, args.seconds, args.raw, args.ping)


if __name__ == "__main__":
    sys.exit(main())
