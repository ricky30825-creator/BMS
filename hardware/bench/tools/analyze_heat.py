#!/usr/bin/env python3
"""analyze_heat.py — 가열(환경 열 스트레스) run 분석.

  python analyze_heat.py <run디렉터리> <접두> [--post-max-min 15] [--out <디렉터리>]

입력(접두 = 예: PB5000_r16_1A_heat):
  <접두>_ina.csv     0.1초  voltage_v, current_a, power_w
  <접두>_temp.csv    ~1초   ds18b20_c(=근처 공기 NEAR), ds_ambient_c(=먼 프로브 FAR, 실온)
  <접두>_mlx01.csv   0.1초  mlx5a_obj_c, mlx5b_obj_c, temp_ir_surface(=max)
  <접두>_events.csv         timestamp,label   (heat_on / heat_off)

⚠ ds18b20_c 는 접촉 온도가 아니라 근처 공기다. 출력 CSV 는 열 이름을 ds_near_c / ds_far_c 로
  바꿔 6채널 학습에 실수로 못 들어가게 한다.

구간 라벨:
  pre   첫 heat_on 이전
  heat  heat_on ~ heat_off
  post  heat_off ~ 표면(IR max) 최고점 (열이 아직 침투 중, 최대 --post-max-min 분)
  tail  그 이후 (냉각 꼬리)
heat_on/off 가 여러 쌍이면 각 쌍의 구간을 heat 로 칠하고, 통계는 첫 on ~ 마지막 off 기준.
"""
import argparse, os, sys
import numpy as np
import pandas as pd

LAG_THR_C = 0.5       # 응답 지연: 가열 전 중앙값보다 이만큼 오른 첫 시각
GRID = "1s"


def read_ts(path, cols=None):
    df = pd.read_csv(path, usecols=cols) if cols else pd.read_csv(path)
    ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=False)
    if getattr(ts.dt, "tz", None) is not None:      # events 는 `date -Is` 라 +09:00 이 붙는다
        ts = ts.dt.tz_localize(None)
    df["timestamp"] = ts
    return df.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)


def per_second(df, cols, how="mean"):
    d = df.set_index("timestamp")[cols].apply(pd.to_numeric, errors="coerce")
    return getattr(d.resample(GRID), how)()


def load(run_dir, prefix):
    p = lambda s: os.path.join(run_dir, f"{prefix}_{s}.csv")
    for s in ("ina", "temp", "mlx01", "events"):
        if not os.path.exists(p(s)):
            sys.exit(f"없음: {p(s)}")
    ina = per_second(read_ts(p("ina")), ["voltage_v", "current_a", "power_w"])
    mlx = per_second(read_ts(p("mlx01")), ["mlx5a_obj_c", "mlx5b_obj_c", "temp_ir_surface"])
    tmp = read_ts(p("temp"))
    # DS 는 ~1.8초 간격 → 1초 격자에 5초까지만 이어 붙인다 (그 이상 비면 NaN 으로 둔다)
    ds = per_second(tmp, ["ds18b20_c", "ds_ambient_c"], "last").ffill(limit=5)
    ev = read_ts(p("events"))
    ev["label"] = ev["label"].astype(str).str.strip()
    g = ina.join(mlx, how="outer").join(ds, how="outer")
    g = g.rename(columns={"mlx5a_obj_c": "ir_a_c", "mlx5b_obj_c": "ir_b_c",
                          "temp_ir_surface": "ir_max_c",
                          "ds18b20_c": "ds_near_c", "ds_ambient_c": "ds_far_c"})
    # IR max 는 로거 값이 비면 두 존에서 다시 계산
    g["ir_max_c"] = g["ir_max_c"].fillna(g[["ir_a_c", "ir_b_c"]].max(axis=1))
    g.index.name = "timestamp"
    return g, ev


def pairs(ev):
    on = None; out = []
    for _, r in ev.iterrows():
        if r.label == "heat_on" and on is None:
            on = r.timestamp
        elif r.label == "heat_off" and on is not None:
            out.append((on, r.timestamp)); on = None
    if on is not None:
        print(f"⚠ heat_on({on}) 뒤에 heat_off 가 없다 — 데이터 끝까지를 가열로 본다")
        out.append((on, None))
    if not out:
        sys.exit("events 에 heat_on/heat_off 쌍이 없다")
    return out


