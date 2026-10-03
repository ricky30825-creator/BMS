#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""완료된 방전 run 교차비교 (2026-08-25).

analyze_run2.py 는 run 하나를 깊게 본다. 이 스크립트는 여러 run 을 **같은 잣대로**
나란히 놓는다. 그러려면 두 가지를 analyze_run2 와 다르게 처리해야 한다.

  1) 공백 보정을 run 마다 판정한다.
     로거만 재시작된 공백(전후 전압·전류가 같다)은 보정이 맞고,
     실제로 방전이 멎은 공백(전압 0)은 보정하면 에너지가 부풀려진다.
     -> 공백 경계의 전류를 보고 자동 판정한다.

  2) R_th 를 정상상태로 비교하지 않는다.
     8 run 중 평형에 도달한 것은 2개뿐이다(r1 10.9h, r2 6.3h). 나머지는 끝까지
     오르는 중이라 "정상상태 R_th"가 run 길이의 함수가 되어 버린다.
     -> 모든 run 이 공유하는 경과시간 t=40분 시점의 상승분으로 비교한다.
        (가장 짧은 run 인 r6 이 41.7분이라 40분이 전 run 공통 최대치다)

사용법:
    python compare_runs.py [--base <run들이 있는 디렉터리>] [--html <출력.html>]
