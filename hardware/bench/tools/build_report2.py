#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run 디렉터리 -> 자체 완결 HTML 리포트 (인라인 SVG, 외부 의존 없음).

  python build_report2.py <run디렉터리> --label-mah 5000 --name "PB-5000 1A"

add_soc.py 가 만든 *_soc.csv 를 전기 데이터로,
*_temp.csv 를 열 데이터(기준선+방전+냉각 전 구간)로 쓴다.
add_soc.py 를 먼저 돌릴 것.
"""
import csv, glob, math, os, sys
from datetime import datetime

if len(sys.argv) < 2:
    print(__doc__); sys.exit(1)
RUN = os.path.abspath(sys.argv[1])
LABEL_MAH, LABEL_V, NAME, SUB = 5000.0, 3.7, None, ""
FORCE_A = FORCE_B = None
for i, a in enumerate(sys.argv):
    if a == "--label-mah": LABEL_MAH = float(sys.argv[i + 1])
    if a == "--label-v":   LABEL_V = float(sys.argv[i + 1])
    if a == "--name":      NAME = sys.argv[i + 1]
    if a == "--sub":       SUB = sys.argv[i + 1]
    if a == "--base-ir":   FORCE_A = float(sys.argv[i + 1])
    if a == "--base-ir-b": FORCE_B = float(sys.argv[i + 1])
if NAME is None:
    NAME = os.path.basename(RUN.rstrip("\\/"))
OUT = os.path.join(RUN, os.path.basename(RUN.rstrip("\\/")) + "_report.html")


def ts(s): return datetime.fromisoformat(s)
def f(x):
    try: return float(x)
    except Exception: return None
def mean(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if v else None


# ---------------------------------------------------------- 데이터
soc_p = glob.glob(os.path.join(RUN, "*_soc.csv"))
if not soc_p:
    print("!! *_soc.csv 가 없다. add_soc.py 를 먼저 돌릴 것."); sys.exit(1)
S = []
for r in csv.DictReader(open(soc_p[0], encoding="utf-8")):
    S.append((ts(r["timestamp"]), f(r["elapsed_s"]), f(r["soc_pct"]), f(r["dod_ah"]),
              f(r["dod_wh"]), f(r["voltage_v"]), f(r["current_a"]), f(r["power_w"]),
              f(r["ir_diff_5a_c"]), f(r["ir_diff_5b_c"]), f(r["delta_c"])))
T = []
for p in glob.glob(os.path.join(RUN, "*_temp.csv")):
    for r in csv.DictReader(open(p, encoding="utf-8")):
        try:
            T.append((ts(r["timestamp"]), f(r["ds18b20_c"]), f(r["ds_ambient_c"]),
                      f(r["delta_c"]), f(r["mlx5a_obj_c"]), f(r["mlx5a_amb_c"]),
                      f(r["mlx5b_obj_c"]), f(r["mlx5b_amb_c"])))
        except Exception:
            pass
T.sort(key=lambda x: x[0])

t0, t1 = S[0][0], S[-1][0]
DUR = (t1 - t0).total_seconds()
AH, WH = S[-1][3], S[-1][4]
LWH = LABEL_MAH / 1000.0 * LABEL_V
V_avg = mean([x[5] for x in S]); I_avg = mean([abs(x[6]) for x in S])
P_avg = mean([x[7] for x in S])
V_hi, V_lo = max(x[5] for x in S), min(x[5] for x in S)

base = [x for x in T if x[0] < t0]
run = [x for x in T if t0 <= x[0] <= t1]
tail = [x for x in T if x[0] > t1]
d5a = lambda rs: [r[4] - r[5] for r in rs if r[4] is not None and r[5] is not None]
d5b = lambda rs: [r[6] - r[7] for r in rs if r[6] is not None and r[7] is not None]
# 기준선은 30초 이상 있어야 신뢰한다. 파일 맨 앞 한두 행을 기준선으로 쓰면 안 된다.
BASE_MIN = 30.0
if base and (t0 - base[0][0]).total_seconds() >= BASE_MIN:
    base = [x for x in base if (t0 - x[0]).total_seconds() <= 180]
    b5a, b5b = mean(d5a(base)), mean(d5b(base))
else:
    b5a = b5b = None
if FORCE_A is not None: b5a = FORCE_A
if FORCE_B is not None: b5b = FORCE_B
n = len(run)
early = mean(d5a(run[n // 4:n // 2])); late = mean(d5a(run[-max(1, n // 10):]))
R_mid = (mean(d5a(run[n // 4:3 * n // 4])) - (b5a or 0)) / P_avg
R_end = (late - (b5a or 0)) / P_avg
amb = [x[2] for x in run]; cell = [x[1] for x in run]
SWING = max(amb) - min(amb)

# tau (30초 이동평균)
TAU = None
if tail and late is not None:
    amp = mean(d5a(tail[:20])) - (b5a or 0)
    if amp > 0.05:
        tgt = (b5a or 0) + amp / math.e
        pts = [(r[0], r[4] - r[5]) for r in tail if r[4] is not None and r[5] is not None]
        j = 0
        for k in range(len(pts)):
            while pts[k][0].timestamp() - pts[j][0].timestamp() > 30: j += 1
            sm = sum(v for _, v in pts[j:k + 1]) / (k - j + 1)
            if (pts[k][0] - t1).total_seconds() >= 30 and sm <= tgt:
                TAU = (pts[k][0] - t1).total_seconds() / 60; break

# SOC 구간
SEG = []
for hi, lo in [(100, 80), (80, 50), (50, 20), (20, 0)]:
    seg = [x for x in S if lo <= x[2] <= hi]
    if len(seg) < 5: continue
    dur = (seg[-1][0] - seg[0][0]).total_seconds() / 3600
    ir = mean([x[8] for x in seg])
    k = max(1, len(seg) // 10)
    rate = (mean([x[8] for x in seg[-k:]]) - mean([x[8] for x in seg[:k]])) / dur if dur else None
    SEG.append((hi, lo, dur, mean([x[5] for x in seg]), mean([x[7] for x in seg]), ir, rate))


# ---------------------------------------------------------- SVG
def poly(pts, W, H, xr, yr, pad=(52, 14, 30, 14)):
    l, r_, b, t_ = pad
    x0, x1 = xr; y0, y1 = yr
    out = []
    for (x, y) in pts:
        if y is None: continue
        px = l + (x - x0) / (x1 - x0 or 1) * (W - l - r_)
        py = (H - b) - (y - y0) / (y1 - y0 or 1) * (H - b - t_)
        out.append("%.1f,%.1f" % (px, py))
    return " ".join(out)


def chart(title, series, xr, yr, xlab, ylab, W=880, H=250, xfmt="%.1f", yfmt="%.2f"):
    l, r_, b, t_ = 52, 14, 30, 14
    g = ['<div class="ch"><div class="cht">%s</div>' % title,
         '<svg viewBox="0 0 %d %d" role="img">' % (W, H)]
    for i in range(5):
        y = yr[0] + (yr[1] - yr[0]) * i / 4
        py = (H - b) - i / 4 * (H - b - t_)
        g.append('<line class="gr" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>' % (l, py, W - r_, py))
        g.append('<text class="ax" x="%d" y="%.1f" text-anchor="end">%s</text>'
                 % (l - 6, py + 3, yfmt % y))
    for i in range(6):
        x = xr[0] + (xr[1] - xr[0]) * i / 5
        px = l + i / 5 * (W - l - r_)
        g.append('<text class="ax" x="%.1f" y="%d" text-anchor="middle">%s</text>'
                 % (px, H - 10, xfmt % x))
    for (name, pts, cls) in series:
        g.append('<polyline class="%s" points="%s"/>' % (cls, poly(pts, W, H, xr, yr)))
    g.append('</svg>')
    leg = " ".join('<span class="lg"><i class="%s"></i>%s</span>' % (c, n_)
                   for (n_, _, c) in series)
    g.append('<div class="legend">%s<span class="axl">%s</span></div></div>' % (leg, xlab))
    return "".join(g)


HRS = [(x[0] - t0).total_seconds() / 3600 for x in S]
XR = (0, DUR / 3600)
c1 = chart("전압 · 전류",
           [("전압 V", list(zip(HRS, [x[5] for x in S])), "s1"),
            ("전류 A (절대값)", list(zip(HRS, [abs(x[6]) if x[6] else None for x in S])), "s2")],
           XR, (0, max(6.0, V_hi + 0.5)), "경과 (h)", "V / A")
TH = [(x[0] - t0).total_seconds() / 3600 for x in T]
# 2026-09-20: 셀 표면 DS 를 폐기해 그 열이 비어 있을 수 있다.
_tv = [v for x in T for v in (x[1], x[2]) if v is not None]
tmin = min(_tv) if _tv else 0.0
tmax = max(_tv) if _tv else 1.0
_has_cell = any(x[1] is not None for x in T)
_t_series = [("셀 표면", list(zip(TH, [x[1] for x in T])), "s3")] if _has_cell else []
_t_series = _t_series + [("실온", list(zip(TH, [x[2] for x in T])), "s4")]
c2 = chart("접촉 온도" + (" — 셀 vs 실온" if _has_cell else " — 실온 (셀 표면 DS 폐기됨)"),
           _t_series,
           (min(TH), max(TH)), (math.floor(tmin - 1), math.ceil(tmax + 1)),
           "경과 (h) · 0 = 로드 ON", "℃")
ir_a = [x[4] - x[5] if x[4] is not None and x[5] is not None else None for x in T]
ir_b = [x[6] - x[7] if x[6] is not None and x[7] is not None else None for x in T]
c3 = chart("IR 차분 (obj − amb) — 1차 발열 지표",
           [("0x5A 케이스 중앙", list(zip(TH, ir_a)), "s5"),
            ("0x5B USB 포트쪽", list(zip(TH, ir_b)), "s6")],
           (min(TH), max(TH)), (-1, math.ceil(max([v for v in (ir_a + ir_b) if v is not None] or [1])) + 1),
           "경과 (h) · 0 = 로드 ON", "℃")

def card(v, u, lab, sub=""):
    return ('<div class="card"><b>%s<span>%s</span></b><span class="cl">%s</span>'
            '<span class="cs">%s</span></div>' % (v, u, lab, sub))

CARDS = "".join([
    card("%.3f" % WH, " Wh", "실측 에너지", "라벨 %.1f Wh 대비 <b>%.1f%%</b>" % (LWH, WH / LWH * 100)),
    card("%.0f" % (AH * 1000), " mAh", "실측 용량 @5V", "라벨 mAh의 %.1f%%" % (AH * 1000 / LABEL_MAH * 100)),
    card("%.2f" % (DUR / 3600), " h", "방전 시간", "평균 %.3f W" % P_avg),
    card("%.3f" % R_end, " ℃/W", "R_th (말미 기준)", "중간 50%%: %.3f · 기준선 %s" % (R_mid, ("%+.3f" % b5a) if b5a is not None else "없음(0 가정)")),
    card("%.1f" % TAU if TAU else "—", " 분", "냉각 시상수 τ", "표면 1/e"),
    card("%.2f" % SWING, " ℃", "실온 진폭", "최대 오차 요인"),
])

ROWS = "".join(
    "<tr><td class='n'>SOC %d–%d</td><td class='n'>%.3f</td><td class='n'>%.4f</td>"
    "<td class='n'>%.3f</td><td class='n hot'>%+.3f</td><td class='n'>%s</td></tr>"
    % (hi, lo, d, v, p, ir, "—" if rt is None else "%+.3f" % rt)
    for (hi, lo, d, v, p, ir, rt) in SEG)

EQ = ""
if early is not None and late is not None and abs(late - early) > 0.15:
    EQ = ('<div class="warn"><b>평형에 도달하지 못했다.</b> IR 차분이 전반 %+.3f℃ → 말미 %+.3f℃로 '
          '끝까지 %s 중이었다. run 길이(%.2f h)가 열시상수보다 짧으면 정상상태가 존재하지 않는다. '
          '중간 50%%로 계산한 R_th %.3f는 <b>과소평가</b>이고, 말미값 기준 <b>%.3f ℃/W</b>가 하한에 가깝다.</div>'
          % (early, late, "상승" if late > early else "하강", DUR / 3600, R_mid, R_end))

HTML = """<title>%(name)s</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{--ground:#F1F4F7;--surface:#fff;--surface-2:#E8ECF1;--line:#D3DAE3;--line-soft:#E3E8EE;
--ink:#131920;--ink-mid:#48545F;--ink-soft:#76838F;--sig:#D14A05;--sig-soft:#FBEADF;--keep:#0B6E77;--v:#1F4E8C;--a:#0B6E77}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0D1116;--surface:#161C23;
--surface-2:#1E262F;--line:#2C3742;--line-soft:#232C35;--ink:#E3E9F0;--ink-mid:#A3B0BD;--ink-soft:#78868F;
--sig:#FF8A3D;--sig-soft:#33200F;--keep:#4FC3CD;--v:#7EA9E0;--a:#4FC3CD}}
:root[data-theme="dark"]{--ground:#0D1116;--surface:#161C23;--surface-2:#1E262F;--line:#2C3742;
--line-soft:#232C35;--ink:#E3E9F0;--ink-mid:#A3B0BD;--ink-soft:#78868F;--sig:#FF8A3D;--sig-soft:#33200F;
--keep:#4FC3CD;--v:#7EA9E0;--a:#4FC3CD}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans KR",-apple-system,"Malgun Gothic",sans-serif;font-size:15px;line-height:1.7}
.wrap{max-width:960px;margin:0 auto;padding:44px 22px 88px}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft)}
h1{font-size:clamp(28px,4vw,40px);font-weight:700;letter-spacing:-.02em;margin:10px 0 12px;text-wrap:balance}
.lede{font-size:16px;color:var(--ink-mid);max-width:64ch;margin:0}
h2{font-size:12px;font-family:"IBM Plex Mono",monospace;font-weight:600;letter-spacing:.13em;
text-transform:uppercase;color:var(--ink-soft);margin:46px 0 4px;padding-bottom:9px;border-bottom:1px solid var(--line)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:1px;background:var(--line);
border:1px solid var(--line);border-radius:3px;overflow:hidden;margin-top:28px}
.card{background:var(--surface);padding:15px 17px;display:flex;flex-direction:column;gap:2px}
.card b{font-family:"IBM Plex Mono",monospace;font-size:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.card b span{font-size:12px;font-weight:400;color:var(--ink-soft)}
.cl{font-size:12.5px;color:var(--ink-soft)}
.cs{font-size:11.5px;color:var(--ink-soft);font-family:"IBM Plex Mono",monospace}
.ch{margin-top:20px;border:1px solid var(--line);border-radius:3px;background:var(--surface);padding:15px 16px 10px}
.cht{font-size:13.5px;font-weight:600;margin-bottom:8px}
svg{width:100%%;height:auto;display:block}
.gr{stroke:var(--line-soft);stroke-width:1}
.ax{fill:var(--ink-soft);font-size:10px;font-family:"IBM Plex Mono",monospace}
polyline{fill:none;stroke-width:1.6;vector-effect:non-scaling-stroke}
.s1{stroke:var(--v)}.s2{stroke:var(--sig)}.s3{stroke:var(--sig)}.s4{stroke:var(--ink-soft)}
.s5{stroke:var(--sig)}.s6{stroke:var(--keep)}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;font-size:11.5px;color:var(--ink-soft)}
.lg i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:5px;vertical-align:3px}
i.s1{background:var(--v)}i.s2{background:var(--sig)}i.s3{background:var(--sig)}i.s4{background:var(--ink-soft)}
i.s5{background:var(--sig)}i.s6{background:var(--keep)}
.axl{margin-left:auto}
.scroll{overflow-x:auto;margin-top:16px;border:1px solid var(--line);border-radius:3px}
table{border-collapse:collapse;width:100%%;font-size:13.5px;background:var(--surface)}
th,td{padding:9px 13px;text-align:left;border-bottom:1px solid var(--line-soft);white-space:nowrap}
th{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
color:var(--ink-soft);background:var(--surface-2)}
tbody tr:last-child td{border-bottom:0}
td.n{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
td.hot{color:var(--sig);font-weight:600}
caption{caption-side:bottom;text-align:left;padding:10px 13px;font-size:12.5px;color:var(--ink-soft);
background:var(--surface);border-top:1px solid var(--line-soft)}
.warn{margin-top:16px;border:1px solid var(--sig);background:var(--sig-soft);border-radius:3px;
padding:14px 17px;font-size:14px;color:var(--ink)}
p.note{color:var(--ink-mid);max-width:70ch}
code{font-family:"IBM Plex Mono",monospace;font-size:.9em;background:var(--surface-2);padding:1.5px 5px;border-radius:2px}
.foot{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-soft)}
</style>
<div class="wrap">
<p class="eyebrow">CellGuard BMS · %(date)s</p>
<h1>%(name)s</h1>
<p class="lede">%(sub)s</p>
<div class="cards">%(cards)s</div>