def label(g, prs, post_max_min, ev=None, pre_min=10):
    t0 = prs[0][0]
    t1 = prs[-1][1] or g.index[-1]
    lab = pd.Series("pre", index=g.index, dtype=object)
    lab[g.index < t0 - pd.Timedelta(minutes=pre_min)] = "idle"   # 가열 전 기준선 창 밖 (대기·정착)
    lab[g.index >= t0] = "tail"
    # post = 마지막 off ~ 그 뒤 표면 최고점
    after = g[(g.index >= t1) & (g.index <= t1 + pd.Timedelta(minutes=post_max_min))]["ir_max_c"]
    t_pk = after.idxmax() if after.notna().any() else t1
    lab[(g.index >= t1) & (g.index <= t_pk)] = "post"
    # 가열이 여러 번이면 가열 사이 구간(식히기·재방전)은 꼬리가 아니라 between 으로 따로 둔다
    for (a0, b0), (a1, _b1) in zip(prs, prs[1:]):
        if b0 is not None:
            lab[(g.index >= b0) & (g.index < a1)] = "between"
    for a, b in prs:
        lab[(g.index >= a) & (g.index < (b or g.index[-1] + pd.Timedelta(seconds=1)))] = "heat"
    # heat_off 뒤에 방전을 다시 시작(go)했으면 그 이후는 꼬리가 아니라 resume 으로 따로 둔다
    if ev is not None:
        regos = ev[(ev["label"] == "go") & (ev["timestamp"] > t1)]["timestamp"]
        if len(regos):
            lab[g.index >= regos.iloc[0]] = "resume"
    return lab, t0, t1, t_pk


def seg_stats(g, lab, chans):
    rows = []
    for name in ("idle", "pre", "heat", "between", "post", "tail", "resume"):
        s = g[lab == name]
        if s.empty:
            continue
        for c in chans:
            x = s[c].dropna()
            if x.empty:
                continue
            rows.append(dict(구간=name, 채널=c, 시작s=round((s.index[0] - g.index[0]).total_seconds()),
                             길이s=len(s), 평균=x.mean(), 시작값=x.iloc[0], 끝값=x.iloc[-1],
                             최소=x.min(), 최대=x.max(), 최대시각=x.idxmax().strftime("%H:%M:%S")))
    return pd.DataFrame(rows)


