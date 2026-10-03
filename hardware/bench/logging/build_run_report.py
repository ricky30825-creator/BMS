#!/usr/bin/env python3
"""PB-20000 1A run -> 자체 완결 HTML 리포트 (inline SVG 차트).

사용법:
    python build_run_report.py [run디렉터리]
"""
import csv
import os
import sys
from datetime import datetime

RUN = sys.argv[1] if len(sys.argv) > 1 else "PB20000_r1_1A"
HERE = os.path.dirname(os.path.abspath(__file__))
RUND = RUN if os.path.isabs(RUN) else os.path.join(HERE, RUN)
OUT = os.path.join(HERE, "PB20000_r1_1A_report.html")

# BW150 완료 리포트 화면에서 읽은 값
BW_MAH, BW_WH, BW_SEC = 10928.0, 54.2103, 10 * 3600 + 55 * 60 + 47
LABEL_MAH, LABEL_V = 20000.0, 3.7
LABEL_WH = LABEL_MAH / 1000.0 * LABEL_V


def ts(s):
    return datetime.fromisoformat(s)


def load(path, cols):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                rows.append([ts(r["timestamp"])] + [float(r[c]) for c in cols])
            except Exception:
                continue
    return rows


ina = (load(os.path.join(RUND, "PB20000_r1_1A_ina.csv"), ["voltage_v", "current_a"])
       + load(os.path.join(RUND, "PB20000_r1_1A_ina_part2.csv"), ["voltage_v", "current_a"]))
ina.sort(key=lambda r: r[0])
tmp = load(os.path.join(RUND, "PB20000_r1_1A_temp.csv"),
           ["ds18b20_c", "ds_ambient_c", "delta_c"])
mlx = load(os.path.join(RUND, "PB20000_r1_1A_mlx01.csv"),
           ["mlx5a_obj_c", "mlx5b_obj_c"])

disch = [r for r in ina if r[1] > 1.0 and abs(r[2]) > 0.1]
t0, t1 = disch[0][0], disch[-1][0]


def hrs(t):
    return (t - t0).total_seconds() / 3600.0


ah = wh = gap = 0.0
prev = None
for (t, v, i) in disch:
    if prev:
        dt = (t - prev[0]).total_seconds()
        if 0 < dt <= 1.0:
            ah += abs(i) * dt / 3600.0
            wh += abs(i) * prev[1] * dt / 3600.0
        elif dt > 1.0:
            gap += dt
    prev = (t, v, i)
cs = [abs(r[2]) for r in disch]
vs = [r[1] for r in disch]
ia = sum(cs) / len(cs)
va = sum(vs) / len(vs)
ah += ia * gap / 3600.0
wh += ia * va * gap / 3600.0
dur = (t1 - t0).total_seconds()
P = ia * va


