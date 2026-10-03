#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""svg2png.py — SVG 를 PNG 로 굽는다 (PPT 삽입용).

python-pptx 는 SVG 를 못 넣는다. cairosvg 는 Windows 에 libcairo 가 없어 안 돌고,
svglib 는 한글 폰트를 제대로 못 찾는다. **Edge(Chromium) 헤드리스**를 쓰면
시스템 폰트를 그대로 쓰므로 한글이 정확히 나온다.

    python svg2png.py           # 전부 2배 배율로 굽는다
    python svg2png.py --scale 3
"""
import argparse
import glob
import io
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

EDGE = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_browser():
    for p in EDGE:
        if os.path.exists(p):
            return p
    sys.exit("Edge/Chrome 을 못 찾았다 — svg2png.py 의 EDGE 목록에 경로를 추가할 것")


def viewbox(svg):
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    return float(m.group(1)), float(m.group(2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=2.0,
                    help="배율. 9인치 폭에 넣을 때 2배면 약 320 DPI")
    ap.add_argument("--pattern", default="0*.svg")
    args = ap.parse_args()

    browser = find_browser()
    print("브라우저:", browser)

    for path in sorted(glob.glob(os.path.join(HERE, args.pattern))):
        name = os.path.basename(path)
        svg = io.open(path, encoding="utf-8").read()
        w, h = viewbox(svg)
        W, H = int(round(w * args.scale)), int(round(h * args.scale))

        # SVG 를 그대로 열면 브라우저가 제 나름대로 여백을 준다.
        # 정확한 크기로 굽기 위해 HTML 로 감싸고 창 크기를 딱 맞춘다.
        html = ('<!doctype html><meta charset="utf-8">'
                '<style>html,body{margin:0;padding:0;background:#fff;'
                'overflow:hidden}svg{display:block;width:%dpx;height:%dpx}</style>%s'
                % (W, H, svg))
        tmp = os.path.join(tempfile.gettempdir(), name + ".html")
        io.open(tmp, "w", encoding="utf-8").write(html)

        out = os.path.join(HERE, name[:-4] + ".png")
        if os.path.exists(out):
            os.remove(out)
        # 전용 프로필을 준다 — 기본 프로필은 한 번에 한 인스턴스만 쓸 수 있어서,
        # 여러 파일을 연달아 구우면 뒤쪽이 조용히 실패한다(사용자가 Edge 를
        # 열어둔 경우에도 같다).
        prof = os.path.join(tempfile.gettempdir(), "svg2png_profile")
        r = subprocess.run([
            browser, "--headless", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--user-data-dir=" + prof,
            "--no-first-run", "--no-default-browser-check",
            "--default-background-color=FFFFFFFF",
            "--screenshot=" + out, "--window-size=%d,%d" % (W, H),
            "file:///" + tmp.replace("\\", "/"),
        ], capture_output=True, timeout=180)
        os.remove(tmp)
        if not os.path.exists(out):
            err = (r.stderr or b"").decode("utf-8", "replace").strip()
            print("     stderr:", err[-300:] or "(없음)")

        if os.path.exists(out):
            print("  %-28s %5d x %-5d  %6.1f KB"
                  % (os.path.basename(out), W, H, os.path.getsize(out) / 1024.0))
        else:
            print("  %-28s 실패" % name)


if __name__ == "__main__":
    main()
