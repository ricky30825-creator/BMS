#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""방전 run 공용 분석기 (2026-08-21 개정판).

analyze_run.py 대비 달라진 것:
  * 파일명 하드코딩 제거 — run 디렉터리에서 *_ina*.csv / *_temp.csv / *_mlx*.csv 를 자동으로 찾는다
  * 1차 발열 지표를 delta_c -> mlx5a(obj-amb) 차분으로 교체
    (run 1에서 delta_c 는 정상상태 평균 -0.008C = 신호 없음이 확인됨)
  * 무부하 기준선(로드 ON 이전) 오프셋을 분리해 발열을 증분으로 계산
  * SOC 구간 분해 100-80 / 80-50 / 50-20 / 20-0 (추가 run 없이 SOC 축을 뽑는다)
  * 종료 후 냉각 꼬리에서 열시상수 tau 추정

사용법:
    python analyze_run2.py <run디렉터리> [--label-mah 10000] [--label-v 3.7] [--name PB-10000 2A]
"""
import csv
import glob
import math
import os
import sys
from datetime import datetime

# ---------------------------------------------------------------- 인자
if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)

RUN = os.path.abspath(sys.argv[1])
LABEL_MAH, LABEL_V, NAME = 20000.0, 3.7, None
FORCE_A = FORCE_B = FORCE_D = None
NO_GAP_FILL = "--no-gap-fill" in sys.argv   # 공백 동안 전류가 흐르지 않았을 때
for i, a in enumerate(sys.argv):
    if a == "--label-mah":
        LABEL_MAH = float(sys.argv[i + 1])
    if a == "--label-v":
        LABEL_V = float(sys.argv[i + 1])
    if a == "--name":
        NAME = sys.argv[i + 1]
    if a == "--base-ir":          # 로드 ON 이전 구간이 파일에 없을 때 수동으로 넘긴다
        FORCE_A = float(sys.argv[i + 1])
    if a == "--base-ir-b":
        FORCE_B = float(sys.argv[i + 1])
    if a == "--base-dc":
        FORCE_D = float(sys.argv[i + 1])
if NAME is None:
    NAME = os.path.basename(RUN.rstrip("\\/"))


def ts(s):
    return datetime.fromisoformat(s)


def find(patterns):
    """run 디렉터리에서 패턴에 맞는 파일을 시간순으로 모은다."""
    out = []
    for p in patterns:
        out += sorted(glob.glob(os.path.join(RUN, p)))
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def rd(path, cols):
    """CSV에서 timestamp + 지정 열을 읽는다. 없는 열은 None."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                t = ts(r["timestamp"])
            except Exception:
                continue
            vals = []
            for c in cols:
                try:
                    vals.append(float(r[c]))
                except Exception:
                    vals.append(None)
            rows.append((t,) + tuple(vals))
    return rows


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def std(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def fmt(v, spec="%.3f", dash="  --  "):
    return dash if v is None else spec % v


# ---------------------------------------------------------------- 파일 수집
ina_files = [p for p in find(["*_ina*.csv"]) if "aborted" not in os.path.basename(p)]
tmp_files = find(["*_temp.csv"])
mlx_files = find(["*_mlx*.csv"])

print("=" * 74)
print(" %s  방전 분석" % NAME)
print("=" * 74)
print("\n[ 입력 파일 ]")
for p in ina_files + tmp_files + mlx_files:
    print("  %-46s %8.1f MB" % (os.path.basename(p), os.path.getsize(p) / 1e6))
if not ina_files:
    print("\n  !! INA CSV를 찾지 못했다. run 디렉터리를 확인할 것.")
    sys.exit(1)

# ---------------------------------------------------------------- INA
ina = []
for p in ina_files:
    ina += rd(p, ["voltage_v", "current_a", "ovf"])
ina.sort(key=lambda x: x[0])
ina = [r for r in ina if r[1] is not None and r[2] is not None]

# 방전 시작 판정: 고정 0.1A 대신 피크의 30%를 문턱으로 쓴다.
# 본 방전 전에 낮은 전류로 시운전한 구간(예: 0.1A)이 시작점으로 잡히면
# 그 사이가 "기록 공백"으로 처리되어 평균전류로 보정되면서 에너지가 부풀려진다.
live = [r for r in ina if r[1] > 1.0]
peak = max((abs(r[2]) for r in live), default=0.0)
THR = max(0.1, 0.3 * peak)
disch = [r for r in live if abs(r[2]) >= THR]
if disch:
    print("")
    print("  방전 판정 문턱 %.3f A  (피크 %.3f A의 30%%)" % (THR, peak))
if not disch:
    print("\n  !! 방전 구간(V>1, |I|>0.1A)이 없다.")
    sys.exit(1)
t0, t1 = disch[0][0], disch[-1][0]
wall = (t1 - t0).total_seconds()

# 적분 + 누적 Ah 궤적 (SOC 구간 분해에 쓴다)
ah = wh = gap_s = 0.0
gaps = []
traj = []          # (시각, 그 시점까지의 누적 Ah)
prev = None
for (t, v, i, o) in disch:
    if prev is not None:
        dt = (t - prev[0]).total_seconds()
        if 0 < dt <= 1.0:
            ah += abs(i) * dt / 3600.0
            wh += abs(i) * prev[1] * dt / 3600.0
        elif dt > 1.0:
            gaps.append((prev[0], t, dt))
            gap_s += dt
    traj.append((t, ah))
    prev = (t, v, i, o)

vs = [r[1] for r in disch]
cs = [abs(r[2]) for r in disch]
ovf = sum(int(r[3] or 0) for r in disch)
I_avg, V_avg = sum(cs) / len(cs), sum(vs) / len(vs)
P_avg = I_avg * V_avg

if NO_GAP_FILL:
    ah_gap = wh_gap = 0.0
else:
    ah_gap = I_avg * gap_s / 3600.0
    wh_gap = ah_gap * V_avg
AH, WH = ah + ah_gap, wh + wh_gap

print("\n[ 시간 ]")
print("  시작 / 종료 : %s  ->  %s" % (t0, t1))
print("  총 경과     : %.0f s  (%.3f h)" % (wall, wall / 3600))
print("  기록 공백   : %.0f s  (%.2f 분, %d구간)" % (gap_s, gap_s / 60, len(gaps)))
for a, b, dt in gaps[:6]:
    print("     %s -> %s  (%.0f s)" % (a.strftime("%H:%M:%S"), b.strftime("%H:%M:%S"), dt))
print("  샘플        : %d" % len(disch))

print("\n[ 전기 ]")
print("  평균 전류   : %.4f A   (최소 %.4f / 최대 %.4f / 리플RMS %s)"
      % (I_avg, min(cs), max(cs), fmt(std(cs), "%.4f")))
print("  평균 전압   : %.4f V   (최소 %.4f / 최대 %.4f)" % (V_avg, min(vs), max(vs)))
print("  평균 부하   : %.3f W" % P_avg)
print("  OVF         : %d" % ovf)

label_wh = LABEL_MAH / 1000.0 * LABEL_V
print("\n[ 용량 · 에너지 ]  (5V 출력 기준)")
print("  적분값      : %.4f Ah   %.3f Wh   (기록 구간만)" % (ah, wh))
print("  공백 보정   : +%.4f Ah  +%.3f Wh%s" % (ah_gap, wh_gap,
      "   <- --no-gap-fill: 공백 동안 전류 없음으로 처리" if NO_GAP_FILL else ""))
print("  총계        : %.4f Ah   %.3f Wh" % (AH, WH))
print("\n[ 라벨 대비 ]")
print("  라벨        : %.0f mAh @ %.1f V = %.1f Wh  (셀 기준)" % (LABEL_MAH, LABEL_V, label_wh))
print("  전달률      : %.1f %%   <- Wh 기준. 이 값으로 비교할 것" % (WH / label_wh * 100))
print("  실측 용량   : %.0f mAh @5V  (라벨 mAh의 %.1f %% — 3.7V와 5V를 섞은 값이라 비교 금지)"
      % (AH * 1000, AH * 1000 / LABEL_MAH * 100))

# ---------------------------------------------------------------- 온도 / IR
temp = []
for p in tmp_files:
    temp += rd(p, ["ds18b20_c", "ds_ambient_c", "delta_c"])
temp.sort(key=lambda x: x[0])

mlx = []
for p in mlx_files:
    mlx += rd(p, ["mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"])
mlx.sort(key=lambda x: x[0])


def ir_diff(rows, lo, hi, zone="a"):
    """같은 MLX 안의 obj-amb 차분. 실온 드리프트가 상쇄되어 delta_c보다 안정적이다."""
    oi, ai = (1, 2) if zone == "a" else (3, 4)
    return [r[oi] - r[ai] for r in rows
            if lo <= r[0] <= hi and r[oi] is not None and r[ai] is not None]


# --- 무부하 기준선 (로드 ON 이전) ---
print("\n[ 무부하 기준선 ]  (로드 ON 이전 구간 — 이 오프셋을 빼야 발열 증분이 나온다)")
base_d = base_a = base_b = None
# 기준선은 로드 직전 3분만 쓴다 — 충전 직후 팩은 식는 중이라 전 구간 평균이 부풀려진다
_pt = [r for r in temp if r[0] < t0]
_pm = [r for r in mlx if r[0] < t0]
BASE_W = 180.0
pre_t = [r for r in _pt if (t0 - r[0]).total_seconds() <= BASE_W] or _pt
pre_m = [r for r in _pm if (t0 - r[0]).total_seconds() <= BASE_W] or _pm
if _pt and len(pre_t) < len(_pt):
    _full = mean([r[3] for r in _pt])
    _last = mean([r[3] for r in pre_t])
    if _full is not None and _last is not None and abs(_full - _last) > 0.15:
        print("  (무부하 %.1f분 중 마지막 3분만 사용 — 전구간 delta_c %+.3f vs 직전 %+.3f)"
              % ((t0 - _pt[0][0]).total_seconds() / 60, _full, _last))
if pre_t:
    base_d = mean([r[3] for r in pre_t])
    print("  구간 길이   : %.1f 분 (%d행, 로드 직전 창)" % ((t0 - pre_t[0][0]).total_seconds() / 60, len(pre_t)))
    print("  delta_c     : %s C" % fmt(base_d, "%+.3f"))
else:
    print("  !! 기준선 구간이 없다 — 로거를 로드보다 3분 먼저 띄울 것")
if pre_m:
    da = ir_diff(pre_m, pre_m[0][0], t0, "a")
    db = ir_diff(pre_m, pre_m[0][0], t0, "b")
    base_a, base_b = mean(da), mean(db)
if FORCE_A is not None:
    base_a = FORCE_A
    print("  mlx5a 차분  : %+.3f C   <- --base-ir 로 수동 지정 (파일에 무부하 구간 없음)" % base_a)
if FORCE_B is not None:
    base_b = FORCE_B
if FORCE_D is not None:
    base_d = FORCE_D
    print("  delta_c     : %+.3f C   <- --base-dc 로 수동 지정" % base_d)
    print("  mlx5a 차분  : %s C" % fmt(base_a, "%+.3f"))
    print("  mlx5b 차분  : %s C" % fmt(base_b, "%+.3f"))

# --- 방전 구간 발열 ---
inrun_t = [r for r in temp if t0 <= r[0] <= t1]
inrun_m = [r for r in mlx if t0 <= r[0] <= t1]

if inrun_t:
    # 2026-09-20: 셀 표면 DS 를 폐기했다(변환 실패 100%). 그 열은 통째로 비어
    # 있으므로 None 을 걸러내고, 없으면 "--" 로 찍는다. 표면은 IR max(5a,5b) 가 맡는다.
    cell = [r[1] for r in inrun_t if r[1] is not None]
    amb = [r[2] for r in inrun_t if r[2] is not None]
    dl = [r[3] for r in inrun_t if r[3] is not None]
    amb_swing = (max(amb) - min(amb)) if amb else 0.0
    print("\n[ 접촉 온도 (DS18B20) ]  방전구간 %d행" % len(inrun_t))
    if cell:
        print("  셀          : %.2f -> %.2f  (최대 %.2f)" % (cell[0], cell[-1], max(cell)))
    else:
        print("  셀          :   --   (셀 표면 DS 없음. IR 이 표면을 맡는다)")
    if amb:
        print("  실온        : %.2f -> %.2f  (진폭 %.2f C)" % (amb[0], amb[-1], amb_swing))
    else:
        print("  실온        :   --")
    if dl:
        print("  delta_c     : %+.2f -> %+.2f  (최대 %+.2f)" % (dl[0], dl[-1], max(dl)))
    else:
        print("  delta_c     :   --   (셀이 없어 계산 불가. 폐기된 지표라 영향 없음)")
    stable = []
    if len(dl) == len(inrun_t) and len(amb) == len(inrun_t):
        for k in range(0, len(inrun_t) - 60, 20):
            k2 = k + 60
            dt_h = (inrun_t[k2][0] - inrun_t[k][0]).total_seconds() / 3600
            if dt_h <= 0:
                continue
            if abs((amb[k2] - amb[k]) / dt_h) < 0.15:
                stable.append(dl[k])
    if stable:
        print("  정상상태    : %+.3f C  (실온 변화율<0.15C/h 인 %d표본)" % (mean(stable), len(stable)))
        print("                * 0에 가까우면 이 지표는 신호가 없다는 뜻 -> IR 차분을 쓸 것")
    if amb_swing > 1.0:
        print("  !! 실온이 %.2f C 흔들렸다. delta_c 단독 해석 금지." % amb_swing)

R_th = None
if inrun_m:
    da = ir_diff(inrun_m, t0, t1, "a")
    db = ir_diff(inrun_m, t0, t1, "b")
    # 정상상태 = 가운데 50% 구간
    mid = [r for r in inrun_m if t0.timestamp() + wall * 0.25
           <= r[0].timestamp() <= t0.timestamp() + wall * 0.75]
    da_ss, db_ss = mean(ir_diff(mid, t0, t1, "a")), mean(ir_diff(mid, t0, t1, "b"))
    print("\n[ IR 차분 (obj - amb, 같은 센서 내부) ]  방전구간 %d행   << 1차 발열 지표" % len(inrun_m))
    print("  mlx5a (케이스 중앙) : 평균 %s  최대 %s  정상상태 %s C"
          % (fmt(mean(da), "%+.3f"), fmt(max(da) if da else None, "%+.3f"), fmt(da_ss, "%+.3f")))
    print("  mlx5b (USB 포트쪽)  : 평균 %s  최대 %s  정상상태 %s C"
          % (fmt(mean(db), "%+.3f"), fmt(max(db) if db else None, "%+.3f"), fmt(db_ss, "%+.3f")))
    if da_ss is not None:
        rise = da_ss - (base_a if base_a is not None else 0.0)
        R_th = rise / P_avg if P_avg else None
        print("\n  기준선 대비 상승 : %+.3f C   (정상상태 %+.3f - 기준선 %s)"
              % (rise, da_ss, fmt(base_a, "%+.3f")))
        if base_a is None:
            print("  !! IR 기준선이 없어 0으로 가정했다. mlx_fast_log.py 도 로드보다 3분 먼저 띄울 것")
        print("  R_th             : %s C/W   <- mlx5a 차분 기준 (채택 지표)" % fmt(R_th))
        print("  * run 1(PB-20000 1A) 기준값 0.207 C/W. R_th는 전류와 무관해야 한다.")
        # --- 평형 도달 점검 ---
        n_m = len(inrun_m)
        early = mean(ir_diff(inrun_m[n_m // 4:n_m // 2], t0, t1, "a"))
        late = mean(ir_diff(inrun_m[-n_m // 10:], t0, t1, "a"))
        if early is not None and late is not None:
            drift = late - early
            print("")
            print("  평형 점검   : 전반 %+.3f -> 말미 %+.3f  (표류 %+.3f C)"
                  % (early, late, drift))
            if abs(drift) > 0.15:
                r_end = (late - (base_a or 0.0)) / P_avg
                print("  !! 평형에 도달하지 못했다 — IR 차분이 끝까지 %s 중이다."
                      % ("상승" if drift > 0 else "하강"))
                print("     위 R_th %s 는 %s이다. 말미값 기준 R_th = %s C/W."
                      % (fmt(R_th), "과소평가" if drift > 0 else "과대평가", fmt(r_end)))
                print("     run 길이(%.2f h)가 열시상수보다 짧으면 정상상태가 존재하지 않는다."
                      % (wall / 3600))

# ---------------------------------------------------------------- SOC 구간 분해
print("\n[ SOC 구간 분해 ]  (완전방전 run 하나에서 SOC 축을 뽑는다 — 추가 run 불필요)")
BOUNDS = [(100, 80), (80, 50), (50, 20), (20, 0)]


def t_at_soc(soc):
    """누적 Ah 궤적에서 해당 SOC 시점을 찾는다."""
    target = ah * (100 - soc) / 100.0
    for (t, cum) in traj:
        if cum >= target:
            return t
    return traj[-1][0]


print("  %-12s %8s %8s %8s %8s %10s %10s %9s"
      % ("구간", "길이h", "평균V", "평균A", "평균W", "IR차분C", "발열률C/h", "리플RMS"))
for (hi, lo) in BOUNDS:
    ta, tb = t_at_soc(hi), t_at_soc(lo)
    if (tb - ta).total_seconds() <= 0:
        continue
    seg_i = [r for r in disch if ta <= r[0] <= tb]
    if not seg_i:
        continue
    sv = mean([r[1] for r in seg_i])
    si = mean([abs(r[2]) for r in seg_i])
    sr = std([abs(r[2]) for r in seg_i])
    dur_h = (tb - ta).total_seconds() / 3600
    seg_m = [r for r in mlx if ta <= r[0] <= tb]
    d = ir_diff(seg_m, ta, tb, "a")
    ir_m = mean(d)
    rate = None
    if len(d) > 20 and dur_h > 0:
        n = max(1, len(d) // 10)
        rate = (mean(d[-n:]) - mean(d[:n])) / dur_h
    print("  SOC %3d-%-3d %8.3f %8.4f %8.4f %8.3f %10s %10s %9s"
          % (hi, lo, dur_h, sv, si, sv * si,
             fmt(ir_m, "%+.3f"), fmt(rate, "%+.3f"), fmt(sr, "%.4f")))

# ---------------------------------------------------------------- 냉각 꼬리 / 열시상수
print("\n[ 냉각 꼬리 — 열시상수 tau ]")
tail = [r for r in mlx if r[0] > t1]
if len(tail) < 50:
    print("  꼬리 데이터가 부족하다 (%d행). 종료 후 로거를 15분 더 돌릴 것." % len(tail))
else:
    d0 = mean(ir_diff(tail[:200], tail[0][0], tail[-1][0], "a"))
    base = base_a if base_a is not None else 0.0
    amp = (d0 - base) if d0 is not None else None
    print("  꼬리 길이   : %.1f 분 (%d행)" % ((tail[-1][0] - tail[0][0]).total_seconds() / 60, len(tail)))
    if amp and amp > 0.05:
        target = base + amp / math.e
        # 꼬리 IR은 잡음이 크다(+-0.5C). 30초 이동평균으로 평활한 뒤 1/e 교차를 찾는다.
        pts = [(r[0], r[1] - r[2]) for r in tail
               if r[1] is not None and r[2] is not None]
        sm, W = [], 30.0
        j = 0
        for k in range(len(pts)):
            while pts[k][0].timestamp() - pts[j][0].timestamp() > W:
                j += 1
            seg = [v for _, v in pts[j:k + 1]]
            sm.append((pts[k][0], sum(seg) / len(seg)))
        hit = None
        for (tt, v) in sm:
            if (tt - t1).total_seconds() < W:      # 평활 창이 다 차기 전은 건너뛴다
                continue
            if v <= target:
                hit = (tt - t1).total_seconds() / 60
                break
        print("  시작 차분   : %+.3f C  (기준선 %+.3f, 진폭 %.3f)" % (d0, base, amp))
        if hit:
            print("  tau (1/e)   : %.1f 분   (30초 이동평균 기준, 목표 %+.3f C)" % (hit, target))
            print("  * tau 는 표면의 경험적 냉각 시상수다. tau = R_th x C_th 로 열용량을")
            print("    유도하지 말 것 — 발열원이 내부에 있고 표면은 별도 열체라 단일 열체")
            print("    가정이 성립하지 않는다 (그렇게 풀면 C_th 가 실물의 20배로 나온다).")
        else:
            print("  1/e 도달 안 함 — 꼬리를 더 길게 기록할 것")
    else:
        print("  진폭이 너무 작아 tau를 못 낸다 (발열 %s C)" % fmt(amp, "%+.3f"))

# ---------------------------------------------------------------- 컷오프
print("\n[ 방전 종료 컷오프 ]")
last_ok = disch[-1]
after = [r for r in ina if r[0] > last_ok[0]][:8]
print("  마지막 정상 : %s  %.4f V  %+.4f A"
      % (last_ok[0].strftime("%H:%M:%S.%f")[:-3], last_ok[1], last_ok[2]))
for (t, v, i, o) in after:
    print("    +%6.2f s   %.4f V  %+.4f A" % ((t - last_ok[0]).total_seconds(), v, i))

# ---------------------------------------------------------------- 한 줄 요약
print("\n" + "=" * 74)
print(" 요약  %s" % NAME)
print("  %.3f Wh / %.0f mAh @5V  |  전달률 %.1f%%  |  %.3f h  |  평균 %.3f W"
      % (WH, AH * 1000, WH / label_wh * 100, wall / 3600, P_avg))
print("  R_th %s C/W (mlx5a 차분)  |  실온 진폭 %s C"
      % (fmt(R_th), fmt(max([r[2] for r in inrun_t]) - min([r[2] for r in inrun_t]), "%.2f")
         if inrun_t else "--"))
print("=" * 74)