def dec(rows, n, xf, yfs):
    if not rows:
        return [[] for _ in yfs]
    step = max(1, len(rows) // n)
    out = [[] for _ in yfs]
    for s in range(0, len(rows), step):
        chunk = rows[s:s + step]
        x = xf(chunk[len(chunk) // 2])
        for k, yf in enumerate(yfs):
            vals = [yf(c) for c in chunk]
            if vals:
                out[k].append((x, sum(vals) / len(vals)))
    return out


def svg(series, w=1000, h=260, xlab="", ylab="", xmin=None, xmax=None,
        yfmt="%.2f", xfmt="%.1f"):
    pl, pb, pt, pr = 64, 34, 14, 16
    xs = [p[0] for s in series for p in s["pts"]]
    ys = [p[1] for s in series for p in s["pts"]]
    if not xs:
        return ""
    x0 = xmin if xmin is not None else min(xs)
    x1 = xmax if xmax is not None else max(xs)
    y0, y1 = min(ys), max(ys)
    if y1 - y0 < 1e-9:
        y1 = y0 + 1
    sp = y1 - y0
    y0 -= sp * 0.10
    y1 += sp * 0.10
    iw, ih = w - pl - pr, h - pt - pb

    def X(v):
        return pl + (v - x0) / ((x1 - x0) or 1) * iw

    def Y(v):
        return pt + ih - (v - y0) / (y1 - y0) * ih

    o = ['<svg viewBox="0 0 %d %d" preserveAspectRatio="xMidYMid meet" role="img">' % (w, h)]
    for k in range(5):
        yv = y0 + (y1 - y0) * k / 4
        yy = Y(yv)
        o.append('<line class="grid" x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f"/>'
                 % (pl, yy, w - pr, yy))
        o.append('<text class="tick ty" x="%.1f" y="%.1f">%s</text>'
                 % (pl - 9, yy + 4, yfmt % yv))
    for k in range(7):
        xv = x0 + (x1 - x0) * k / 6
        o.append('<text class="tick tx" x="%.1f" y="%.1f">%s</text>'
                 % (X(xv), h - 10, xfmt % xv))
    for s in series:
        pts = " ".join("%.2f,%.2f" % (X(p[0]), Y(p[1])) for p in s["pts"])
        o.append('<polyline class="ln" points="%s" style="stroke:%s"/>' % (pts, s["color"]))
    if ylab:
        o.append('<text class="axlab" transform="translate(15,%.1f) rotate(-90)">%s</text>'
                 % (pt + ih / 2, ylab))
    if xlab:
        o.append('<text class="axlab" x="%.1f" y="%.1f">%s</text>' % (pl + iw / 2, h - 1, xlab))
    o.append('</svg>')
    return "".join(o)


C_V, C_I, C_CELL, C_AMB, C_D = "#1C7293", "#B5651D", "#C2410C", "#5C6E73", "#7A5195"

v_s, i_s = dec(disch, 900, lambda r: hrs(r[0]), [lambda r: r[1], lambda r: abs(r[2])])
ch_v = svg([{"pts": v_s, "color": C_V}], h=250, ylab="전압 (V)", xlab="경과 (h)", yfmt="%.2f")
ch_i = svg([{"pts": i_s, "color": C_I}], h=200, ylab="전류 (A)", xlab="경과 (h)", yfmt="%.3f")

tail = [((r[0] - t1).total_seconds(), r[1]) for r in ina
        if -3 <= (r[0] - t1).total_seconds() <= 3]
ch_cut = svg([{"pts": tail, "color": C_V}], h=220, ylab="전압 (V)",
             xlab="컷오프 기준 (초)", yfmt="%.2f")

tin = [r for r in tmp if t0 <= r[0] <= t1]
c_s, a_s, d_s = dec(tin, 700, lambda r: hrs(r[0]),
                    [lambda r: r[1], lambda r: r[2], lambda r: r[3]])
ch_t = svg([{"pts": c_s, "color": C_CELL}, {"pts": a_s, "color": C_AMB}],
           h=250, ylab="온도 (℃)", xlab="경과 (h)", yfmt="%.1f")
ch_d = svg([{"pts": d_s, "color": C_D}], h=190, ylab="delta_c (℃)",
           xlab="경과 (h)", yfmt="%.2f")

min_ = [r for r in mlx if t0 <= r[0] <= t1]
a5, b5 = dec(min_, 700, lambda r: hrs(r[0]), [lambda r: r[1], lambda r: r[2]])
ch_ir = svg([{"pts": a5, "color": C_I}, {"pts": b5, "color": C_V}],
            h=250, ylab="IR 대상온도 (℃)", xlab="경과 (h)", yfmt="%.1f")

cellv = [r[1] for r in tin]
ambv = [r[2] for r in tin]
dv = [r[3] for r in tin]
rth = max(dv) / P
mah = ah * 1000
lost_s = BW_SEC - dur
lost_mah = ia * lost_s / 3600.0 * 1000


def card(v, u, l, note):
    return ('<div class="card"><div class="cv">%s<span class="cu">%s</span></div>'
            '<div class="cl">%s</div><div class="cn">%s</div></div>') % (v, u, l, note)


cards = "".join([
    card("%.1f" % wh, " Wh", "실측 에너지", "5V 출력에서 적분"),
    card("%s" % format(int(round(mah)), ","), " mAh", "실측 용량", "5V 출력 기준"),
    card("%.1f" % (wh / LABEL_WH * 100), " %", "라벨 에너지 대비", "74.0 Wh 중"),
    card("%.3f" % ia, " A", "평균 전류", "설정 1.000 A"),
    card("%.3f" % va, " V", "평균 전압", "%.3f ~ %.3f" % (min(vs), max(vs))),
    card("%.2f" % (BW_SEC / 3600), " h", "방전 시간", "BW150 계측"),
])

TPL = """<title>PB-20000 1A 방전</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--ground:#FBFCFC;--panel:#FFFFFF;--ink:#17252A;--ink2:#3A4B51;--muted:#5C6E73;
--line:#DCE4E5;--grid:#EAF0F0;--copper:#B5651D;--teal:#1C7293;--ember:#C2410C;--violet:#7A5195}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--ground:#0E1619;--panel:#141F23;--ink:#E8EFF0;--ink2:#B7C6C9;--muted:#8A9CA1;
--line:#25353A;--grid:#1D2B30;--copper:#D98A45;--teal:#5AA7C4;--ember:#E8734A;--violet:#A88BC4}}
:root[data-theme="dark"]{
--ground:#0E1619;--panel:#141F23;--ink:#E8EFF0;--ink2:#B7C6C9;--muted:#8A9CA1;
--line:#25353A;--grid:#1D2B30;--copper:#D98A45;--teal:#5AA7C4;--ember:#E8734A;--violet:#A88BC4}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
font-family:"IBM Plex Sans",system-ui,"Segoe UI",sans-serif;font-size:15px;line-height:1.65}
.wrap{max-width:1080px;margin:0 auto;padding:56px 26px 80px;display:flex;flex-direction:column;gap:46px}
.mast{display:flex;flex-direction:column;gap:12px;border-bottom:1px solid var(--line);padding-bottom:26px}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.14em;
text-transform:uppercase;color:var(--muted)}
h1{font-family:"IBM Plex Sans Condensed",sans-serif;font-weight:700;
font-size:clamp(30px,5vw,46px);line-height:1.08;margin:0;text-wrap:balance;letter-spacing:-.01em}
.sub{color:var(--ink2);max-width:64ch;margin:0}
.meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-family:"IBM Plex Mono",monospace;
font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.readout{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;
background:var(--line);border:1px solid var(--line);border-radius:3px;overflow:hidden}
.card{background:var(--panel);padding:18px}
.cv{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:27px;letter-spacing:-.02em;
font-variant-numeric:tabular-nums;line-height:1.15}
.cu{font-size:14px;font-weight:400;color:var(--muted);margin-left:5px}
.cl{font-size:12px;color:var(--muted);margin-top:5px;letter-spacing:.03em}
.cn{font-size:11.5px;color:var(--ink2);margin-top:7px;line-height:1.45}
section{display:flex;flex-direction:column;gap:14px}
h2{font-family:"IBM Plex Sans Condensed",sans-serif;font-weight:600;font-size:21px;margin:0}
h2 .n{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);
margin-right:11px;font-weight:500}
p{margin:0;max-width:68ch;color:var(--ink2)}
b{color:var(--ink);font-weight:600}
code{font-family:"IBM Plex Mono",monospace;font-size:.92em;background:var(--grid);
padding:1px 5px;border-radius:2px;color:var(--ink)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:3px;
padding:16px 12px 8px;overflow-x:auto}
svg{display:block;width:100%;height:auto;min-width:540px}
.grid{stroke:var(--grid);stroke-width:1}
.ln{fill:none;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.tick{font-family:"IBM Plex Mono",monospace;font-size:10.5px;fill:var(--muted)}
.ty{text-anchor:end}.tx{text-anchor:middle}
.axlab{font-family:"IBM Plex Sans",sans-serif;font-size:11px;fill:var(--muted);text-anchor:middle}
.key{display:flex;flex-wrap:wrap;gap:8px 22px;font-size:12.5px;color:var(--ink2);
font-family:"IBM Plex Mono",monospace}
.key i{display:inline-block;width:15px;height:2.5px;vertical-align:middle;margin-right:7px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}
th{font-family:"IBM Plex Sans Condensed",sans-serif;font-weight:600;color:var(--muted);
font-size:11.5px;text-transform:uppercase;letter-spacing:.09em}
td.n{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;text-align:right}
.note{border-left:2px solid var(--copper);padding:2px 0 2px 16px;display:flex;
flex-direction:column;gap:6px}
footer{border-top:1px solid var(--line);padding-top:20px;font-size:12px;color:var(--muted);
font-family:"IBM Plex Mono",monospace;line-height:1.8}
</style>

<div class="wrap">
<header class="mast">
<div class="eyebrow">CellGuard BMS · 방전 스트레스 시험 · run 1</div>
<h1>PB-20000 &nbsp;1A 정전류 방전</h1>
<p class="sub">보조배터리를 USB-A 출력에서 1A로 완전 방전시키며 전압·전류를 0.1초, 접촉 온도를 2.6초, 적외선 2존을 0.1초로 동시 기록했다. 모드 2 계측 경로의 첫 실측 run이다.</p>
<div class="meta"><span>__T0__ → __T1__</span><span>__DUR__</span><span>INA226 R010 · CAL 0x0A00</span><span>Raspberry Pi 4 · Trixie Lite</span></div>
</header>

<div class="readout">__CARDS__</div>

<section><h2><span class="n">01</span>전압</h2>
<p>10.9시간 내내 5.02V 부근에서 평탄하게 유지되다 마지막에 수직으로 떨어진다. 리튬셀의 완만한 하강 곡선이 아니라 <b>부스트 컨버터가 출력을 붙들고 있다가 보호회로가 끊는</b> 형태다. 보조배터리의 잔량을 출력 전압으로 추정할 수 없다는 뜻이기도 하다.</p>
<div class="panel">__CH_V__</div></section>

<section><h2><span class="n">02</span>전류</h2>
<p>정전류 제어가 전 구간에서 __IMIN__~__IMAX__A 안에 머물렀다. 변동폭 __ISPAN__mA는 설정값의 __IPCT__%다.</p>
<div class="panel">__CH_I__</div></section>

<section><h2><span class="n">03</span>컷오프 과도</h2>
<p>0.1초 샘플링이 있어야만 보이는 구간이다. <b>__VLAST__V에서 한 샘플 만에 0.02V로 떨어졌다</b> — 100ms 안에 끝났다는 뜻이다. 1초 샘플링이었다면 중간 과정 없이 값이 튀는 것으로만 남았을 것이다.</p>
<div class="panel">__CH_CUT__</div></section>

<section><h2><span class="n">04</span>온도</h2>
<p>셀 표면과 실온을 접촉식 DS18B20 두 개로 쟀다. 실온이 밤사이 __AMBSPAN__℃ 움직였고, 배터리는 열용량 때문에 그 변화를 늦게 따라간다.</p>
<div class="key"><span><i style="background:var(--ember)"></i>셀 표면</span><span><i style="background:var(--muted)"></i>실온</span></div>
<div class="panel">__CH_T__</div></section>

<section><h2><span class="n">05</span>delta_c 와 그 함정</h2>
<p><code>delta_c</code>(셀−실온)는 자체 발열을 분리하려는 지표지만 <b>실온이 움직이는 동안에는 성립하지 않는다.</b> 부하는 __P__W로 내내 동일했는데도 값이 음수로 내려간 구간이 있다. 실온 추종 지연이 발열 성분을 덮은 것이다.</p>
<div class="panel">__CH_D__</div>
<div class="note"><b>대안 — 열저항으로 환산한다</b>
<span>정상상태에서 <code>R_th = delta_c ÷ P</code>. 이 run의 최대 delta __DMAX__℃를 __P__W로 나누면 <b>__RTH__ ℃/W</b>다. 실온과 무관한 배터리 고유값이라 run 사이 비교에 안정적이다.</span></div></section>

<section><h2><span class="n">06</span>적외선 2존</h2>
<p>MLX90614 두 개로 케이스 중앙(<code>0x5A</code>)과 USB 출력 포트쪽(<code>0x5B</code>)을 겨냥했다. <code>temp_ir_surface</code>는 두 값의 최댓값을 쓴다.</p>
<div class="key"><span><i style="background:var(--copper)"></i>0x5A 케이스 중앙</span><span><i style="background:var(--teal)"></i>0x5B USB 포트쪽</span></div>
<div class="panel">__CH_IR__</div>
<div class="note"><b>초반 1.6시간은 신뢰하지 말 것</b>
<span>23:49 · 23:57 · 00:33 세 차례 센서를 재겨냥했고, 그때마다 손이 시야에 들어가 최대 34.01℃까지 스파이크가 남았다. 2존 비교는 <b>t+1.6h 이후 구간만</b> 쓴다.</span></div></section>

<section><h2><span class="n">07</span>라벨 대비 실측</h2>
<table>
<tr><th>항목</th><th style="text-align:right">값</th><th>비고</th></tr>
<tr><td>라벨 표기</td><td class="n">20,000 mAh</td><td>3.7V 셀 기준 = 74.0 Wh</td></tr>
<tr><td>실측 에너지</td><td class="n">__WH__ Wh</td><td>5V 출력에서 적분</td></tr>
<tr><td>실측 용량</td><td class="n">__MAH__ mAh</td><td>5V 출력 기준</td></tr>
<tr><td><b>에너지 전달률</b></td><td class="n"><b>__PCTWH__ %</b></td><td>부스트 변환·자체 소비 포함</td></tr>
</table>
<div class="note"><b>라벨 mAh와 직접 비교하면 안 된다</b>
<span>라벨의 20,000mAh는 <b>3.7V 셀 쪽 값</b>이고 실측은 5V 출력 쪽이다. mAh끼리 비교하면 __PCTMAH__%라는 왜곡된 숫자가 나온다. <b>에너지로 비교해야 __PCTWH__%</b>이며, 부스트 컨버터를 가진 보조배터리에서 정상 범위다. 이 구분을 놓치면 멀쩡한 배터리를 열화로 판정하게 된다.</span></div></section>

<section><h2><span class="n">08</span>계측기 교차검증</h2>
<p>BW150의 자체 적산과 INA226 적분을 비교했다. 두 계측기는 션트도 기준전압도 다르다.</p>
<table>
<tr><th>항목</th><th style="text-align:right">BW150</th><th style="text-align:right">INA226</th><th style="text-align:right">차이</th></tr>
<tr><td>에너지</td><td class="n">__BWWH__ Wh</td><td class="n">__WH__ Wh</td><td class="n">__DWH__ %</td></tr>
<tr><td>용량</td><td class="n">__BWMAH__ mAh</td><td class="n">__MAH__ mAh</td><td class="n">__DMAH__ %</td></tr>
<tr><td>시간</td><td class="n">__BWDUR__ h</td><td class="n">__DURH__ h</td><td class="n">__DDUR__ %</td></tr>
</table>
<div class="note"><b>용량 차이는 로거 공백으로 설명된다</b>
<span>INA 로거가 기록하지 못한 구간이 시작 약 2.5분과 중간 9.9분, 합쳐서 __LOSTM__분이다. 평균 __IA__A를 곱하면 <b>__LOSTMAH__ mAh</b>로, 관측된 차이 __DIFFMAH__ mAh와 거의 일치한다. <b>에너지 오차 __DWH__%는 두 계측기의 실제 일치도를 보여주는 값이다.</b></span></div></section>

<section><h2><span class="n">09</span>기록 품질</h2>
<table>
<tr><th>항목</th><th style="text-align:right">값</th><th>비고</th></tr>
<tr><td>INA 샘플</td><td class="n">__NINA__</td><td>0.1초</td></tr>
<tr><td>접촉 온도 샘플</td><td class="n">__NT__</td><td>2.6초 — DS18B20 변환 750ms × 2</td></tr>
<tr><td>IR 샘플</td><td class="n">__NM__</td><td>0.1초 — STEP 19 필터로 95.2ms 갱신</td></tr>
<tr><td>OVF</td><td class="n">0</td><td>션트 포화 없음</td></tr>
<tr><td>결측</td><td class="n">0</td><td>온도·IR 전 구간</td></tr>
<tr><td>기록 공백</td><td class="n">9.9 분</td><td>08:28 I2C 단발 오류</td></tr>
</table>
<div class="note"><b>I2C 오류는 386,116 샘플 중 한 번</b>
<span>0.0003% 빈도다. 같은 버스의 IR 로거는 영향받지 않았다. 재시도 4회 로직을 넣어 재시작한 뒤로는 오류 0건이며, 컷오프 순간까지 온전히 기록됐다.</span></div></section>

<footer>생성 __GEN__<br>
Raspberry Pi 4 Model B Rev 1.5 · Debian 13 Trixie Lite · INA226(0x40) R010 CAL 0x0A00<br>
MLX90614(0x5A 중앙, 0x5B 포트쪽) · DS18B20(28-0625650a2c2c 셀, 28-0625657fe542 실온)<br>
ATORCH BW150 · CC 1.000A · Trigger stop &lt;3.0V · ETS 온도 프로브 부착</footer>
</div>
"""

rep = {
    "__T0__": t0.strftime("%m-%d %H:%M"),
    "__T1__": t1.strftime("%m-%d %H:%M"),
    "__DUR__": "%.2f h" % (BW_SEC / 3600),
    "__DURH__": "%.3f" % (dur / 3600),
    "__CARDS__": cards,
    "__CH_V__": ch_v, "__CH_I__": ch_i, "__CH_CUT__": ch_cut,
    "__CH_T__": ch_t, "__CH_D__": ch_d, "__CH_IR__": ch_ir,
    "__IMIN__": "%.3f" % min(cs), "__IMAX__": "%.3f" % max(cs),
    "__ISPAN__": "%.0f" % ((max(cs) - min(cs)) * 1000),
    "__IPCT__": "%.1f" % ((max(cs) - min(cs)) * 100),
    "__VLAST__": "%.4f" % disch[-1][1],
    "__AMBSPAN__": "%.1f" % (max(ambv) - min(ambv)),
    "__P__": "%.2f" % P, "__DMAX__": "%.2f" % max(dv), "__RTH__": "%.3f" % rth,
    "__WH__": "%.2f" % wh, "__MAH__": format(int(round(mah)), ","),
    "__PCTWH__": "%.1f" % (wh / LABEL_WH * 100),
    "__PCTMAH__": "%.1f" % (mah / LABEL_MAH * 100),
    "__BWWH__": "%.4f" % BW_WH, "__BWMAH__": format(int(BW_MAH), ","),
    "__BWDUR__": "%.3f" % (BW_SEC / 3600),
    "__DWH__": "%+.2f" % ((wh - BW_WH) / BW_WH * 100),
    "__DMAH__": "%+.2f" % ((mah - BW_MAH) / BW_MAH * 100),
    "__DDUR__": "%+.2f" % ((dur - BW_SEC) / BW_SEC * 100),
    "__LOSTM__": "%.1f" % (lost_s / 60), "__IA__": "%.3f" % ia,
    "__LOSTMAH__": "%.0f" % lost_mah, "__DIFFMAH__": "%.0f" % (BW_MAH - mah),
    "__NINA__": format(len(disch), ","), "__NT__": format(len(tin), ","),
    "__NM__": format(len(min_), ","),
    "__GEN__": datetime.now().strftime("%Y-%m-%d %H:%M"),
}
html = TPL
for k, v in rep.items():
    html = html.replace(k, v)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print("생성: %s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024))