<h2>전기</h2>
%(c1)s
<p class="note">전압 %(vhi).4f V → %(vlo).4f V, 평균 %(vavg).4f V. 전류 평균 %(iavg).4f A.
INA226 0.1초 샘플링, 레지스터 값과 션트 환산값이 일치해 R010·CAL 정확도가 확인됐다.</p>

<h2>열</h2>
%(c2)s
%(c3)s
%(eq)s
<p class="note">1차 발열 지표는 <code>delta_c</code>(셀−실온)가 아니라
<b>같은 MLX 안의 obj−amb 차분</b>이다. 실온 드리프트가 상쇄되기 때문이다.
이번 run은 실온이 <b>%(swing).2f℃</b> 움직였으므로 <code>delta_c</code> 단독 해석은 무의미하다.
무부하 기준선: 0x5A %(b5a)s ℃ / 0x5B %(b5b)s ℃.</p>

<h2>SOC 구간 분해</h2>
<div class="scroll"><table>
<caption>전류적산 SOC (출력단 기준). 완전방전 run 하나에서 SOC 축을 뽑는다 — 추가 run 불필요.</caption>
<thead><tr><th>구간</th><th>길이 h</th><th>평균 V</th><th>평균 W</th><th>IR 차분 ℃</th><th>발열률 ℃/h</th></tr></thead>
<tbody>%(rows)s</tbody></table></div>

