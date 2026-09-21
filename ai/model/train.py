"""Train the normal-only baseline and select the fusion configuration.

Protocol (v0.5):

1. Every eligible window of every processed run is a normal training window.
2. For each feature set, train LSTM-AE and InformerLite (Adam, MSE) and save
   checkpoints at the requested epochs together with the input scaler.
3. Compute per-feature errors on normal windows and on two synthetic suites
   (development and confirmation) generated from disjoint source windows.
4. Search calibration scope x top-k x epoch per model, rank by development
   TPR at the normal p99 threshold (AUROC tie-break), then search max /
   weighted fusion over the top four settings of each model.
5. Write ``selected_configuration.json`` (used by ``predict.py``) and report
   confirmation-suite metrics, which never influence the selection.

The reported normal false-alarm rate reuses the training runs; it is a
development number, not unseen-device performance.

Example::

    python -m ai.model.train --processed data/processed_pb --output ai/artifacts/pb_v0_5
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, TensorDataset

from . import BASELINE_VERSION
from .features import FEATURE_NAMES, FEATURE_SETS, HISTORY, PREDICTION, physical_windows, split_history, transform
from .networks import build_model
from .scoring import calibrate, combine, feature_errors, measure
from .synthetic import SCENARIOS, generate


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def fit(model_name: str, train: np.ndarray, epochs: int, checkpoints: list[int], seed: int, folder: Path,
        feature_set: str, mu: np.ndarray, sigma: np.ndarray, eval_sets: dict[str, np.ndarray]) -> None:
    seed_everything(seed)
    model = build_model(model_name, train.shape[2], PREDICTION)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    history, future = split_history(train)
    loader = DataLoader(TensorDataset(torch.from_numpy(history), torch.from_numpy(future)), batch_size=128,
                        shuffle=True, generator=torch.Generator().manual_seed(seed))
    losses = []
    for epoch in range(1, epochs + 1):
        model.train()
        total = 0.0
        for h, f in loader:
            optimizer.zero_grad()
            loss = torch.nn.functional.mse_loss(model(h), h if model_name == "ae" else f)
            if not torch.isfinite(loss):
                raise ValueError("Non-finite training loss")
            loss.backward()
            optimizer.step()
            total += loss.item() * len(h)
        losses.append(total / len(train))
        print(f"{model_name} {feature_set} epoch={epoch} loss={losses[-1]:.6f}", flush=True)
        if epoch in checkpoints:
            state = torch.get_rng_state()
            errors = {name: feature_errors(model, *split_history(values), model_name) for name, values in eval_sets.items()}
            torch.set_rng_state(state)
            torch.save(model.state_dict(), folder / f"model_epoch{epoch}.pt")
            (folder / f"metadata_epoch{epoch}.json").write_text(json.dumps(dict(
                model=model_name, feature_set=feature_set, feature_names=FEATURE_NAMES[feature_set], epoch=epoch,
                losses=losses, mean=mu.tolist(), std=sigma.tolist(), history=HISTORY, prediction=PREDICTION,
                baseline_version=BASELINE_VERSION), indent=2), encoding="utf-8")
            np.savez_compressed(folder / f"errors_epoch{epoch}.npz", **errors)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--processed", type=Path, required=True, help="folder of processed run CSV files")
    parser.add_argument("--output", type=Path, required=True, help="artifact folder (git-ignored)")
    parser.add_argument("--feature-sets", nargs="+", default=["local_relative6"], choices=FEATURE_SETS)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--checkpoint-epochs", nargs="+", type=int, default=None, help="default: 2 and --epochs")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--synthetic-per-run", type=int, default=16)
    parser.add_argument("--max-windows", type=int, default=None, help="subsample normal windows (smoke tests only)")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    checkpoints = sorted(set(args.checkpoint_epochs or [min(2, args.epochs), args.epochs]))
    out = args.output
    out.mkdir(parents=True, exist_ok=True)

    raw, runs, starts = physical_windows(args.processed)
    if args.max_windows and len(raw) > args.max_windows:
        keep = np.sort(np.random.default_rng(args.seed).choice(len(raw), args.max_windows, replace=False))
        raw, runs, starts = raw[keep], runs[keep], starts[keep]
    dev, dev_meta, dev_sources = generate(raw, runs, starts, 101, args.synthetic_per_run)
    check, check_meta, _ = generate(raw, runs, starts, 202, args.synthetic_per_run, dev_sources)
    dev_meta.to_csv(out / "synthetic_dev_manifest.csv", index=False)
    check_meta.to_csv(out / "synthetic_confirmation_manifest.csv", index=False)
    protocol = dict(baseline_version=BASELINE_VERSION, processed=str(args.processed), runs=sorted(set(runs.tolist())),
                    normal_windows=int(len(raw)), synthetic_dev=int(len(dev)), synthetic_confirmation=int(len(check)),
                    feature_sets=args.feature_sets, epochs=args.epochs, checkpoint_epochs=checkpoints, seed=args.seed,
                    history=HISTORY, prediction=PREDICTION, threshold="p99 of normal scores",
                    selection="max dev TPR at p99, AUROC tie-break, top four per model for fusion",
                    script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (out / "protocol.json").write_text(json.dumps(protocol, indent=2), encoding="utf-8")

    candidates, search_rows = {"ae": [], "informer": []}, []
    for feature_set in args.feature_sets:
        train = transform(raw, feature_set)
        mu, sigma = train.mean(axis=(0, 1)), np.maximum(train.std(axis=(0, 1)), 1e-6)
        scale = lambda v: ((transform(v, feature_set) - mu) / sigma).astype(np.float32)
        train = ((train - mu) / sigma).astype(np.float32)
        eval_sets = dict(normal=train, dev=scale(dev), confirmation=scale(check))
        for model_name in candidates:
            folder = out / f"{model_name}_{feature_set}"
            folder.mkdir(exist_ok=True)
            if not (folder / f"errors_epoch{args.epochs}.npz").exists():
                fit(model_name, train, args.epochs, checkpoints, args.seed, folder, feature_set, mu, sigma, eval_sets)
            for epoch in checkpoints:
                saved = np.load(folder / f"errors_epoch{epoch}.npz")
                for scope in ["global", "per_run"]:
                    for topk in [1, 2, train.shape[2]]:
                        scores, params = calibrate(saved["normal"], [saved["dev"], saved["confirmation"]], runs,
                                                   [dev_meta.run.to_numpy(), check_meta.run.to_numpy()], scope, topk)
                        threshold = float(np.quantile(scores[0], 0.99))
                        metric = measure(scores[0], scores[1], threshold)
                        setting = dict(id=f"{model_name}_{feature_set}_e{epoch}_{scope}_top{topk}", model=model_name,
                                       features=feature_set, epoch=epoch, scope=scope, topk=topk, threshold=threshold,
                                       checkpoint=f"{folder.name}/model_epoch{epoch}.pt",
                                       scaler=f"{folder.name}/metadata_epoch{epoch}.json")
                        search_rows.append({**setting, **metric})
                        candidates[model_name].append(dict(setting=setting, metric=metric, scores=scores, calibration=params))
        pd.DataFrame(search_rows).to_csv(out / "individual_search.csv", index=False)

    rank = lambda c: (c["metric"]["tpr"], c["metric"]["auc"])
    ranked = {name: sorted(group, key=rank, reverse=True) for name, group in candidates.items()}
    fusion_rows, best = [], None
    for ae in ranked["ae"][:4]:
        for inf in ranked["informer"][:4]:
            for kind in ["weighted_sum", "max"]:
                for alpha in (np.linspace(0, 1, 21) if kind == "weighted_sum" else [None]):
                    normal = combine(ae["scores"][0], inf["scores"][0], kind, alpha)
                    ds = combine(ae["scores"][1], inf["scores"][1], kind, alpha)
                    threshold = float(np.quantile(normal, 0.99))
                    metric = measure(normal, ds, threshold)
                    row = dict(ae=ae["setting"]["id"], informer=inf["setting"]["id"], kind=kind,
                               alpha_ae=None if alpha is None else float(alpha), **metric)
                    fusion_rows.append(row)
                    if best is None or (metric["tpr"], metric["auc"]) > best["rank"]:
                        best = dict(rank=(metric["tpr"], metric["auc"]), ae=ae, inf=inf, row=row, alpha=alpha)
    pd.DataFrame(fusion_rows).to_csv(out / "fusion_search.csv", index=False)

    ae, inf, spec = best["ae"], best["inf"], best["row"]
    fused = [combine(a, b, spec["kind"], best["alpha"]) for a, b in zip(ae["scores"], inf["scores"])]
    selected = dict(baseline_version=BASELINE_VERSION, ae=ae["setting"], informer=inf["setting"], fusion=spec,
                    ae_calibration=ae["calibration"], informer_calibration=inf["calibration"],
                    standalone_ae=ranked["ae"][0]["setting"], standalone_informer=ranked["informer"][0]["setting"])
    (out / "selected_configuration.json").write_text(json.dumps(selected, indent=2), encoding="utf-8")

    labelled = {"AE_best": (ranked["ae"][0]["scores"], ranked["ae"][0]["setting"]["threshold"]),
                "Informer_best": (ranked["informer"][0]["scores"], ranked["informer"][0]["setting"]["threshold"]),
                "Selected_fusion": (fused, spec["threshold"])}
    results, scenario_rows, run_rows = [], [], []
    for label, (scores, threshold) in labelled.items():
        for split, index in [("dev", 1), ("confirmation", 2)]:
            results.append(dict(model=label, split=split, **measure(scores[0], scores[index], threshold)))
        for (scenario, severity), group in check_meta.groupby(["scenario", "severity"]):
            scenario_rows.append(dict(model=label, scenario=scenario, severity=severity,
                                      **measure(scores[0], scores[2][group.index], threshold)))
        for run in np.unique(runs):
            values = scores[0][runs == run]
            run_rows.append(dict(model=label, run=run, windows=len(values), far=float(np.mean(values > threshold))))
    pd.DataFrame(results).to_csv(out / "metrics.csv", index=False)
    pd.DataFrame(scenario_rows).to_csv(out / "scenario_metrics.csv", index=False)
    pd.DataFrame(run_rows).to_csv(out / "normal_run_metrics.csv", index=False)
    write_report(out, results, selected, protocol)
    print(json.dumps(dict(selected=spec, confirmation=[r for r in results if r["split"] == "confirmation"]), indent=2))


def write_report(out: Path, results: list[dict], selected: dict, protocol: dict) -> None:
    confirmation = [r for r in results if r["split"] == "confirmation"]
    lines = [f"# Baseline training report (v{BASELINE_VERSION})", "",
             f"Runs: {len(protocol['runs'])}; normal windows: {protocol['normal_windows']}; "
             f"synthetic dev/confirmation: {protocol['synthetic_dev']}/{protocol['synthetic_confirmation']}.", "",
             "Normal FAR reuses the training runs (development number, not unseen-device performance).",
             "Synthetic TPR measures designed proxy patterns, not real thermal runaway.", "",
             "| Model | Normal FAR | Proxy TPR | Proxy AUROC |", "| --- | ---: | ---: | ---: |"]
    lines += [f"| {r['model']} | {r['normal_far']:.2%} | {r['tpr']:.2%} | {r['auc']:.4f} |" for r in confirmation]
    lines += ["", "## Selected configuration", "", "```json",
              json.dumps({k: selected[k] for k in ["ae", "informer", "fusion"]}, indent=2), "```", ""]
    (out / "report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
