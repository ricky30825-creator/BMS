#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
6/23 회의 발표자료-정재환 을 편집 가능한 PPTX(네이티브 도형)로 생성한다.
- 모든 요소가 PowerPoint/Keynote에서 직접 편집 가능한 도형(사각형/텍스트박스)으로 구성.
- 기존 발표자료(5:18 …) 스타일: 네이비 상단 바, 페이지번호, 큰 네이비 제목, 좌측 텍스트 + 우측 표/카드.
출력: 발표자료/6:23 회의 발표자료-정재환.pptx
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "발표자료", "6:23 회의 발표자료-정재환.pptx")

# ---- 색상 ----
NAVY  = RGBColor(0x0A, 0x2A, 0x8C)
BLUE  = RGBColor(0x1F, 0x5F, 0xD6)
LBLUE = RGBColor(0xEA, 0xF0, 0xFB)
LBLUE2= RGBColor(0xE4, 0xEC, 0xF8)
ZEBRA = RGBColor(0xF7, 0xF9, 0xFD)
ORANGE= RGBColor(0xE0, 0x7B, 0x1E)
RED   = RGBColor(0xC0, 0x39, 0x2B)
GREEN = RGBColor(0x1F, 0x8A, 0x4C)
INK   = RGBColor(0x22, 0x22, 0x22)
DARK  = RGBColor(0x33, 0x33, 0x33)
GRAY  = RGBColor(0x6B, 0x6B, 0x6B)
CAPTX = RGBColor(0x77, 0x77, 0x77)
CAPBG = RGBColor(0xF1, 0xF1, 0xF4)
LINE  = RGBColor(0xD8, 0xDD, 0xE8)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHTT= RGBColor(0xCD, 0xD6, 0xEE)
CODEBG= RGBColor(0x0F, 0x1B, 0x3D)
CODETX= RGBColor(0xDF, 0xE6, 0xF7)
CODEC = RGBColor(0x7F, 0x8F, 0xB5)
CODEK = RGBColor(0x9F, 0xC1, 0xFF)
FOOTC = RGBColor(0x9A, 0x9A, 0x9A)

KFONT = "Apple SD Gothic Neo"
MONO  = "Menlo"

# ---- 레이아웃 ----
SW, SH = 13.333, 7.5
LM, RM = 0.7, 0.55
CR = SW - RM
CW = CR - LM
GAP = 0.55
LCW = (CW - GAP) / 2.0
RX  = LM + LCW + GAP

prs = Presentation()
prs.slide_width  = Inches(SW)
prs.slide_height = Inches(SH)
BLANK = prs.slide_layouts[6]


# ---------- 헬퍼 ----------
def kfont(run, name=KFONT):
    run.font.name = name
    rPr = run.font._rPr
    for tag in ('a:ea', 'a:cs'):
        e = rPr.find(qn(tag))
        if e is None:
            e = rPr.makeelement(qn(tag), {}); rPr.append(e)
        e.set('typeface', name)


def rect(slide, x, y, w, h, fill=None, line=None, lw=1.0, rounded=False, radius=0.06):
    st = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    sp = slide.shapes.add_shape(st, Inches(x), Inches(y), Inches(w), Inches(h))
    if rounded:
        try: sp.adjustments[0] = radius
        except Exception: pass
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line; sp.line.width = Pt(lw)
    sp.shadow.inherit = False
    sp.text_frame.word_wrap = True
    sp.text_frame.paragraphs[0].text = ""
    return sp


def _norm(paras):
    """paras -> list[ list[ (text,bold,color,size) ] ]
    각 단락은 str / run-tuple / [str|run-tuple, ...] 형태를 허용."""
    out = []
    for p in paras:
        if isinstance(p, str):
            out.append([(p, None, None, None)])
        elif isinstance(p, tuple):
            out.append([p])
        elif isinstance(p, list):
            runs = []
            for e in p:
                if isinstance(e, str):
                    runs.append((e, None, None, None))
                else:
                    runs.append(e)
            out.append(runs)
        else:
            out.append([(str(p), None, None, None)])
    return out


def text(slide, x, y, w, h, paras, size=12, color=INK, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, wrap=True,
         font=KFONT, sa=4, ls=None):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, runs in enumerate(_norm(paras)):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_before = Pt(0)
        p.space_after = Pt(sa)
        if ls: p.line_spacing = ls
        for (t, b, c, s) in runs:
            r = p.add_run(); r.text = t
            r.font.size = Pt(s if s else size)
            r.font.bold = (b if b is not None else bold)
            r.font.color.rgb = (c if c else color)
            kfont(r, font)
    return tb


def topbar(slide, n):
    rect(slide, LM, 0.5, CW, 0.055, fill=NAVY)
    text(slide, CR - 0.6, 0.24, 0.6, 0.22, [str(n)], size=11, color=RGBColor(0x55,0x55,0x55),
         align=PP_ALIGN.RIGHT)


def title(slide, t):
    text(slide, LM, 0.72, CW, 0.7, [[(t, True, NAVY, 26)]], anchor=MSO_ANCHOR.MIDDLE)


