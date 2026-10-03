#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_reliability.py — 슬라이드 30 「측정 신뢰성 검증」 그림.

기존 30번은 Grafana 목업(가상 데이터)이었다. 섹션 제목이 「실제 구현 검증
결과」이므로, 실제로 검증된 것 — 재현성·계기 교차검증·인자 반응 단조성 —
으로 바꾼다.

숫자는 전부 가동 중인 PostgreSQL 에서 뽑은 값이고, 겨냥 오차 3.4 배는
compare_runs.py 의 냉각 꼬리 분석 결과다.

    python make_reliability.py
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BG = "#ffffff"
INK = "#111827"
MUTED = "#6b7280"
LINE = "#d1d5db"
SOFT = "#f9fafb"
GOOD = "#059669"
BAD = "#dc2626"
BLUE = "#336791"
WARN = "#b45309"
WARNBG = "#fdf6ec"

KR = "Malgun Gothic, 맑은 고딕, sans-serif"
MONO = "Consolas, D2Coding, monospace"


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rect(x, y, w, h, fill=BG, stroke=LINE, rx=8, sw=1.4, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" '
            'stroke="%s" stroke-width="%g"%s/>' % (x, y, w, h, rx, fill, stroke, sw, d))


def text(x, y, s, size=14, fill=INK, weight="normal", anchor="start", family=KR):
    return ('<text x="%g" y="%g" font-family="%s" font-size="%g" font-weight="%s" '
            'fill="%s" text-anchor="%s">%s</text>'
            % (x, y, family, size, weight, fill, anchor, esc(s)))


def line(x1, y1, x2, y2, stroke=LINE, sw=1.4, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="%g"%s/>'
            % (x1, y1, x2, y2, stroke, sw, d))


def panel(x, y, w, h, title, sub):
    out = [rect(x, y, w, h, SOFT, LINE, 10),
           text(x + 16, y + 26, title, 15, INK, "bold"),
           text(x + 16, y + 46, sub, 11.5, MUTED)]
    return out


