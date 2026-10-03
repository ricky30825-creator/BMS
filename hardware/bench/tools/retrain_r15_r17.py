#!/usr/bin/env python3
"""retrain_r15_r17.py -- r15 + r17 을 합친 5채널(local_relative5) 재학습과 채점을 한 번에 돌린다.

  python retrain_r15_r17.py                 # 전체 (CPU 에서 수십 분 걸릴 수 있다)
  python retrain_r15_r17.py --smoke         # 동작 확인용: 1 epoch, 300 window, 몇 분
  python retrain_r15_r17.py --skip-train    # 학습은 건너뛰고 기존 산출물로 채점만

단계
  1. r17 원자료를 preprocess 형식으로 맞춘다(INA 적분으로 soc.csv 생성) -> 1초 processed CSV
  2. 학습 폴더를 만든다: 기존 pb_part2 + r15 + r17 의 **가열 전 구간만**
     (가열·가열 후·부하 끊김 구간은 학습에 넣지 않는다. 정상만 학습하는 모델이라 열이 '정상'으로 학습되면 안 된다)
  3. 5채널로 학습한다 (features.set_active_core(CORE5) 를 먼저 불러야 접촉 온도가 없는 run 이 안 빠진다)
  4. r15 와 r17 전체를 창 단위로 채점하고, r17 은 구간 라벨(pre/heat/post/load_off)별로 요약한다

주의
  - r15 와 r17(가열 전)은 이제 학습에 들어간다. 그 구간의 오탐률은 처음 보는 run 의 성능이 아니다.
  - r17 의 가열 구간은 학습에 안 들어갔지만, per_run 보정은 가열 전 구간으로 맞춘다
    ("처음 몇 분을 기준선으로 쓴 뒤 이상을 본다"는 시나리오). global 보정이 선택되면 그 값이 쓰인다.
  - 개발 단계 수치다. hold-out 검정이 아니다.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HOME = Path.home()
DESK = HOME / "Desktop"
PB_CAPACITY_AH = 10.93      # PB-20000 완충 5V 기준 (r1 실측 10,928 mAh). 5채널 모델은 soc 를 안 쓴다 — 결측 판정용
R17_PREFIX = "PB20000_r17_1A_heat"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- 1. r17 -> preprocess 형식
def read_ts(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    ts = pd.to_datetime(df["timestamp"], errors="coerce")
    if getattr(ts.dt, "tz", None) is not None:
        ts = ts.dt.tz_localize(None)
    df["timestamp"] = ts
    return df.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)


def heat_pairs(events: Path) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    ev = read_ts(events)
    ev["label"] = ev["label"].astype(str).str.strip()
    pairs, on = [], None
    for _, r in ev.iterrows():
        if r.label == "heat_on" and on is None:
            on = r.timestamp
        elif r.label == "heat_off" and on is not None:
            pairs.append((on, r.timestamp)); on = None
    if on is not None:
        pairs.append((on, ev.timestamp.max()))
    return pairs


def make_r17_raw_dir(src: Path, dst_root: Path) -> Path:
    """preprocess 가 읽는 PB20000/run_r17_1A_heat/{ina,soc,temp}.csv 를 만든다."""
    run = dst_root / "PB20000" / "run_r17_1A_heat"
    run.mkdir(parents=True, exist_ok=True)
    shutil.copy(src / f"{R17_PREFIX}_ina.csv", run / "ina.csv")
    shutil.copy(src / f"{R17_PREFIX}_temp.csv", run / "temp.csv")

    # soc.csv: 1초 평균 IR + INA 적분 SOC
    mlx = read_ts(src / f"{R17_PREFIX}_mlx01.csv")
    cols = ["mlx5a_obj_c", "mlx5a_amb_c", "mlx5b_obj_c", "mlx5b_amb_c"]
    sec = mlx.set_index("timestamp")[cols].apply(pd.to_numeric, errors="coerce").resample("1s").mean()
    sec["ir_diff_5a_c"] = sec.mlx5a_obj_c - sec.mlx5a_amb_c
    sec["ir_diff_5b_c"] = sec.mlx5b_obj_c - sec.mlx5b_amb_c

    ina = read_ts(src / f"{R17_PREFIX}_ina.csv")
    dt = ina.timestamp.diff().dt.total_seconds().fillna(0).clip(0, 1.0)      # 로그가 끊긴 구간은 적분 안 한다
    amp = -pd.to_numeric(ina["current_a"], errors="coerce").fillna(0).clip(upper=0)   # 방전 전류(양수)
    ah = (amp * dt / 3600.0).cumsum()
    soc = pd.Series(100.0 - 100.0 * ah.to_numpy() / PB_CAPACITY_AH, index=ina.timestamp)
    soc = soc[~soc.index.duplicated(keep="last")].resample("1s").last().ffill()
    sec["soc_pct"] = soc.reindex(sec.index).ffill().bfill()
    sec["ds_cell_c"] = np.nan          # 접촉 프로브 없음
    sec["delta_c"] = np.nan
    out = sec.reset_index().rename(columns={"index": "timestamp"})
    out = out[["timestamp", "soc_pct", "ds_cell_c", "delta_c", "mlx5a_obj_c", "mlx5a_amb_c", "ir_diff_5a_c",
               "mlx5b_obj_c", "mlx5b_amb_c", "ir_diff_5b_c"]]
    out.to_csv(run / "soc.csv", index=False)
    return run


def preprocess_r17(bms: Path, raw_root: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "ai.model.preprocess", "--data-root", str(raw_root), "--output", str(out_dir), "--core5"]
    env = dict(os.environ, PYTHONPATH=str(bms), PYTHONUTF8="1")
    subprocess.run(cmd, cwd=bms, env=env, check=True)
    files = sorted(out_dir.glob("PB20000_run_r17_*.csv"))
    if not files:
        raise SystemExit("r17 processed CSV 가 안 만들어졌다")
    return files[0]


# ---------------------------------------------------------------- 2. 학습 폴더
def build_train_dir(proc_r17: Path, pairs, train_dir: Path) -> dict:
    if train_dir.exists():
        shutil.rmtree(train_dir)
    train_dir.mkdir(parents=True)
    n = 0
    for f in sorted((DESK / "ai_processed" / "pb_part2").glob("*_run_*.csv")):
        shutil.copy(f, train_dir / f.name); n += 1
    r15 = DESK / "ai_processed" / "live" / "PB20000_run_r15_2A.csv"
    shutil.copy(r15, train_dir / r15.name); n += 1
    frame = pd.read_csv(proc_r17)
    ts = pd.to_datetime(frame.timestamp)
    first_on = pairs[0][0]
    pre = frame[ts < first_on]
    pre.to_csv(train_dir / "PB20000_run_r17pre_1A.csv", index=False)   # 정상 학습용: 가열 전만
    log(f"학습 폴더: 기존 {n}개 run + r17pre({len(pre)}초, 가열 시작 {first_on:%H:%M:%S} 이전)")
    return dict(runs=n + 1, r17pre_seconds=len(pre))


def train(bms: Path, train_dir: Path, art_dir: Path, args) -> None:
    code = (
        "import sys; from ai.model import features, train; "
        "features.set_active_core(features.CORE5); "
        "sys.argv = ['train'] + %r; train.main()"
    )
    targs = ["--processed", str(train_dir), "--output", str(art_dir), "--feature-sets", "local_relative5",
             "--epochs", str(args.epochs), "--seed", str(args.seed), "--threads", str(args.threads)]
    if args.epochs >= 2:
        targs += ["--checkpoint-epochs", "2", str(args.epochs)]
    targs += ["--synthetic-per-run", str(args.synthetic)]
    if args.max_windows:
        targs += ["--max-windows", str(args.max_windows)]
    env = dict(os.environ, PYTHONPATH=str(bms), PYTHONUTF8="1")
    log("학습 시작: " + " ".join(targs))
    t0 = time.time()
    subprocess.run([sys.executable, "-c", code % targs], cwd=bms, env=env, check=True)
    log(f"학습 끝 ({(time.time() - t0) / 60:.1f}분)")


# ---------------------------------------------------------------- 4. 채점
def auroc(neg: np.ndarray, pos: np.ndarray) -> float:
    if len(neg) == 0 or len(pos) == 0:
        return float("nan")
    allv = np.r_[neg, pos]
    ranks = pd.Series(allv).rank().to_numpy()
    return float((ranks[len(neg):].sum() - len(pos) * (len(pos) + 1) / 2) / (len(neg) * len(pos)))


def score_run(scorer, frame: pd.DataFrame, run_key: str) -> pd.DataFrame:
    from ai.model.features import CONTEXT, CORE5, HISTORY, PREDICTION, run_windows
    from ai.model.preprocess import FEATURES
    raw, index = run_windows(frame, stride=10)
    # BaselineScorer.score 는 133x10 전체가 유한값이어야 통과시킨다. 5채널 모드가 안 쓰는 열
    # (cell_temp_c·delta_c 등, 이 run 들은 접촉 프로브가 없어 결측)은 0 으로 채운다. 모델 입력에는 영향이 없다.
    unused = [i for i, name in enumerate(FEATURES) if name not in CORE5 and name != "power_discharge_w"]
    raw = raw.copy()
    raw[:, :, unused] = 0.0
    ts = pd.to_datetime(frame.timestamp).to_numpy()
    rows = []
    for i, start in enumerate(index):
        try:
            r = scorer.score(raw[i:i + 1], run_key)
        except ValueError as exc:
            log(f"채점 불가 {run_key} start={start}: {exc}"); break
        w0, w1 = start - CONTEXT, start + HISTORY + PREDICTION          # 창이 덮는 행 [w0, w1)
        cur = frame.current_discharge_a.to_numpy()[w0:w1]
        rows.append(dict(start_idx=int(start), t_start=pd.Timestamp(ts[w0]), t_end=pd.Timestamp(ts[w1 - 1]),
                         min_current_a=float(np.nanmin(cur)), ae=r["ae_score"], informer=r["informer_score"],
                         final=r["final_score"], risk_index=r["risk_index"], over_threshold=r["anomaly_flag"]))
    return pd.DataFrame(rows)


def label_r17(df: pd.DataFrame, pairs) -> pd.DataFrame:
    if df.empty:
        raise SystemExit("r17 채점 결과가 비었다 — 창이 없거나 채점이 모두 거부됐다. 위의 '채점 불가' 로그를 확인")

    def lab(row):
        if row.min_current_a < 0.5:
            return "load_off"                      # 부하가 끊긴 구간(팩이 잠들었거나 stop) — 이상 판정에서 제외
        if any(row.t_end >= a and row.t_start <= b for a, b in pairs):
            return "heat"
        if row.t_start >= pairs[-1][1]:
            return "after"
        if row.t_end < pairs[0][0]:
            return "pre"
        return "between"
    df = df.copy()
    df["label"] = df.apply(lab, axis=1)
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bms", type=Path, default=DESK / "프론트,백엔드" / "BMS", help="BMS 저장소 경로 (feat/mode2-5feature)")
    ap.add_argument("--r17", type=Path, default=DESK / "PB20000_r17_1A_heat_20261003", help="r17 회수 폴더")
    ap.add_argument("--out", type=Path, default=DESK / "ai_retrain_r15_r17")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--synthetic", type=int, default=16, help="--synthetic-per-run")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--max-windows", type=int, default=None)
    ap.add_argument("--smoke", action="store_true", help="1 epoch, 300 window, synthetic 2 (동작 확인용)")
    ap.add_argument("--skip-train", action="store_true", help="기존 --out/artifacts 로 채점만")
    args = ap.parse_args()
    if args.smoke:
        args.epochs, args.max_windows, args.synthetic = 1, 300, 2
    if not (args.bms / "ai" / "model" / "train.py").exists():
        raise SystemExit(f"BMS 저장소를 못 찾았다: {args.bms}")
    sys.path.insert(0, str(args.bms))

    out = args.out / ("smoke" if args.smoke else "full")
    art = out / "artifacts"
    out.mkdir(parents=True, exist_ok=True)
    pairs = heat_pairs(args.r17 / f"{R17_PREFIX}_events.csv")
    log("가열 구간: " + ", ".join(f"{a:%H:%M:%S}~{b:%H:%M:%S}" for a, b in pairs))

    # 1) r17 -> processed
    raw_root = out / "r17_raw"
    make_r17_raw_dir(args.r17, raw_root)
    proc_dir = out / "r17_processed"
    proc_r17 = preprocess_r17(args.bms, raw_root, proc_dir)
    log(f"r17 processed: {proc_r17.name}")

    # 2) 학습 폴더 + 3) 학습
    train_dir = out / "train_processed"
    info = build_train_dir(proc_r17, pairs, train_dir)
    if not args.skip_train:
        train(args.bms, train_dir, art, args)

    # 4) 채점
    import torch
    from ai.model import features
    from ai.model.predict import BaselineScorer
    features.set_active_core(features.CORE5)
    torch.set_num_threads(max(1, args.threads))
    scorer = BaselineScorer(art)
    cfg = scorer.config
    scope = cfg["ae"]["scope"], cfg["informer"]["scope"]
    thr = cfg["fusion"]["threshold"]
    log(f"선택된 설정: fusion={cfg['fusion']['kind']} alpha_ae={cfg['fusion'].get('alpha_ae')} 보정={scope} "
        f"임계값={thr:.4f} (normal_far={cfg['fusion']['normal_far']:.2%} tpr={cfg['fusion']['tpr']:.2%} auc={cfg['fusion']['auc']:.4f})")

    results = {}
    r15 = pd.read_csv(DESK / "ai_processed" / "live" / "PB20000_run_r15_2A.csv")
    d15 = score_run(scorer, r15, "PB20000_run_r15_2A")
    d15.to_csv(out / "r15_scores.csv", index=False)
    r17 = pd.read_csv(proc_r17)
    key17 = "PB20000_run_r17pre_1A"      # per_run 이면 가열 전 구간으로 맞춘 보정값을 쓴다
    lacks = [m for m in ("ae", "informer") if cfg[m]["scope"] == "per_run" and key17 not in cfg[f"{m}_calibration"]]
    if lacks:
        log(f"경고: {key17} 의 per_run 보정값이 없다(--max-windows 로 창을 줄인 스모크에서만 생긴다). "
            "r15 보정값으로 대체한다 — 이 결과는 동작 확인용이다")
        key17 = "PB20000_run_r15_2A"
    d17 = score_run(scorer, r17, key17)
    d17 = label_r17(d17, pairs)
    d17.to_csv(out / "r17_scores.csv", index=False)

    L = ["# r15 + r17 합친 5채널 재학습·채점 결과", "",
         f"- 설정: local_relative5, epochs {args.epochs}, seed {args.seed}, 보정 {scope}, 임계값 {thr:.4f}",
         f"- 학습 run {info['runs']}개 (기존 pb_part2 + r15 + r17 가열 전 {info['r17pre_seconds']}초)",
         f"- 선택 설정의 개발 단계 지표: 정상 오탐 {cfg['fusion']['normal_far']:.2%}, 합성 이상 탐지 {cfg['fusion']['tpr']:.2%}, AUROC {cfg['fusion']['auc']:.4f}",
         "", "## r15 (정상 run, 이제 학습에 포함 — 처음 보는 run 의 성능이 아니다)", "",
         f"- 창 {len(d15)}개, 임계값 초과 {int(d15.over_threshold.sum())}개 ({d15.over_threshold.mean():.2%}), 최고점 {d15.final.max():.3f}",
         "", "## r17 구간별 (가열 구간은 학습에 안 들어갔다)", "",
         "| 구간 | 창 수 | 임계값 초과 | 비율 | 최고점 | 평균 위험지수 |", "|---|---|---|---|---|---|"]
    for name in ["pre", "heat", "between", "after", "load_off"]:
        s = d17[d17.label == name]
        if len(s):
            L.append(f"| {name} | {len(s)} | {int(s.over_threshold.sum())} | {s.over_threshold.mean():.1%} | {s.final.max():.3f} | {s.risk_index.mean():.0f} |")
    pre_s, heat_s = d17[d17.label == "pre"].final.to_numpy(), d17[d17.label == "heat"].final.to_numpy()
    L += ["", f"- pre 대 heat AUROC: {auroc(pre_s, heat_s):.3f} (pre 는 학습·보정에 쓰였으므로 낙관적이다)",
          "- `load_off` 창은 부하가 끊겨 전류가 0 에 가까운 구간이라 이상 판정에서 뺐다.",
          "- 가열 구간의 일부가 INA 로그 공백이면 창이 만들어지지 않아 채점에서 빠진다.",
          "- 한 run, 한 팩의 결과이며 hold-out 검정이 아니다. 열 이상 라벨의 수가 적어(가열 3회) 일반화할 수 없다."]
    (out / "report.md").write_text("\n".join(L), encoding="utf-8")
    log("\n" + "\n".join(L))
    log(f"산출물: {out}")


if __name__ == "__main__":
    main()