def lag(g, lab, t0, c):
    """가열 전 중앙값보다 LAG_THR_C 오른 첫 시각까지의 지연(s). 못 오르면 None."""
    base = g.loc[lab == "pre", c].dropna()
    if len(base) < 30:
        return None, None
    med = base.median()
    after = g.loc[g.index >= t0, c].dropna()
    hit = after[after >= med + LAG_THR_C]
    return (None if hit.empty else (hit.index[0] - t0).total_seconds()), med


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap =argparse.ArgumentParser()
    ap.add_argument("run_dir"); ap.add_argument("prefix")
    ap.add_argument("--post-max-min", type=float, default=15)
    ap.add_argument("--pre-min", type=float, default=10, help="가열 전 기준선으로 쓸 heat_on 직전 분")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = a.out or a.run_dir

    g, ev = load(a.run_dir, a.prefix)
    prs = pair_list = pairs(ev)
    lab, t0, t1, t_pk = label(g, prs, a.post_max_min, ev, a.pre_min)

    g["surf_minus_far_c"] = g["ir_max_c"] - g["ds_far_c"]
    g["surf_minus_near_c"] = g["ir_max_c"] - g["ds_near_c"]
    g["heat"] = lab
    g["t_rel_heat_on_s"] = (g.index - t0).total_seconds().round(1)

    # ── 1초 격자 CSV (6채널 학습 금지 표시) ──
    cols = ["t_rel_heat_on_s", "heat", "voltage_v", "current_a", "power_w",
            "ir_a_c", "ir_b_c", "ir_max_c", "ds_near_c", "ds_far_c",
            "surf_minus_far_c", "surf_minus_near_c"]
    csv_path = os.path.join(out, f"{a.prefix}_1s_heat.csv")
    g[cols].round(4).to_csv(csv_path, encoding="utf-8")

    chans = ["ir_max_c", "ir_a_c", "ir_b_c", "ds_near_c", "ds_far_c",
             "surf_minus_far_c", "surf_minus_near_c", "voltage_v", "current_a", "power_w"]
    st = seg_stats(g, lab, chans)

    L = []
    P = L.append
    P(f"# 가열 run 분석 — {a.prefix}\n")
    P(f"- 기록 {g.index[0]:%H:%M:%S} ~ {g.index[-1]:%H:%M:%S}  ({(g.index[-1]-g.index[0]).total_seconds()/60:.1f}분)")
    P(f"- 가열 {len(prs)}회: " + ", ".join(f"{x:%H:%M:%S}~{(y.strftime('%H:%M:%S') if y is not None else '끝')}" for x, y in prs))
    P(f"- 구간(초): " + ", ".join(f"{k} {int((lab==k).sum())}" for k in ("idle", "pre", "heat", "between", "post", "tail", "resume") if (lab == k).any()))
    P("  (idle = 기준선 창 밖 대기·정착, resume = heat_off 이후 재방전. 둘 다 아래 통계에서 제외)")
    P(f"- post 끝(표면 최고점): {t_pk:%H:%M:%S}  (heat_off 후 {(t_pk - t1).total_seconds():.0f}s)\n")
    for c in ("ds_near_c", "ds_far_c"):
        n = g[c].notna().mean()
        if n < 0.5:
            P(f"⚠ {c} 결측 {100*(1-n):.0f}% — 프로브 85.0℃/미연결 의심")
    P("")

    # ── 구간별 통계 ──
    P("## 구간별 변화 (가열 전 평균 대비)\n")
    P("| 채널 | 가열 전 | 가열 중 최대 | Δ최대 | 가열 후(최고점) | 꼬리 끝 | 최대 시각 |")
    P("|---|---|---|---|---|---|---|")
    for c in chans[:7]:
        pre = g.loc[lab == "pre", c].dropna()
        if pre.empty:
            continue
        b = pre.mean()
        hv = g.loc[lab == "heat", c].dropna()
        pv = g.loc[lab.isin(["heat", "post"]), c].dropna()
        tv = g.loc[lab == "tail", c].dropna()
        mx = pv.max() if not pv.empty else np.nan
        P(f"| {c} | {b:.2f} | {hv.max() if not hv.empty else np.nan:.2f} | {mx-b:+.2f} | "
          f"{g.loc[lab=='post', c].dropna().max() if (lab=='post').any() and g.loc[lab=='post', c].notna().any() else float('nan'):.2f} | "
          f"{tv.iloc[-300:].mean() if not tv.empty else float('nan'):.2f} | {pv.idxmax().strftime('%H:%M:%S') if not pv.empty else '-'} |")
    P("")

    # ── 응답 지연 ──
    P(f"## 응답 지연 (heat_on 후 가열 전 중앙값 +{LAG_THR_C}℃ 도달까지, 및 최고점까지)\n")
    P("| 채널 | 지연 s | 최고점까지 s |")
    P("|---|---|---|")
    for c in ("ir_max_c", "ir_a_c", "ir_b_c", "ds_near_c", "ds_far_c"):
        d, _ = lag(g, lab, t0, c)
        win = g.loc[(g.index >= t0) & (g.index <= t_pk + pd.Timedelta(minutes=a.post_max_min)), c].dropna()
        pk = (win.idxmax() - t0).total_seconds() if not win.empty else None
        P(f"| {c} | {'오르지 않음' if d is None else f'{d:.0f}'} | {'-' if pk is None else f'{pk:.0f}'} |")
    P("")

    # ── 환경 열 판별: 표면−먼 vs 표면−근처 ──
    P("## 환경 열 판별 — (표면−먼 프로브) vs (표면−근처 프로브)\n")
    P("환경만 데우면 먼 프로브는 거의 안 오르므로 (표면−먼)이 부풀어 **자체 발열처럼 보이고**,")
    P("근처 프로브는 표면과 같이 오르므로 (표면−근처)는 작게 남는다. 둘이 갈릴수록 근처 프로브가 환경 열을 걸러 준다.\n")
    P("| 지표 | 가열 전 | 가열 중 최대 | 변화 | 가열 후 최고점 | 꼬리 끝 5분 |")
    P("|---|---|---|---|---|---|")
    res = {}
    for c in ("surf_minus_far_c", "surf_minus_near_c"):
        pre = g.loc[lab == "pre", c].dropna()
        if pre.empty:
            continue
        b = pre.mean()
        hp = g.loc[lab.isin(["heat", "post"]), c].dropna()
        pk = g.loc[lab == "post", c].dropna()
        tl = g.loc[lab == "tail", c].dropna()
        res[c] = hp.max() - b if not hp.empty else np.nan
        P(f"| {c} | {b:+.2f} | {hp.max():+.2f} | {res[c]:+.2f} | "
          f"{(pk.iloc[-1] if not pk.empty else float('nan')):+.2f} | {(tl.iloc[-300:].mean() if not tl.empty else float('nan')):+.2f} |")
    if len(res) == 2 and res["surf_minus_near_c"] == res["surf_minus_near_c"]:
        rf, rn = res["surf_minus_far_c"], res["surf_minus_near_c"]
        P(f"\n→ 가열 중 (표면−먼) {rf:+.2f}℃ 변화 vs (표면−근처) {rn:+.2f}℃ 변화. "
          + (f"먼 프로브 기준이 {rf/rn:.1f}배 크게 흔들린다." if abs(rn) > 0.05 else "근처 기준은 사실상 변화 없음."))
        P("  (한 run 의 결과다. 근처 프로브 위치·바람 방향에 민감하므로 재현 run 이 있어야 일반화할 수 있다.)")
    P("")

    # ── 전기 ──
    P("## 전기 (가열이 전압·전류에 영향을 주었는가)\n")
    P("| 채널 | 가열 전 평균(±σ) | 가열 중 평균(±σ) | Δ평균 | Δ% | 가열 중 최소~최대 |")
    P("|---|---|---|---|---|---|")
    on = g["current_a"] < -0.5       # 방전 중 샘플만 (대기·무부하 제외)
    for c in ("voltage_v", "current_a", "power_w"):
        pr = g.loc[(lab == "pre") & on, c].dropna(); hv = g.loc[(lab == "heat") & on, c].dropna()
        if pr.empty or hv.empty:
            continue
        d = hv.mean() - pr.mean()
        pct = 100 * d / pr.mean() if abs(pr.mean()) > 1e-9 else float("nan")
        P(f"| {c} | {pr.mean():.4f} (±{pr.std():.4f}) | {hv.mean():.4f} (±{hv.std():.4f}) | {d:+.4f} | {pct:+.2f}% | {hv.min():.4f} ~ {hv.max():.4f} |")
    P("\n⚠ 가열 전(pre) 구간에 방전이 이미 걸려 있어야 비교가 성립한다. 방전 전이면 전류가 0 에서 올라가는 변화가 섞인다.")
    P("  전압은 SOC 로도 내려가므로, 같은 시간 폭의 가열 전·꼬리 구간과 함께 보는 것이 안전하다.\n")

    P("## 산출물\n")
    P(f"- `{os.path.basename(csv_path)}` — 1초 격자, heat 라벨 열 포함 (pre/heat/post/tail)")
    P("- **6채널 학습에 쓰지 말 것**: ds_near_c 는 접촉 온도가 아니라 근처 공기. 열 이름도 일부러 바꿨다.")
    md = "\n".join(L)
    md_path = os.path.join(out, f"{a.prefix}_heat_report.md")
    open(md_path, "w", encoding="utf-8").write(md)
    st.to_csv(os.path.join(out, f"{a.prefix}_heat_segments.csv"), index=False, encoding="utf-8")
    print(md)
    print(f"\n[저장] {csv_path}\n       {md_path}")


if __name__ == "__main__":
    main()