def build():
    W, H = 1360, 707          # 슬롯 652x339pt 와 같은 비율
    b = []

    pw, gap = 428, 24
    px = [24, 24 + pw + gap, 24 + 2 * (pw + gap)]
    py, ph = 20, 470

    # ── 1. 재현성 ────────────────────────────────────────────────────
    x = px[0]
    b += panel(x, py, pw, ph, "① 재현성", "PB-5000 · CC 1A · 동일 조건 2회")
    base, bw, bh = py + 330, 92, 200
    vals = [("r3", 7.702, BLUE), ("r3b", 7.176, BLUE)]
    vmax = 8.4
    for i, (nm, v, col) in enumerate(vals):
        bx = x + 88 + i * 150
        hgt = v / vmax * bh
        b.append(rect(bx, base - hgt, bw, hgt, col, col, 4, 0))
        b.append(text(bx + bw / 2, base - hgt - 12, "%.3f" % v, 16, INK, "bold", "middle",
                      MONO))
        b.append(text(bx + bw / 2, base + 22, nm, 13.5, MUTED, "normal", "middle", MONO))
    b.append(line(x + 16, base, x + pw - 16, base, LINE, 1.4))
    b.append(text(x + 16, py + 92, "에너지 [Wh]", 11.5, MUTED))
    b.append(rect(x + 16, base + 44, pw - 32, 64, BG, GOOD, 8, 1.6))
    b.append(text(x + 32, base + 70, "편차 7.1%", 20, GOOD, "bold"))
    b.append(text(x + 32, base + 94, "0.526 Wh 차 · 표본 5,716 / 5,347",
                  11.5, MUTED, "normal", "start", MONO))

    # ── 2. 계기 교차검증 ─────────────────────────────────────────────
    x = px[1]
    b += panel(x, py, pw, ph, "② 계기 교차검증", "서로 다른 두 경로로 같은 값을 잰다")
    rows = [
        ("INA226 Current 레지스터", "-0.9754 A", INK),
        ("INA226 Vshunt ÷ R010", "-0.9754 A", INK),
        ("차이 (mismatch)", "-0.0000 A", GOOD),
    ]
    yy = py + 84
    for i, (k, v, col) in enumerate(rows):
        hl = (i == 2)
        b.append(rect(x + 16, yy, pw - 32, 46, BG if not hl else "#ecfdf5",
                      GOOD if hl else LINE, 6, 1.6 if hl else 1.2))
        b.append(text(x + 30, yy + 29, k, 12.5, MUTED if not hl else GOOD,
                      "normal" if not hl else "bold"))
        b.append(text(x + pw - 30, yy + 29, v, 14.5, col, "bold", "end", MONO))
        yy += 54

    b.append(line(x + 16, yy + 6, x + pw - 16, yy + 6, LINE, 1.2, "5 4"))
    b.append(text(x + 16, yy + 36, "독립 계기 비교 — 18650 b1", 12.5, INK, "bold"))
    rows2 = [("BW150 방전기", "2,406 mAh"), ("INA226 적분", "2,362 mAh")]
    yy += 48
    for k, v in rows2:
        b.append(text(x + 30, yy + 20, k, 12, MUTED))
        b.append(text(x + pw - 30, yy + 20, v, 13, INK, "bold", "end", MONO))
        yy += 28
    b.append(rect(x + 16, yy + 8, pw - 32, 42, BG, GOOD, 8, 1.6))
    b.append(text(x + 32, yy + 35, "두 계기 편차 1.9%", 16, GOOD, "bold"))

    # ── 3. 인자 반응 단조성 ──────────────────────────────────────────
    x = px[2]
    b += panel(x, py, pw, ph, "③ 인자 반응 단조성", "PB-20000 · CC · 전류만 바꿈")
    pts = [("1A", 71.9), ("2A", 71.0), ("3A", 66.7)]
    gx, gy, gw, gh = x + 60, py + 92, pw - 96, 244
    lo, hi = 64.0, 74.0
    b.append(rect(gx, gy, gw, gh, BG, LINE, 6, 1.2))
    for v in (66, 68, 70, 72, 74):
        ly = gy + gh - (v - lo) / (hi - lo) * gh
        b.append(line(gx, ly, gx + gw, ly, "#eef0f3", 1))
        b.append(text(gx - 10, ly + 4, "%d" % v, 11, MUTED, "normal", "end", MONO))
    coords = []
    for i, (nm, v) in enumerate(pts):
        cx = gx + gw * (i + 0.5) / 3.0
        cy = gy + gh - (v - lo) / (hi - lo) * gh
        coords.append((cx, cy))
        b.append(text(cx, gy + gh + 24, nm, 13, MUTED, "normal", "middle", MONO))
    b.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="3"/>'
             % (" ".join("%.1f,%.1f" % c for c in coords), BAD))
    for (cx, cy), (nm, v) in zip(coords, pts):
        b.append('<circle cx="%.1f" cy="%.1f" r="7" fill="%s"/>' % (cx, cy, BAD))
        b.append(text(cx, cy - 18, "%.1f%%" % v, 14, INK, "bold", "middle", MONO))
    b.append(text(x + 16, py + 84, "전달률 [%]  (라벨 74.0 Wh 대비)", 11.5, MUTED))
    b.append(rect(x + 16, gy + gh + 44, pw - 32, 64, BG, LINE, 8, 1.4))
    b.append(text(x + 32, gy + gh + 70, "전류가 오를수록 단조 감소", 15, INK, "bold"))
    b.append(text(x + 32, gy + gh + 94, "세 팩 모두 같은 방향 — 우연이 아니다",
                  11.5, MUTED))

    # ── 하단 : 측정계가 지배 오차인 구간 ─────────────────────────────
    by = py + ph + 22
    b.append(rect(24, by, W - 48, 172, WARNBG, WARN, 10, 1.8))
    b.append(text(48, by + 34, "④ 측정계가 지배 오차인 구간은 결론을 내지 않았다",
                  17, WARN, "bold"))
    b.append(text(48, by + 62,
                  "같은 팩(PB-10000)에서 평균 전력이 0.2% 밖에 차이 나지 않는 두 run 의 "
                  "발열이 3.4배로 벌어졌다.", 13.5, INK))

    cols = [("r5  CC 2A", "9.231 W", "발열 12.510"),
            ("c6  CP 9W", "9.215 W", "발열  3.633")]
    for i, (a, c, d) in enumerate(cols):
        cx = 48 + i * 300
        b.append(text(cx, by + 92, a, 13, INK, "bold", "start", MONO))
        b.append(text(cx + 120, by + 92, c, 13, MUTED, "normal", "start", MONO))
        b.append(text(cx + 210, by + 92, d, 13, BAD, "bold", "start", MONO))

    b.append(text(48, by + 124,
                  "전력이 같으니 발열도 같아야 한다 → 차이는 적외선 겨냥 오차다. "
                  "측정 불확실도가 측정 대상보다 크므로,", 13, MUTED))
    b.append(text(48, by + 148,
                  "표면에 검정테이프로 겨냥을 고정하기 전까지 열 관련 정량 주장은 "
                  "보류했다. 전기 데이터는 영향 없다 (재현성 7.1%).", 13, MUTED))

    body = "".join(b)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
            'width="%g" height="%g"><rect width="%g" height="%g" fill="%s"/>%s</svg>'
            % (W, H, W, H, W, H, BG, body))


def main():
    p = os.path.join(HERE, "cap30_reliability.svg")
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(build())
    print("생성: cap30_reliability.svg  (1360x707, 슬롯 652x339pt 비율)")


if __name__ == "__main__":
    main()