def lead(slide, x, y, w, paras, h=0.7):
    text(slide, x, y, w, h, paras, size=12.5, color=DARK, ls=1.18, sa=2)


def sec_h(slide, x, y, w, label):
    text(slide, x, y, w, 0.3, [[(label, True, NAVY, 13.5)]])


def caption(slide, x, y, w, s, h=0.34):
    rect(slide, x, y, w, h, fill=CAPBG, rounded=True, radius=0.08)
    text(slide, x, y, w, h, [[(s, None, CAPTX, 10.5)]], align=PP_ALIGN.CENTER,
         anchor=MSO_ANCHOR.MIDDLE)


def footer(slide, s):
    rect(slide, LM, 7.04, CW, 0.012, fill=RGBColor(0xEE,0xEE,0xEE))
    text(slide, LM, 7.08, CW, 0.3, [[(s, None, FOOTC, 8)]], ls=1.1)


def card(slide, x, y, w, h, t, body, accent=NAVY, bg=LBLUE):
    rect(slide, x, y, w, h, fill=bg, rounded=True, radius=0.04)
    rect(slide, x, y, 0.07, h, fill=accent)
    text(slide, x + 0.2, y + 0.11, w - 0.32, 0.3, [[(t, True, accent, 12.5)]])
    text(slide, x + 0.2, y + 0.44, w - 0.32, h - 0.5, body, size=10.8, color=DARK, ls=1.12, sa=1)


def grid(slide, x, y, col_w, rows, header_h=0.42, body_h=0.46, fs=10.5):
    """rows[0]=header(list of cell run-lists). 본문 행 zebra. 셀 = 텍스트박스(편집 가능)."""
    total_w = sum(col_w)
    # 헤더
    rect(slide, x, y, total_w, header_h, fill=NAVY)
    cx = x
    for j, w in enumerate(col_w):
        text(slide, cx + 0.1, y, w - 0.16, header_h, rows[0][j], size=fs, color=WHITE,
             bold=True, anchor=MSO_ANCHOR.MIDDLE, ls=1.05)
        cx += w
    # 본문
    cy = y + header_h
    for i, row in enumerate(rows[1:]):
        fill = ZEBRA if (i % 2 == 1) else WHITE
        rect(slide, x, cy, total_w, body_h, fill=fill)
        rect(slide, x, cy + body_h - 0.012, total_w, 0.012, fill=LINE)  # 하단 라인
        cx = x
        for j, w in enumerate(col_w):
            text(slide, cx + 0.1, cy, w - 0.16, body_h, row[j], size=fs, color=DARK,
                 anchor=MSO_ANCHOR.MIDDLE, ls=1.05)
            cx += w
        cy += body_h
    return cy  # 표 하단 y


def bullets(slide, x, y, w, h, items, size=12, gap=7, color=DARK):
    """items: list of run-lists. 사각 불릿(■) prepend."""
    paras = []
    for it in items:
        runs = it if isinstance(it, list) else [it]
        paras.append([("■  ", None, NAVY, size - 2)] + [
            (t, b, c, s) for (t, b, c, s) in _norm([runs])[0]
        ])
    text(slide, x, y, w, h, paras, size=size, color=color, ls=1.2, sa=gap)


def R(t, b=None, c=None, s=None):
    return (t, b, c, s)


def slide():
    return prs.slides.add_slide(BLANK)


# ============================================================
# 1. 표지
# ============================================================
s = slide()
rect(s, 0, 0, SW, SH, fill=WHITE)
text(s, SW - 2.4, 0.55, 1.9, 0.3, [["2026.6.23_V1"]], size=12, color=RGBColor(0x44,0x44,0x44),
     align=PP_ALIGN.RIGHT)
rect(s, 0, 3.45, SW, 2.6, fill=NAVY)
text(s, 0, 2.35, SW, 0.9, [[("6/23 회의 발표자료", True, NAVY, 44)]], align=PP_ALIGN.CENTER,
     anchor=MSO_ANCHOR.MIDDLE)
text(s, 0, 3.35, SW, 0.8, [[("- 정재환", True, LIGHTT, 34)]], align=PP_ALIGN.CENTER,
     anchor=MSO_ANCHOR.MIDDLE)

# ============================================================
# 2. 목차
# ============================================================
s = slide(); topbar(s, 2)
text(s, LM, 1.15, 3.6, 0.9, [[("목차", True, NAVY, 40)]])
text(s, LM, 2.05, 3.6, 0.3, [[("Table of Contents", None, BLUE, 13)]])
text(s, LM, 3.0, 3.8, 0.8,
     [[("주제 :  ", None, GRAY, 12)], [("음향 기반 열폭주 조기감지", True, NAVY, 12.5)],
      [("센서 도입 검토", True, NAVY, 12.5)]], ls=1.3)