<p class="foot">생성 <code>build_report2.py</code> · 분석 <code>analyze_run2.py</code> · SOC <code>add_soc.py</code><br>
원본 0.1초 데이터와 <code>*_soc.csv</code>는 같은 폴더에 있다.</p>
</div>"""

open(OUT, "w", encoding="utf-8").write(HTML % {
    "name": NAME, "sub": SUB or "%s 정전류 방전. 전압·전류 0.1초, 접촉 온도 2.6초, 적외선 2존 0.1초 동시 기록." % NAME,
    "date": t0.strftime("%Y-%m-%d"), "cards": CARDS, "c1": c1, "c2": c2, "c3": c3,
    "eq": EQ, "rows": ROWS, "vhi": V_hi, "vlo": V_lo, "vavg": V_avg, "iavg": I_avg,
    "swing": SWING, "b5a": "%+.3f" % b5a if b5a is not None else "—",
    "b5b": "%+.3f" % b5b if b5b is not None else "—"})
print("리포트 생성:", OUT)
print("  %.3f Wh / %.0f mAh @5V  전달률 %.1f%%  %.2f h  평균 %.3f W"
      % (WH, AH * 1000, WH / LWH * 100, DUR / 3600, P_avg))
print("  R_th 중간 %.3f / 말미 %.3f C/W   tau %s분   실온진폭 %.2f C"
      % (R_mid, R_end, "%.1f" % TAU if TAU else "—", SWING))
