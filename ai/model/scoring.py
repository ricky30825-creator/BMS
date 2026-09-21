"""Feature-wise error, calibration, fusion and evaluation metrics.

Score pipeline for one model::

    feature error e_j   (mean squared error per input feature over the window)
    z_j = max((e_j - median_j) / spread_j, 0)      spread = p95 - median of normal
    score = mean of the top-k z_j                   (k = 2 in the baseline)
    score /= p99 of normal scores                   so threshold ~ 1.0

Final score = max(AE score, Informer score)   ("max" fusion, v0.5 selection)
            = a * AE + (1 - a) * Informer      ("weighted_sum" alternative)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


def feature_errors(model: nn.Module, histories: np.ndarray, futures: np.ndarray, model_name: str,
                   batch_size: int = 256) -> np.ndarray:
    """(n, k) per-feature MSE: AE against its history, Informer against the observed future."""
    loader = DataLoader(TensorDataset(torch.from_numpy(histories), torch.from_numpy(futures)), batch_size=batch_size)
    model.eval()
    scores = []
    with torch.no_grad():
        for history, future in loader:
            target = history if model_name == "ae" else future
            scores.append(((model(history) - target) ** 2).mean(dim=1).numpy())
    return np.concatenate(scores)


def calibrate(normal: np.ndarray, targets: list[np.ndarray], run_ids: np.ndarray,
              target_runs: list[np.ndarray], scope: str, topk: int):
    """Robust feature calibration and top-k aggregation.

    ``scope='global'`` fits one median/spread/p99 from all normal windows and
    can be applied to an unseen device. ``scope='per_run'`` fits one set per
    known run (v0.5 offline selection) and requires the run id at scoring time.
    Returns ([normal_scores, *target_scores], params).
    """
    matrices, labels = [normal, *targets], [run_ids, *target_runs]
    result = [np.empty(len(m)) for m in matrices]
    params = {}
    groups = np.unique(run_ids) if scope == "per_run" else ["global"]
    global_floor = np.maximum(np.quantile(normal, 0.95, axis=0) * 0.001, 1e-8)
    for group in groups:
        select = run_ids == group if scope == "per_run" else np.ones(len(normal), bool)
        median = np.median(normal[select], axis=0)
        spread = np.maximum(np.quantile(normal[select], 0.95, axis=0) - median, global_floor)
        params[group] = dict(median=median.tolist(), spread=spread.tolist())
        for i, (matrix, ids) in enumerate(zip(matrices, labels)):
            mask = ids == group if scope == "per_run" else np.ones(len(matrix), bool)
            z = np.maximum((matrix[mask] - median) / spread, 0)
            result[i][mask] = np.sort(z, axis=1)[:, -topk:].mean(axis=1)
        denominator = max(float(np.quantile(result[0][select], 0.99)), 1e-8)
        params[group]["score_q99"] = denominator
        for i, ids in enumerate(labels):
            mask = ids == group if scope == "per_run" else np.ones(len(ids), bool)
            result[i][mask] /= denominator
    return result, params


def apply_calibration(error: np.ndarray, params: dict, topk: int) -> float:
    """Score one window's (k,) feature error with saved calibration params."""
    z = np.maximum((error - np.array(params["median"])) / np.array(params["spread"]), 0)
    return float(np.sort(z)[-topk:].mean() / params["score_q99"])


def combine(a, b, kind: str, alpha_ae):
    if kind == "weighted_sum":
        return alpha_ae * a + (1 - alpha_ae) * b
    if kind == "max":
        return np.maximum(a, b)
    raise ValueError(f"Unknown fusion kind: {kind}")


def auc_score(normal: np.ndarray, anomaly: np.ndarray) -> float:
    scores = np.concatenate([normal, anomaly])
    labels = np.concatenate([np.zeros(len(normal)), np.ones(len(anomaly))])
    ranks = pd.Series(scores).rank(method="average").to_numpy()
    positive = ranks[labels == 1].sum()
    return float((positive - len(anomaly) * (len(anomaly) + 1) / 2) / (len(normal) * len(anomaly)))


def measure(normal: np.ndarray, anomaly: np.ndarray, threshold: float) -> dict:
    far = float(np.mean(normal > threshold))
    tpr = float(np.mean(anomaly > threshold))
    tp, fp = int(np.sum(anomaly > threshold)), int(np.sum(normal > threshold))
    precision = tp / max(tp + fp, 1)
    return dict(normal_far=far, tpr=tpr, auc=auc_score(normal, anomaly), precision=precision,
                f1=2 * precision * tpr / max(precision + tpr, 1e-12), threshold=float(threshold))


def risk_index(score: float, threshold: float) -> int:
    """Map a fused score to the 0-100 risk index shown to users.

    score/threshold == 1 corresponds to index 80 (the warning boundary); the
    mapping is monotone and clipped. Boundaries 60/80/95 follow the design
    document and will be re-tuned once real abnormal data exist.
    """
    ratio = score / max(threshold, 1e-8)
    if ratio <= 0.5:
        index = 60 * ratio / 0.5
    elif ratio <= 1.0:
        index = 60 + 20 * (ratio - 0.5) / 0.5
    else:
        index = 80 + 20 * min(ratio - 1.0, 1.0)
    return int(round(min(max(index, 0), 100)))


def grade(index: int) -> str:
    if index < 60:
        return "NORMAL"
    if index < 80:
        return "CAUTION"
    if index < 95:
        return "WARNING"
    return "DANGER"
