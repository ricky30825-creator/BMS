#!/usr/bin/env python3
"""score_heat.py — 학습된 5채널 global 모델로 처음 보는 가열 run 을 채점하고 구간별로 요약한다 (hold-out).

  PYTHONPATH=. python hardware/bench/tools/score_heat.py --artifacts <학습 폴더> \
      --processed <preprocess --core5 출력 run csv> --heat <*_1s_heat.csv> [--normal <processed run csv>] [--out <csv>]

``--processed`` 는 학습과 같은 ``ai.model.preprocess --core5`` 로 만든 1초 격자여야 한다. 0.1초 IR 을 1초 평균낸 열을 바로
쓰면 학습 때의 계단형 1초 샘플과 달라진다(train/serve skew). ``--heat`` 는 구간 라벨(heat 열)만 쓴다.
창 하나 = 133초(context 5 + history 96 + future 32). 라벨은 창의 마지막 행(end_label)과 history 의 마지막 행
(hist_end_label — Informer 는 future 32초를 실측과 비교하므로 history 끝이 32초 앞선다) 두 가지로 낸다.
⚠ 환경 열(드라이어)이지 배터리 자체 이상이 아니다. 개발 단계 값이며 합성 이상이 아닌 실측이지만 run 1개다.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch

from ai.model.features import CORE5, CONTEXT, HISTORY, TOTAL, run_windows, set_active_core
from ai.model.predict import BaselineScorer
from ai.model.scoring import wire_score


def load_run(processed: Path, heat: Path | None) -> tuple[pd.DataFrame, pd.Series | None]:
    frame = pd.read_csv(processed, parse_dates=["timestamp"])
    if heat is None:
        return frame, None
    labels = pd.read_csv(heat, parse_dates=["timestamp"]).set_index("timestamp")["heat"]
    labels = labels.reindex(frame.timestamp, method="nearest", tolerance=pd.Timedelta("2s")).fillna("idle")
    return frame, labels.reset_index(drop=True)


def score_frame(scorer: BaselineScorer, frame: pd.DataFrame, labels: pd.Series | None, stride: int) -> pd.DataFrame:
    set_active_core(CORE5)
    windows, starts = run_windows(frame, stride=stride)
    rows = []
    for window, start in zip(windows, starts):
        result = scorer.score(window[None], None)
        end = start - CONTEXT + TOTAL - 1
        hist_end = start - CONTEXT + CONTEXT + HISTORY - 1
        row = dict(window_end=frame.timestamp.iloc[end], ae=result["ae_score"], informer=result["informer_score"],
                   final=result["final_score"], flag=result["anomaly_flag"],
                   wire=wire_score(result["final_score"], result["threshold"]))
        if labels is not None:
            row["end_label"], row["hist_end_label"] = labels.iloc[end], labels.iloc[hist_end]
        rows.append(row)
    return pd.DataFrame(rows)


def summarize(scores: pd.DataFrame, by: str) -> pd.DataFrame:
    return scores.groupby(by).agg(windows=("final", "size"), flagged=("flag", "sum"), flag_rate=("flag", "mean"),
                                  final_median=("final", "median"), final_max=("final", "max"),
                                  ae_max=("ae", "max"), informer_max=("informer", "max"), wire_max=("wire", "max"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--processed", type=Path, required=True)
    parser.add_argument("--heat", type=Path, required=True)
    parser.add_argument("--normal", type=Path, help="비교용 정상 run (preprocess 출력 CSV)")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--stride", type=int, default=5)
    args = parser.parse_args()
    torch.set_num_threads(2)
    scorer = BaselineScorer(args.artifacts)
    for name in ("ae", "informer"):
        if scorer.config[name]["scope"] != "global":
            raise SystemExit(f"{name} 보정이 {scorer.config[name]['scope']} 다. global 로 학습한 폴더를 쓸 것")
    frame, labels = load_run(args.processed, args.heat)
    scores = score_frame(scorer, frame, labels, args.stride)
    print(f"창 {len(scores)}개, 문턱 {scorer.config['fusion']['threshold']:.4f}")
    print("\n[창 끝 라벨 기준]\n", summarize(scores, "end_label").round(3).to_string())
    print("\n[history 끝 라벨 기준 — Informer 지연 32초 반영]\n", summarize(scores, "hist_end_label").round(3).to_string())
    if args.normal:
        normal = score_frame(scorer, load_run(args.normal, None)[0], None, args.stride)
        print(f"\n[정상 run {args.normal.name}] 창 {len(normal)}개, 문턱 초과 {normal.flag.mean():.2%}, "
              f"final 중앙값 {normal.final.median():.3f}, 최대 {normal.final.max():.3f}")
    if args.out:
        scores.to_csv(args.out, index=False)
        print(f"\n창별 점수 -> {args.out}")


if __name__ == "__main__":
    main()