# 우측 항목
rx, rtop = 5.9, 1.2
rect(s, rx, rtop, 0.025, 3.0, fill=NAVY)
items = [
    ("01", "배경과 한계", "현재 센서 구성이 놓치는 구간", "3p"),
    ("02", "음향 조기감지 원리", "벤팅음 · 내부 탄성파(AE)", "5p"),
    ("03", "신뢰성 근거", "특허 KR102254734B1 · 논문", "7p"),
    ("04", "적용 방안", "센서 후보 · 시스템 통합", "10p"),
    ("05", "선택 가능한 옵션", "회의 의사결정", "11p"),
]
iy = rtop + 0.05
ix = rx + 0.45
iw = CR - ix
for num, nm, sub, pg in items:
    text(s, ix, iy, iw - 0.7, 0.4,
         [[(num + "  ", True, NAVY, 16), (nm, True, NAVY, 16), ("   " + sub, None, GRAY, 11.5)]],
         anchor=MSO_ANCHOR.MIDDLE)
    text(s, CR - 0.7, iy, 0.7, 0.4, [[(pg, None, RGBColor(0x9A,0xA3,0xB8), 12)]],
         align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
    rect(s, ix, iy + 0.52, iw, 0.01, fill=RGBColor(0xEE,0xEE,0xEE))
    iy += 0.62

# ============================================================
# 3. 열폭주 과정 요약 + 센서별 감지 시작 단계
# ============================================================
s = slide(); topbar(s, 3)
title(s, "열폭주 1단계부터 감지 — 음향이 더 직접적·강건하다")
lead(s, LM, 1.5, CW,
     [[("열폭주는 온도 상승과 함께 ", None, DARK, 12.5), ("비가역적으로", True, NAVY, 12.5),
       (" 진행된다. 현재 센서도 ", None, DARK, 12.5), ("온도 변화율(dT/dt)", True, NAVY, 12.5),
       ("로 1단계부터 감지 가능하나, 음향은 같은 1단계를 ", None, DARK, 12.5),
       ("더 직접·강건하게", True, NAVY, 12.5), (" 잡는다.", None, DARK, 12.5)]], h=0.4)

# --- 열폭주 5단계 박스 (과정·온도) ---
stages = [
    ("정상",   ["안정 상태"],                      "상온",        RGBColor(0x6B,0x7A,0x99)),
    ("1단계", ["SEI 분해", "내부 미세 균열·초기 가스"], "약 80~120°C", RGBColor(0x2E,0x62,0xC9)),
    ("2단계", ["분리막 용융·내부 단락", "off-gas·스웰링"], "120~250°C",  RGBColor(0xE0,0x7B,0x1E)),
    ("3단계", ["양극 분해·산소 방출", "대규모 발열·벤팅"], "250°C 이상", RGBColor(0xC0,0x39,0x2B)),
    ("4단계", ["열폭주·발화", "화재·폭발"],          "700~1000°C", RGBColor(0x7A,0x14,0x14)),
]
ns = len(stages); aw = 0.3
bw = (CW - (ns - 1) * aw) / ns
by = 2.05; bh = 1.2
bx = []
cx = LM
for i, (t1, chem, temp, col) in enumerate(stages):
    bx.append(cx)
    rect(s, cx, by, bw, bh, fill=col, rounded=True, radius=0.05)
    paras = [[(t1, True, WHITE, 13)]] + [[(ln, None, WHITE, 9.5)] for ln in chem]
    text(s, cx + 0.05, by + 0.1, bw - 0.1, 0.78, paras, align=PP_ALIGN.CENTER,
         anchor=MSO_ANCHOR.TOP, ls=1.05, sa=1)
    text(s, cx + 0.05, by + bh - 0.3, bw - 0.1, 0.24, [[(temp, True, WHITE, 9.5)]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    if i < ns - 1:
        text(s, cx + bw, by, aw, bh, [["›"]], size=18, color=RGBColor(0x9A,0xA3,0xB8),
             bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    cx += bw + aw
right_edge = bx[-1] + bw

# --- 감지 시작 막대 (어느 단계부터 감지하는가) ---
# 음향 = 1단계부터 직접 감지 (위)
ay1 = 3.6
rect(s, bx[1], ay1, right_edge - bx[1], 0.52, fill=RGBColor(0xE3,0xF4,0xE8), line=GREEN, lw=1.25, rounded=True, radius=0.06)
rect(s, bx[1], ay1, 0.07, 0.52, fill=GREEN)
text(s, bx[1] + 0.2, ay1, right_edge - bx[1] - 0.32, 0.52,
     [[("1단계부터 직접 감지(내부 균열·기포 탄성파) · ", None, DARK, 11), ("open에서도 강건", True, GREEN, 11)]],
     anchor=MSO_ANCHOR.MIDDLE)
# 좌측 행 라벨(센서명) — 막대 옆 캡션
text(s, LM, ay1, bx[1] - LM - 0.14, 0.52,
     [[("음향센서", True, GREEN, 11)], [("신규 검토", None, GRAY, 8.5)]],
     align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE, ls=1.05, sa=0)

# 현재 계획 센서 = 1단계 약신호(dT/dt) → 2단계 실질 (아래, 2구간)
ay2 = 4.3
rect(s, bx[1], ay2, right_edge - bx[1], 0.52, fill=RGBColor(0xEC,0xF1,0xFB), line=NAVY, lw=1.25, rounded=True, radius=0.06)
rect(s, bx[1], ay2, bx[2] - bx[1], 0.52, fill=RGBColor(0xF6,0xF8,0xFD))          # 약신호 구간(1단계)
rect(s, bx[1], ay2, 0.07, 0.52, fill=RGBColor(0xA9,0xB4,0xCE))                   # 약신호 accent(흐림)
text(s, bx[1] + 0.14, ay2, bx[2] - bx[1] - 0.22, 0.52,
     [[("1단계: dT/dt 조기 감지", True, NAVY, 8.5)], [("(변화율·신호 약함)", None, GRAY, 8.5)]],
     align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, ls=1.0, sa=0)
rect(s, bx[2] - 0.011, ay2, 0.022, 0.52, fill=NAVY)                             # 구분선
rect(s, bx[2], ay2, 0.07, 0.52, fill=NAVY)                                      # 실질 accent
text(s, bx[2] + 0.2, ay2, right_edge - bx[2] - 0.32, 0.52,
     [[("2단계(온도 급상승)부터 ", None, DARK, 11), ("실질·신뢰 감지", True, NAVY, 11)]],
     anchor=MSO_ANCHOR.MIDDLE)
# 좌측 행 라벨(센서명) — 막대 옆 캡션
text(s, LM, ay2, bx[1] - LM - 0.14, 0.52,
     [[("현재 계획 센서", True, NAVY, 11)], [("전압·전류·온도·SOC·절연저항", None, GRAY, 8.5)]],
     align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE, ls=1.05, sa=0)

caption(s, LM, 5.15, CW,
        "1단계는 dT/dt로도 조기 감지 가능하나 open·표면 측정상 신호가 약함 → 음향(직접 신호)으로 보완·교차검증해 신뢰도↑")
footer(s, "단계·온도는 일반적 리튬이온 열폭주 메커니즘 기준. 현재 센서는 LSTM-AE가 dT/dt·d²T/dt² 변화율 특징을 학습 → 1단계 미세 발열도 원리상 감지하나, open·표면 측정상 신뢰도는 신호 세기에 의존.")

# ============================================================
# 4. 전조 타임라인
# ============================================================
s = slide(); topbar(s, 4)
title(s, '음향은 "가스가 새기 전"부터 "벤팅음"까지 포괄한다')
lead(s, LM, 1.5, CW,
     [[("열폭주 전조는 아래 순서로 진행된다. ", None, DARK, 12.5), ("음향 신호", True, NAVY, 12.5),
       ("는 내부 탄성파(가장 이른 축)부터 벤팅음까지 넓은 구간을 덮어, 온도 기반 탐지보다 앞설 수 있다.", None, DARK, 12.5)]], h=0.5)
# 타임라인
steps = [
    ("①", "전압·내부저항\n변화", RGBColor(0x2E,0x62,0xC9)),
    ("②", "off-gas\n방출", RGBColor(0xE0,0x7B,0x1E)),
    ("③", "셀 스웰링\n(팽창)", RGBColor(0xE0,0x99,0x1E)),
    ("④", "표면 온도\n급상승", RGBColor(0xD9,0x62,0x2A)),
    ("⑤", "벤팅\n(안전밸브)", RGBColor(0xC0,0x39,0x2B)),
    ("⑥", "발화·\n폭발", RGBColor(0x7A,0x14,0x14)),
]
n = len(steps); aw = 0.32
sw_ = (CW - (n - 1) * aw) / n
ty = 2.15; th = 1.0
cx = LM
for i, (num, lab, col) in enumerate(steps):
    rect(s, cx, ty, sw_, th, fill=col, rounded=True, radius=0.05)
    l1, l2 = lab.split("\n")
    text(s, cx, ty, sw_, th, [[(num, True, WHITE, 13)], [(l1, True, WHITE, 11)], [(l2, None, WHITE, 11)]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, ls=1.05, sa=1)
    if i < n - 1:
        text(s, cx + sw_, ty, aw, th, [["›"]], size=18, color=RGBColor(0x9A,0xA3,0xB8),
             bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    cx += sw_ + aw
# 두 카드
cy = 3.55; ch = 1.0
card(s, LM, cy, LCW, ch, "현재 우리 시스템이 잡는 구간",
     [[("대체로 ", None, DARK, 10.8), ("② off-gas ~ ④ 온도 급상승", True, NAVY, 10.8),
       (". 신호가 뚜렷해질 때는 이미 부반응이 상당히 진행.", None, DARK, 10.8)]],
     accent=ORANGE, bg=RGBColor(0xFC,0xF1,0xE2))
card(s, RX, cy, LCW, ch, "음향이 잡는 구간",
     [[("내부 탄성파(① 부근의 분리막 균열·기포 생성)", True, NAVY, 10.8),
       ("부터 ⑤ 벤팅음까지. → 더 이른 경보 가능.", None, DARK, 10.8)]])
caption(s, LM, cy + ch + 0.2, CW, "[열폭주 전조 타임라인과 신호 채널별 커버리지]")

# ============================================================
# 5. open 환경 특수성
# ============================================================
s = slide(); topbar(s, 5)
title(s, '우리는 "밀폐 팩"이 아니라 "개방 공간"에서 측정한다')
lead(s, LM, 1.5, LCW,
     [[("대상은 ", None, DARK, 12.5), ("개방(open) 공간의 18650 셀·USB 보조배터리", True, NAVY, 12.5),
       ("다. ESS·EV처럼 셀이 밀폐 팩 안에 있지 않다. 이 차이가 센서 선택을 가른다.", None, DARK, 12.5)]], h=0.9)
bullets(s, LM, 2.6, LCW, 3.0, [
    [R("가스센서", True, NAVY), R(": 밀폐 팩은 off-gas가 축적되지만 open에서는 즉시 "), R("확산·희석", True, NAVY),
     R(" → 농도↓, 기류 의존 → 강점 약화")],
    [R("음향(벤팅음)", True, NAVY), R(": 공기 중 음파라 거리·개방 영향이 작고, "), R("MW급 ESS 현장", True, NAVY),
     R("에서 검증된 방식")],
    [R("결론: open 환경에서는 "), R("가스보다 음향이 비용 대비 효용·재현성에서 유리", True, NAVY)],
], size=12.5, gap=9)
sec_h(s, RX, 1.5, LCW, "open 환경 적합성 비교")
ge = grid(s, RX, 1.9, [1.7, 2.0, 2.066], [
    [[R("항목")], [R("가스센서")], [R("음향(벤팅음)")]],
    [[R("신호 매질")], [R("가스 농도(확산)")], [R("공기 중 음파")]],
    [[R("개방 공간 적합성")], [R("낮음", True, RED), R(" (희석)")], [R("높음", True, GREEN)]],
    [[R("거리 민감도")], [R("큼")], [R("상대적으로 작음")]],
    [[R("현장 검증")], [R("주로 밀폐 캐비닛")], [R("MW급 ESS 검증", True, GREEN)]],
    [[R("응답 속도")], [R("수초~분")], [R("ms 수준", True, GREEN)]],
], body_h=0.44)
caption(s, RX, ge + 0.12, LCW, "검증 사례: 8p 논문 근거 참조")

# ============================================================
# 6. 음향 원리
# ============================================================
s = slide(); topbar(s, 6)
title(s, "음향 기반 감지는 두 갈래다 — 듣기(AE) vs 거리측정")
lead(s, LM, 1.5, CW,
     [[('"음향 센서"는 크게 두 방식으로 나뉜다. 우리가 원하는 것은 ', None, DARK, 12.5),
       ("소리를 듣는(수동) 방식", True, NAVY, 12.5), ("이다.", None, DARK, 12.5)]], h=0.4)
# 좌측 두 갈래
by = 2.1
rect(s, LM, by, LCW, 1.25, fill=RGBColor(0xF5,0xF8,0xFE), line=RGBColor(0xC9,0xD6,0xF3), lw=1, rounded=True, radius=0.03)
text(s, LM + 0.2, by + 0.13, LCW - 0.4, 0.3, [[("(A) 벤팅·안전밸브 파열음 — 수동 마이크", True, NAVY, 12.5)]])
text(s, LM + 0.2, by + 0.48, LCW - 0.4, 0.7,
     [[("셀이 부풀다 안전밸브가 터질 때 나는 \"쉭/팡\" 소리를 마이크로 청취. ", None, DARK, 10.8),
       ("open 공간에 적합", True, NAVY, 10.8), (", 라즈베리파이 직결 가능. 단 벤팅(⑤)이라 다소 늦은 신호.", None, DARK, 10.8)]], ls=1.15)
by2 = by + 1.45
rect(s, LM, by2, LCW, 1.35, fill=RGBColor(0xF5,0xF8,0xFE), line=RGBColor(0xC9,0xD6,0xF3), lw=1, rounded=True, radius=0.03)
text(s, LM + 0.2, by2 + 0.13, LCW - 0.4, 0.3, [[("(B) 내부 균열·기포 탄성파 — 접촉 AE(음향방출)", True, NAVY, 12.5)]])
text(s, LM + 0.2, by2 + 0.48, LCW - 0.4, 0.8,
     [[("셀 내부 ", None, DARK, 10.8), ("분리막 균열·가스 기포", True, NAVY, 10.8),
       ("의 초음파(~100kHz↑)를 표면 압전 소자로 포착. ", None, DARK, 10.8),
       ("가스가 새기 전 감지", True, NAVY, 10.8), (" → 가장 빠른 축. 난이도 높음.", None, DARK, 10.8)]], ls=1.15)
# 우측 오해 정정 + 정리
card(s, RX, 2.1, LCW, 1.45, "⚠ 흔한 오해 정정",
     [[('시중의 "초음파 센서(HC-SR04)"는 펄스를 ', None, DARK, 10.8), ("쏘고 반향 시간을 재는 거리측정(소나)", True, RED, 10.8),
       (" 장치로, ", None, DARK, 10.8), ("소리를 듣는 센서가 아니다", True, RED, 10.8),
       (". 굳이 쓴다면 스웰링(팽창) 거리 측정용으로만 의미.", None, DARK, 10.8)]],
     accent=RED, bg=RGBColor(0xFD,0xEC,0xEC))
card(s, RX, 3.7, LCW, 0.95, "정리",
     [[("전조음 탐지 = ", None, DARK, 10.8), ("수동 청취형", True, NAVY, 10.8), ("(마이크 / AE 압전).", None, DARK, 10.8)],
      [("거리측정 초음파 모듈은 별개 용도.", None, DARK, 10.8)]])
caption(s, RX, 4.8, LCW, "[수동 청취(AE/마이크) vs 능동 거리측정(소나) 구분]")

# ============================================================
# 7. 신뢰성 ① 특허
# ============================================================
s = slide(); topbar(s, 7)
title(s, "신뢰성 ① — 국내 등록특허가 같은 접근을 검증한다")
text(s, LM, 1.55, LCW, 0.6,
     [[("KR102254734B1", True, NAVY, 14)],
      [("「음향을 이용한 ESS 배터리의 화재 조기 감지 장치 및 방법」", None, DARK, 11.5)]], ls=1.25)
ge = grid(s, LM, 2.4, [1.7, LCW - 1.7], [
    [[R("항목")], [R("내용")]],
    [[R("등록번호")], [R("KR 10-2254734 B1")]],
    [[R("권리자")], [R("(주)인텍에프에이 · 임건표")]],
    [[R("출원일")], [R("2020. 10. 21.")]],
    [[R("등록일")], [R("2021. 05. 24.")]],
], body_h=0.46)
text(s, LM, ge + 0.18, LCW, 0.5,
     [[("→ 음향을 1차 신호로 쓰는 조기감지가 ", None, DARK, 11), ("국내에서 권리화된 검증된 접근", True, NAVY, 11),
       ("임을 보여준다.", None, DARK, 11)]], ls=1.2)
sec_h(s, RX, 1.55, LCW, "청구항 핵심 구성")
card(s, RX, 1.95, LCW, 0.95, "① 센서부 — 복합 감지",
     [[("배터리 셀의 ", None, DARK, 10.8), ("가스", True, NAVY, 10.8), (", 가스 배출 시 ", None, DARK, 10.8),
       ("음향", True, NAVY, 10.8), (", 화재 시 ", None, DARK, 10.8), ("광·온도 변화", True, NAVY, 10.8),
       ("를 함께 감지", None, DARK, 10.8)]])
card(s, RX, 3.05, LCW, 0.85, "② 분석부 — 필터링",
     [[("각 아날로그 신호를 ", None, DARK, 10.8), ("설정 필터링 파라미터", True, NAVY, 10.8),
       ("로 필터링하여 필터링 정보 생성", None, DARK, 10.8)]])
card(s, RX, 4.05, LCW, 0.85, "③ 판정 — 화재 단계",
     [[("필터링 정보를 종합해 ", None, DARK, 10.8), ("화재 발생 단계를 판단", True, NAVY, 10.8),
       ("하고 경보", None, DARK, 10.8)]])
caption(s, RX, 5.05, LCW, "우리의 멀티모달(전압·온도 + 음향) + AI 단계 판정 방향과 정합")
footer(s, "출처: Google Patents KR102254734B1 (https://patents.google.com/patent/KR102254734B1/ko)")

# ============================================================
# 8. 신뢰성 ② 논문
# ============================================================
s = slide(); topbar(s, 8)
title(s, "신뢰성 ② — 음향 조기경보는 다수 논문으로 뒷받침된다")
lead(s, LM, 1.5, CW,
     [[("최근 연구들은 ", None, DARK, 12.5), ("벤팅 음향 신호", True, NAVY, 12.5),
       ("가 빠르고 민감하며 저비용의 조기경보 수단임을 반복적으로 보고한다.", None, DARK, 12.5)]], h=0.4)
ge = grid(s, LM, 2.05, [5.0, 3.2, CW - 8.2], [
    [[R("연구 (핵심 내용)")], [R("출처 · 연도")], [R("시사점")]],
    [[R("MW급 ESS station 벤팅 음향 안전경보 — 4센서 음원 위치추정, "), R("ms급 응답", True, NAVY)],
     [R("J. of Energy Storage, 2021")], [R("현장(grid) 규모 검증")]],
    [[R("벤팅 음향 신호의 시간-주파수 인식")], [R("J. of Energy Storage, 2025")], [R("신호처리로 오탐 저감")]],
    [[R("음향 신호 멀티모달 융합 기반 조기경보")], [R("J. of Energy Storage, 2025")], [R("우리 방향과 동일")]],
    [[R("열폭주 초기 이상음 탐지·위치추정")], [R("연구논문, 2025")], [R("초기 음향의 유효성")]],
    [[R("BESS 열폭주 조기경보 기술 종설")], [R("Adv. Sensor Research, 2025")], [R("주요 모달리티로 정리")]],
    [[R("(대비) 반도체 가스센서의 초기 열폭주 가스 탐지")], [R("PMC(논문), 2025")], [R("드리프트·환경 의존 한계")]],
], body_h=0.5, fs=10)
caption(s, LM, ge + 0.12, CW,
        "공통 결론: 음향은 빠르고(ms)·민감하며·저비용인 조기경보 채널 — 단일 신호보다 융합 시 오탐 감소")
footer(s, "출처: ScienceDirect(J. Energy Storage) S2352152X21002474 / S2352152X25049734 / S2352152X25032104 · ResearchGate 398171567 · Adv. Sensor Research 10.1002/adsr.202400165 · PMC12006763")

# ============================================================
# 9. 신뢰성 ③ 음향 진단 계보
# ============================================================
s = slide(); topbar(s, 9)
title(s, "신뢰성 ③ — 음향은 이미 배터리 진단의 검증된 모달리티다")
lead(s, LM, 1.5, LCW,
     [[("화재 경보뿐 아니라 ", None, DARK, 12.5), ("배터리 내부 상태 진단", True, NAVY, 12.5),
       ("에도 음향(초음파)이 학계에서 정립되어 왔다. 신호의 물리적 근거가 탄탄하다.", None, DARK, 12.5)]], h=0.8)
bullets(s, LM, 2.5, LCW, 3.0, [
    [R("리튬 삽입·가스 발생으로 셀 내부 "), R("밀도·탄성률", True, NAVY), R("이 변하면 "), R("음속·반향(ToF)", True, NAVY),
     R("이 변한다 → 비침습 진단")],
    [R("이 원리는 "), R("SOC·SOH 추정", True, NAVY), R("에 활용되며 다수 후속 연구로 확장")],
    [R("즉 음향은 "), R("물리적으로 검증된 신호원", True, NAVY), R(" → AI 입력 특징으로 정당성 충분")],
], size=12.5, gap=9)
sec_h(s, RX, 1.5, LCW, "음향 진단 핵심 계보")
card(s, RX, 1.9, LCW, 0.95, "전기화학-음향 ToF (Steingart 그룹)",
     [[("in-operando로 충전상태·열화를 음향 반향으로 추적. ", None, DARK, 10.8)],
      [("Energy & Environmental Science, 2015", None, GRAY, 10)]])
card(s, RX, 2.98, LCW, 0.95, "음향 ToF 기반 SOC·SOH 추정",
     [[("음향 지표 + 전압을 머신러닝으로 결합해 상태 추정. ", None, DARK, 10.8)],
      [("J. Electrochem. Soc., 2017", None, GRAY, 10)]])
card(s, RX, 4.06, LCW, 0.8, "비침습 초음파 건전성 진단",
     [[("셀을 열지 않고 내부 구조·SOC 진단 (리뷰·후속 다수)", None, DARK, 10.8)]])
caption(s, RX, 5.0, LCW, "AE/초음파 = 내부 상태까지 보는 검증된 채널")
footer(s, "출처: Hsieh et al., Energy Environ. Sci., 2015 · SOC/SOH via Electrochemical-Acoustic ToF, J. Electrochem. Soc., 2017 (IOP 10.1149/2.1411712jes)")

# ============================================================
# 10. 적용 방안
# ============================================================
s = slide(); topbar(s, 10)
title(s, "적용 방안 — 센서 후보와 시스템 통합")
sec_h(s, LM, 1.5, LCW, "센서 후보 비교")
ge = grid(s, LM, 1.9, [1.5, 2.13, 2.13], [
    [[R("항목")], [R("MEMS I2S 마이크")], [R("접촉 AE 피에조")]],
    [[R("잡는 신호")], [R("벤팅 \"쉭/팡\"음")], [R("내부 균열·기포 초음파")]],
    [[R("Pi 연동")], [R("I2S 직결", True, GREEN)], [R("보조MCU+고속ADC")]],
    [[R("신호 시점")], [R("⑤ 벤팅(늦음)")], [R("① 내부(가장 빠름)", True, GREEN)]],
    [[R("난이도")], [R("낮음", True, GREEN)], [R("높음", True, RED)]],
    [[R("예시")], [R("SPH0645 / INMP441")], [R("압전 디스크 + 앰프")]],
], body_h=0.44, fs=10)
text(s, LM, ge + 0.16, LCW, 0.5,
     [[("난이도를 감수한다면 둘을 ", None, DARK, 10.8), ("병행", True, NAVY, 10.8),
       ("해 내부(AE)→벤팅(마이크)을 모두 커버하는 구성이 이상적.", None, DARK, 10.8)]], ls=1.15)
sec_h(s, RX, 1.5, LCW, "파이프라인 통합 (기존 구조 유지)")
bullets(s, RX, 1.92, LCW, 1.8, [
    [R("스키마", True, NAVY), R(": battery-raw-metrics에 음향 파생 필드만 확장 (Kafka 무변경)")],
    [R("AI 특징", True, NAVY), R(": 기존 7개에 음향 에너지·대역 RMS·이벤트율을 100ms 윈도우 집계로 추가")],
    [R("대시보드", True, NAVY), R(': "음향 이벤트" 카드 1개 + 신호등 반영')],
], size=11, gap=7)
# 코드 박스
cby = 3.6; cbh = 1.68
rect(s, RX, cby, LCW, cbh, fill=CODEBG, rounded=True, radius=0.04)
text(s, RX + 0.2, cby + 0.14, LCW - 0.4, cbh - 0.25,
     [[("// battery-raw-metrics 확장 (예시)", None, CODEC, 10.5)],
      [("{", None, CODETX, 10.5)],
      [('  "acoustic_rms"', None, CODEK, 10.5), ("     : 0.012,   ", None, CODETX, 10.5), ("// 대역 에너지", None, CODEC, 10.5)],
      [('  "acoustic_hits"', None, CODEK, 10.5), ("    : 0,       ", None, CODETX, 10.5), ("// AE 이벤트 수", None, CODEC, 10.5)],
      [('  "acoustic_peak_hz"', None, CODEK, 10.5), (" : 0        ", None, CODETX, 10.5), ("// 피크 주파수", None, CODEC, 10.5)],
      [("}", None, CODETX, 10.5)]], font=MONO, ls=1.2, sa=1)

# ============================================================
# 11. 선택 옵션
# ============================================================
s = slide(); topbar(s, 11)
title(s, "선택 가능한 옵션 — 회의에서 결정할 사항")
lead(s, LM, 1.5, CW,
     [[("open 환경·음향 도입은 합의됨. 아래 ", None, DARK, 12.5), ("음향 구성(A/B/C)", True, NAVY, 12.5),
       ("과 ", None, DARK, 12.5), ("가스센서 부가 여부", True, NAVY, 12.5), ("를 결정하면 된다.", None, DARK, 12.5)]], h=0.4)
ow = (CW - 2 * 0.3) / 3.0
oy = 2.15; oh = 2.35
opts = [
    ("옵션 A", "MEMS 마이크만", RGBColor(0x9A,0xA3,0xB8), False,
     ["저비용, 라즈베리파이 직결", "특허·grid 논문이 검증한 방식", "벤팅(⑤) 단계라 다소 늦은 신호", "난이도 낮음 / 빠른 구현"]),
    ("옵션 B", "접촉 AE 피에조만", RGBColor(0x9A,0xA3,0xB8), False,
     ["가장 빠른 내부 전조 신호", "보조MCU+고속ADC 필요", "신호처리 난이도 최상", "open에서도 유효(접촉식)"]),
    ("옵션 C · 권장", "A + B 동시", NAVY, True,
     ["내부 탄성파 → 벤팅음 단계별 커버", '발표·논문 차별화 "끝판왕"', "난이도 높음(감수 합의됨)", "멀티모달 융합 = 오탐↓"]),
]
ox = LM
for tag, head, tagcol, rec, lis in opts:
    bg = RGBColor(0xF5,0xF8,0xFE) if rec else WHITE
    border = NAVY if rec else LINE
    lw = 2.0 if rec else 1.0
    rect(s, ox, oy, ow, oh, fill=bg, line=border, lw=lw, rounded=True, radius=0.03)
    # 태그 pill
    pw = 0.5 + 0.12 * len(tag)
    rect(s, ox + 0.2, oy + 0.18, pw, 0.26, fill=tagcol, rounded=True, radius=0.5)
    text(s, ox + 0.2, oy + 0.18, pw, 0.26, [[(tag, True, WHITE, 10)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, ox + 0.2, oy + 0.55, ow - 0.4, 0.35, [[(head, True, INK, 14)]])
    paras = [[("–  ", None, RGBColor(0x9A,0xA3,0xB8), 11), (t, None, DARK, 11)] for t in lis]
    text(s, ox + 0.2, oy + 1.0, ow - 0.4, oh - 1.1, paras, ls=1.18, sa=4)
    ox += ow + 0.3
# 부가 결정
ay = oy + oh + 0.2
rect(s, LM, ay, CW, 0.78, fill=LBLUE, rounded=True, radius=0.03)
text(s, LM + 0.25, ay + 0.13, CW - 0.5, 0.55,
     [[("부가 결정 — 가스센서 ", True, NAVY, 11.5), (": open 환경이라 효용 제한. ⓐ ", None, DARK, 11.5),
       ("제외", True, NAVY, 11.5), (" 하거나, ⓑ ", None, DARK, 11.5), ("BME680만", True, NAVY, 11.5),
       (" 두어 VOC·습도·기압을 \"변화율 보조 신호\"로만 활용(저비용·I2C 직결). MQ 계열(ADC·예열)은 비권장.", None, DARK, 11.5)]], ls=1.2)
footer(s, "권장: 옵션 C + 가스센서는 BME680 보조(ⓑ) — 음향 멀티모달을 핵심 신규 신호로, 가스는 저비용 보조로. 최종 결정은 회의 합의에 따름.")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
prs.save(OUT)
print(f"저장: {OUT}  (슬라이드 {len(prs.slides._sldIdLst)})")