"""
import csv
import glob
import math
import os
import sys
from datetime import datetime

# ---------------------------------------------------------------- run 목록
# (디렉터리, 표시이름, 팩, 모드, 설정값, 라벨mAh)
RUNS = [
    ("PB20000_r1_1A_20260821", "r1",  "PB-20000", "CC", "1A", 20000),
    ("PB10000_r2_1A_20260821", "r2",  "PB-10000", "CC", "1A", 10000),
    ("PB5000_r3_1A_20260821",  "r3",  "PB-5000",  "CC", "1A",  5000),
    ("PB5000_r3b_1A_20260822", "r3b", "PB-5000",  "CC", "1A",  5000),
    ("PB20000_r4_2A_20260823", "r4",  "PB-20000", "CC", "2A", 20000),
    ("PB10000_r5_2A_20260822", "r5",  "PB-10000", "CC", "2A", 10000),
    ("PB5000_r6_2A_20260823",  "r6",  "PB-5000",  "CC", "2A",  5000),
    ("PB20000_r9_3A_20260824", "r9",  "PB-20000", "CC", "3A", 20000),
    ("PB20000_c1_10W_20260826", "c1", "PB-20000", "CP", "10W", 20000),
    ("PB5000_c3_10W_20260826",  "c3", "PB-5000",  "CP", "10W",  5000),
    ("PB10000_c6_9W_20260826",  "c6", "PB-10000", "CP", "9W",  10000),
    ("PB5000_c7_8W_20260826",   "c7", "PB-5000",  "CP", "8W",   5000),
    ("PB20000_c8_14W_20260826", "c8", "PB-20000", "CP", "14W", 20000),
    # 2026-09-20~21 — 팩이 과거와 다른 물건이다(다른 모델). 열 지표는 겨냥
    # 미검증이라 비교 금지. 전기 지표만 볼 것.
    ("PB20KB_r10_2A_20260920", "B10", "PB-20000B", "CC", "2A", 20000),
    ("PB10KB_r11_2A_20260921", "B11", "PB-10000B", "CC", "2A", 10000),
]

LABEL_V = 3.7
COMMON_T = 40.0 * 60      # 전 run 공통 비교 시점 (초)
BASE_W = 60.0             # 방전 시작 직후 이 창의 IR 차분을 자체 기준선으로 쓴다

BASE = None
HTML = None
for i, a in enumerate(sys.argv):
    if a == "--base":
        BASE = sys.argv[i + 1]
    if a == "--html":
        HTML = sys.argv[i + 1]
if BASE is None:
    BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "라즈베리파이5테스트")
BASE = os.path.abspath(BASE)


def ts(s):
    return datetime.fromisoformat(s)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def rd(path, cols):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                t = ts(r["timestamp"])
            except Exception:
                continue
            v = []
            for c in cols:
                try:
                    v.append(float(r[c]))
                except Exception:
                    v.append(None)
            rows.append((t,) + tuple(v))
    return rows


def fmt(v, spec="%.3f", dash="--"):
    return dash if v is None else spec % v


# ---------------------------------------------------------------- run 하나 처리
def do_run(d, tag, pack, mode, setp, label_mah):
    run = os.path.join(BASE, d)
    ina_f = [p for p in sorted(glob.glob(os.path.join(run, "*_ina*.csv")))
             if "aborted" not in os.path.basename(p)]
    mlx_f = sorted(glob.glob(os.path.join(run, "*_mlx*.csv")))
    tmp_f = sorted(glob.glob(os.path.join(run, "*_temp.csv")))
    if not ina_f:
        return None

    ina = []
    for p in ina_f:
        ina += rd(p, ["voltage_v", "current_a"])
    ina.sort(key=lambda x: x[0])
    ina = [r for r in ina if r[1] is not None and r[2] is not None]

    live = [r for r in ina if r[1] > 1.0]
    peak = max((abs(r[2]) for r in live), default=0.0)
    thr = max(0.1, 0.3 * peak)
    disch = [r for r in live if abs(r[2]) >= thr]
    if not disch:
        return None
    t0, t1 = disch[0][0], disch[-1][0]
    wall = (t1 - t0).total_seconds()

    # --- 적분 + 공백 판정 -------------------------------------------------
    ah = wh = 0.0
    gaps = []          # (앞끝행, 뒤첫행, dt)
    prev = None
    for (t, v, i) in disch:
        if prev is not None:
            dt = (t - prev[0]).total_seconds()
            if 0 < dt <= 1.0:
                ah += abs(i) * dt / 3600.0
                wh += abs(i) * prev[1] * dt / 3600.0
            elif dt > 1.0:
                gaps.append((prev, (t, v, i), dt))
        prev = (t, v, i)

    cs = [abs(r[2]) for r in disch]
    vs = [r[1] for r in disch]
    I_avg, V_avg = sum(cs) / len(cs), sum(vs) / len(vs)
    P_avg = I_avg * V_avg

    # 공백마다 "방전이 이어졌는가"를 경계로 판정한다.
    # 로거 재시작이면 공백 직전/직후 전압이 둘 다 살아 있고 전류도 흐른다.
    # 방전이 멎었다면 원본 파일에 0V 근처 꼬리가 남는다 -> 그 사이 전체 샘플을 본다.
    ah_gap = wh_gap = 0.0
    gap_notes = []
    for (a, b, dt) in gaps:
        between = [r for r in ina if a[0] < r[0] < b[0]]
        dead = [r for r in between if r[1] < 1.0]
        cont = len(dead) == 0
        if cont:
            ah_gap += I_avg * dt / 3600.0
            wh_gap += I_avg * V_avg * dt / 3600.0
            gap_notes.append("%s~%s %.0fs 로거재시작(보정함)"
                             % (a[0].strftime("%H:%M"), b[0].strftime("%H:%M"), dt))
        else:
            gap_notes.append("%s~%s %.0fs 방전중단(보정안함, %d행이 0V)"
                             % (a[0].strftime("%H:%M"), b[0].strftime("%H:%M"), dt, len(dead)))
    AH, WH = ah + ah_gap, wh + wh_gap
    # 실제로 전류가 흐른 시간
    live_s = wall - sum(dt for (a, b, dt) in gaps
                        if any(r[1] < 1.0 for r in ina if a[0] < r[0] < b[0]))

    label_wh = label_mah / 1000.0 * LABEL_V

    # --- 실온 (플래그 판정에 먼저 필요하다) --------------------------------
    tmp = []
    for p in tmp_f:
        tmp += rd(p, ["ds18b20_c", "ds_ambient_c"])
    tmp = [r for r in tmp if t0 <= r[0] <= t1]
    amb = [r[2] for r in tmp if r[2] is not None]
    amb_swing = (max(amb) - min(amb)) if amb else None

    # --- IR 차분 ----------------------------------------------------------
    mlx = []
    for p in mlx_f:
        mlx += rd(p, ["mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"])
    mlx.sort(key=lambda x: x[0])

    def diff_at(rows, lo, hi, zone=1):
        oi, ai = (1, 2) if zone == 1 else (3, 4)
        return [r[oi] - r[ai] for r in rows
                if lo <= r[0] <= hi and r[oi] is not None and r[ai] is not None]

    # --- 냉각 꼬리 진폭 (1차 지표) ----------------------------------------
    # obj-amb 는 로거 기동 후 1시간쯤 정착 과도가 있고(센서 내부 TA 가 주변에
    # 맞춰가는 중), 실온이 몇 시간에 걸쳐 드리프트하면 그것도 섞인다.
    # 부하를 끊으면 "부하로 생긴 열"만 감쇠하고 나머지 두 성분은 그대로 이어지므로,
    # 부하 차단 직전값 - 꼬리 말미값 = 부하 기인 발열 로 분리된다.
    # 기준선을 전혀 쓰지 않는다는 게 이 지표의 장점이다.
    # 2026-08-26 개정 세 가지:
    #  (1) 존별이 아니라 max(5a,5b) 핫스팟을 쓴다. 어느 센서가 핫스팟을 잡는지가
    #      run 마다 뒤집혔다 (r4: 5a 6.23 / 5b 0.90,  c1: 5a 3.09 / 5b 6.92).
    #  (2) 꼬리를 공통 창(TAIL_CMP)으로 잘라 비교한다. 길이가 제각각이면
    #      절단 편향이 run 마다 달라진다 (r4 25분 vs c1 171분 -> 불일치 28%).
    #      공통 25분으로 맞추면 17%로 줄고, 겨냥이 일관된 r4/r9 는 3.6% 안에 든다.
    #  (3) 남은 편차는 겨냥이다. 팩 표면에 테이프로 지점을 고정해야 없어진다.
    TAIL_MIN = 20 * 60.0      # 이보다 짧으면 비교 자체가 성립하지 않는다
    TAIL_W = 5 * 60.0         # 창 말미 평균에 쓰는 폭
    TAIL_CMP = 25 * 60.0      # 전 run 공통 비교 창 (기존 run 중 최단이 r4 25분)

    ir = {}
    ir_lag = None
    tail_s = drop_a = drop_b = drop_hot = rth_tail = None
    if mlx:
        tail = [r for r in mlx if r[0] > t1]
        if tail:
            tail_s = (tail[-1][0] - tail[0][0]).total_seconds()

    if mlx:
        # IR 로거가 방전보다 늦게 떴으면 그만큼 발열이 이미 진행된 뒤부터 보게 된다.
        ir_lag = (mlx[0][0] - t0).total_seconds()
        b0 = max(mlx[0][0], t0)
        b1 = b0.fromtimestamp(b0.timestamp() + BASE_W)
        c0 = t0.fromtimestamp(t0.timestamp() + COMMON_T - 60)
        c1 = t0.fromtimestamp(t0.timestamp() + COMMON_T + 60)
        e0 = t1.fromtimestamp(t1.timestamp() - 180)
        for zone, key in ((1, "a"), (2, "b")):
            base = mean(diff_at(mlx, b0, b1, zone))
            com = mean(diff_at(mlx, c0, c1, zone)) if c1 <= t1 else None
            end = mean(diff_at(mlx, e0, t1, zone))
            allv = diff_at(mlx, t0, t1, zone)
            ir["base_" + key] = base
            ir["com_" + key] = com
            ir["end_" + key] = end
            ir["max_" + key] = max(allv) if allv else None
            ir["rise_com_" + key] = None if (com is None or base is None) else com - base
            ir["rise_end_" + key] = None if (end is None or base is None) else end - base

        # 부하 차단 직전 60초 vs 꼬리 창 말미 5분
        if tail_s is not None and tail_s >= TAIL_MIN:
            lo = t1.fromtimestamp(t1.timestamp() - 60)
            # 공통 창: 꼬리가 더 길어도 TAIL_CMP 지점에서 끊어 비교한다
            cend_ts = min(tail[-1][0].timestamp(), t1.timestamp() + TAIL_CMP)
            cend = t1.fromtimestamp(cend_ts)
            cw = t1.fromtimestamp(cend_ts - TAIL_W)
            te = tail[-1][0]
            tw = te.fromtimestamp(te.timestamp() - TAIL_W)
            for zone, key in ((1, "a"), (2, "b")):
                on = mean(diff_at(mlx, lo, t1, zone))
                off = mean(diff_at(mlx, tw, te, zone))
                if on is not None and off is not None:
                    ir["drop_" + key] = on - off

            # 핫스팟 = 표본마다 두 존 중 뜨거운 쪽
            def hot(rows, a, b):
                return [max(r[1] - r[2], r[3] - r[4]) for r in rows
                        if a <= r[0] <= b and None not in (r[1], r[2], r[3], r[4])]
            on_h = mean(hot(mlx, lo, t1))
            off_h = mean(hot(mlx, cw, cend))
            if on_h is not None and off_h is not None:
                ir["drop_hot"] = on_h - off_h
                ir["cmp_min"] = (cend_ts - t1.timestamp()) / 60.0
        drop_a = ir.get("drop_a")
        drop_b = ir.get("drop_b")
        drop_hot = ir.get("drop_hot")

    def per_w(x):
        return None if (x is None or not P_avg) else x / P_avg

    rth_tail = per_w(drop_hot)

    ir_base = ir.get("base_a")
    ir_common = ir.get("com_a")
    ir_end = ir.get("end_a")
    ir_max = ir.get("max_a")
    rise_common = ir.get("rise_com_a")
    rise_end = ir.get("rise_end_a")
    r_common = per_w(rise_common)
    r_end = per_w(rise_end)

    # 신뢰도 플래그
    flags = []
    if ir_lag is not None and ir_lag > 120:
        flags.append("IR지연 %.0f분" % (ir_lag / 60))
    if rise_common is not None and rise_common < 0.1 and P_avg > 3:
        flags.append("5a 무반응(겨냥의심)")

    if amb_swing is not None and amb_swing > 5.0:
        flags.append("실온 %.1fC 요동" % amb_swing)

    if tail_s is not None and tail_s < TAIL_MIN:
        flags.append("꼬리 %.0f분(짧음)" % (tail_s / 60))

    return dict(tag=tag, pack=pack, mode=mode, setp=setp, dir=d,
                ir_lag=ir_lag, flags=flags,
                tail_min=(tail_s / 60 if tail_s is not None else None),
                drop_a=drop_a, drop_b=drop_b, drop_hot=drop_hot,
                cmp_min=ir.get("cmp_min"), rth_tail=rth_tail,
                rth_tail_b=per_w(drop_b),
                rise_com_b=ir.get("rise_com_b"), rise_end_b=ir.get("rise_end_b"),
                r_com_b=per_w(ir.get("rise_com_b")),
                t0=t0, t1=t1, wall_h=wall / 3600, live_h=live_s / 3600,
                I=I_avg, V=V_avg, P=P_avg,
                AH=AH, WH=WH, label_wh=label_wh, xfer=WH / label_wh * 100,
                ah_gap=ah_gap, wh_gap=wh_gap, gaps=gap_notes,
                ir_base=ir_base, ir_common=ir_common, ir_end=ir_end, ir_max=ir_max,
                rise_common=rise_common, rise_end=rise_end,
                r_common=r_common, r_end=r_end, amb_swing=amb_swing,
                vmin=min(vs), vmax=max(vs))


# ---------------------------------------------------------------- 실행
res = []
for args in RUNS:
    sys.stderr.write("  %s ...\n" % args[0])
    r = do_run(*args)
    if r:
        res.append(r)

W = 108
print("=" * W)
print(" 방전 run 교차비교   %d run   (%s)" % (len(res), datetime.now().strftime("%Y-%m-%d")))
print("=" * W)

print("\n[ 1. 에너지 · 용량 ]  공백은 run 마다 성격을 판정해 보정 여부를 정했다")
print("  %-4s %-10s %-4s %8s %8s %9s %9s %8s %9s"
      % ("run", "팩", "설정", "실방전h", "평균W", "Wh", "mAh@5V", "전달률%", "공백보정Wh"))
for r in res:
    print("  %-4s %-10s %-4s %8.3f %8.3f %9.3f %9.0f %8.1f %9s"
          % (r["tag"], r["pack"], r["setp"], r["live_h"], r["P"], r["WH"],
             r["AH"] * 1000, r["xfer"], fmt(r["wh_gap"], "%+.3f") if r["wh_gap"] else "-"))

any_gap = [r for r in res if r["gaps"]]
if any_gap:
    print("\n  공백 판정:")
    for r in any_gap:
        for g in r["gaps"]:
            print("    %-4s %s" % (r["tag"], g))

print("\n[ 2. 발열 — 1차 지표: 냉각 꼬리 진폭 ]")
print("  부하 차단 직전 60초 - 꼬리 말미 5분. 기준선을 쓰지 않으므로 센서 정착 과도와")
print("  실온 드리프트가 상쇄된다. 꼬리가 20분 미만이면 감쇠가 덜 끝나 신뢰할 수 없다.")
print("  %-4s %-10s %-5s %8s %7s %7s %9s %9s %10s %10s  %s"
      % ("run", "팩", "설정", "평균W", "꼬리분", "비교창", "낙폭5a", "낙폭5b",
         "핫스팟낙폭", "R_th", "비고"))
for r in res:
    print("  %-4s %-10s %-5s %8.3f %7s %7s %9s %9s %10s %10s  %s"
          % (r["tag"], r["pack"], r["setp"], r["P"], fmt(r["tail_min"], "%.0f"),
             fmt(r["cmp_min"], "%.0f"),
             fmt(r["drop_a"], "%+.2f"), fmt(r["drop_b"], "%+.2f"),
             fmt(r["drop_hot"], "%+.3f"), fmt(r["rth_tail"]),
             "; ".join(r["flags"])))

print("\n[ 2b. 참고 — t=40분 시점 상승분 ]  방전 시작 60초를 기준선으로 뺀 값")
print("  !! 이 지표는 MLX 정착 과도(약 1시간)를 기준선으로 잡아 버린다. r1 이 그 사례다.")
print("  %-4s %-10s %-4s %8s %10s %10s %10s %10s %9s"
      % ("run", "팩", "설정", "평균W", "40분상승C", "말미상승C", "R40(5a)", "R40(5b)", "실온진폭"))
for r in res:
    print("  %-4s %-10s %-4s %8.3f %10s %10s %10s %10s %9s  %s"
          % (r["tag"], r["pack"], r["setp"], r["P"],
             fmt(r["rise_common"], "%+.3f"), fmt(r["rise_end"], "%+.3f"),
             fmt(r["r_common"]), fmt(r["r_com_b"]), fmt(r["amb_swing"], "%.2f"),
             "; ".join(r["flags"])))

print("\n[ 3. 전류축 — R_th 가 전류와 무관한가 ]")
print("  이론상 R_th 는 전류와 무관해야 한다. 팩별로 본다.")
for pack in ["PB-20000", "PB-10000", "PB-5000"]:
    rs = sorted([r for r in res if r["pack"] == pack and r["rth_tail"] is not None],
                key=lambda x: x["P"])
    if len(rs) < 2:
        continue
    print("\n  %s" % pack)
    print("    %-4s %-6s %8s %10s %10s %7s  %s"
          % ("run", "설정", "W", "핫스팟낙폭", "R_th C/W", "배수", "비고"))
    # 기준은 상승분이 유의미(>0.2C)하고 플래그가 없는 run 중 전력이 가장 낮은 것
    cands = [r for r in rs if r["drop_hot"] and r["drop_hot"] > 0.2 and not r["flags"]]
    ref = cands[0] if cands else None
    for r in rs:
        rr = n = pr = None
        if ref is not None and r is not ref and ref["drop_hot"] > 0:
            pr = r["P"] / ref["P"]
            rr = r["drop_hot"] / ref["drop_hot"]
            if pr > 1.05 and rr > 0:
                n = math.log(rr) / math.log(pr)
        note = "; ".join(r["flags"])
        if n is not None:
            note = ("전력 %.2f배 -> 발열 %.2f배 · 지수 %.2f" % (pr, rr, n)) + \
                   (("  [" + note + "]") if note else "")
        elif r is ref:
            note = "<- 기준" + (("  [" + note + "]") if note else "")
        print("    %-4s %-6s %8.3f %10s %10s %7s  %s"
              % (r["tag"], r["setp"], r["P"], fmt(r["drop_hot"], "%+.3f"),
                 fmt(r["rth_tail"]), fmt(rr, "%.2f"), note))
    if ref is None:
        print("    * 신뢰할 기준 run 이 없다 (전부 플래그 있음)")

print("\n[ 4. 크기축 — 같은 설정에서 팩 비교 ]")
for setp in ["1A", "2A"]:
    rs = [r for r in res if r["setp"] == setp]
    if len(rs) < 2:
        continue
    print("\n  CC %s" % setp)
    print("    %-4s %-10s %8s %9s %8s %10s %10s"
          % ("run", "팩", "평균W", "Wh", "전달률%", "핫스팟낙폭", "R_th C/W"))
    for r in sorted(rs, key=lambda x: -x["WH"]):
        print("    %-4s %-10s %8.3f %9.3f %8.1f %10s %10s"
              % (r["tag"], r["pack"], r["P"], r["WH"], r["xfer"],
                 fmt(r["drop_hot"], "%+.3f"), fmt(r["rth_tail"])))
    ps = [r["P"] for r in rs]
    print("    * 설정 전류는 같지만 실제 전력은 %.3f ~ %.3f W 로 %.1f%% 벌어져 있다"
          % (min(ps), max(ps), (max(ps) / min(ps) - 1) * 100))

print("\n[ 5. 재현성 ]")
pairs = {}
for r in res:
    pairs.setdefault((r["pack"], r["setp"]), []).append(r)
for k, v in pairs.items():
    if len(v) < 2:
        continue
    whs = [x["WH"] for x in v]
    print("  %s %s : %s  ->  편차 %.1f%%"
          % (k[0], k[1], " / ".join("%s %.3f Wh" % (x["tag"], x["WH"]) for x in v),
             (max(whs) - min(whs)) / mean(whs) * 100))

print("\n" + "=" * W)

# ---------------------------------------------------------------- HTML
if HTML:
    def td(x):
        return "<td>%s</td>" % x

    rows1 = "".join(
        "<tr><td class=tag>%s</td><td>%s</td><td>%s</td><td class=n>%.3f</td>"
        "<td class=n>%.3f</td><td class=n><b>%.3f</b></td><td class=n>%.0f</td>"
        "<td class=n>%.1f</td></tr>"
        % (r["tag"], r["pack"], r["setp"], r["live_h"], r["P"], r["WH"],
           r["AH"] * 1000, r["xfer"]) for r in res)
    rows2 = "".join(
        "<tr><td class=tag>%s</td><td>%s</td><td>%s</td><td class=n>%.3f</td>"
        "<td class=n>%s</td><td class=n>%s</td><td class=n><b>%s</b></td>"
        "<td class=n>%s</td><td>%s</td></tr>"
        % (r["tag"], r["pack"], r["setp"], r["P"], fmt(r["tail_min"], "%.0f"),
           fmt(r["drop_a"], "%+.3f"), fmt(r["rth_tail"]),
           fmt(r["amb_swing"], "%.2f"), "; ".join(r["flags"])) for r in res)
    html = """<meta charset="utf-8"><title>방전 run 교차비교</title>
<style>
body{font-family:system-ui,'Malgun Gothic',sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.6}
table{border-collapse:collapse;width:100%%;margin:1rem 0;font-size:.9rem}
th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left}
th{background:#f5f5f5}
td.n{text-align:right;font-variant-numeric:tabular-nums}
td.tag{font-weight:600}
h2{margin-top:2rem;border-bottom:2px solid #333;padding-bottom:.3rem}
</style>
<h1>방전 run 교차비교</h1>
<p>%s · %d run</p>
<h2>1. 에너지 · 용량</h2>
<table><tr><th>run</th><th>팩</th><th>설정</th><th>실방전 h</th><th>평균 W</th>
<th>Wh</th><th>mAh@5V</th><th>전달률 %%</th></tr>%s</table>
<h2>2. 발열 — 냉각 꼬리 진폭 (기준선 불필요)</h2>
<table><tr><th>run</th><th>팩</th><th>설정</th><th>평균 W</th><th>꼬리 분</th>
<th>낙폭 5a C</th><th>R_th C/W</th><th>실온진폭 C</th><th>비고</th></tr>%s</table>
""" % (datetime.now().strftime("%Y-%m-%d %H:%M"), len(res), rows1, rows2)
    with open(HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print(" HTML -> %s" % HTML)
