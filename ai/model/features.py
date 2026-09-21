"""Window extraction and the model input transform.

Time layout of one physical sample (133 rows at 1 s)::

    rows   0..4     context   (5 s, only needed by rate features)
    rows   5..100   history   (96 s)  -> LSTM-AE reconstructs this
    rows 101..132   future    (32 s)  -> InformerLite predicts this

``local_relative6`` (the v0.5 baseline input) takes the six core channels and
expresses them relative to the median of the first 16 history seconds:
voltage/current/power as a ratio change, temperatures as a difference.
The transform therefore uses no run-level statistics and works online.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .preprocess import FEATURES

CORE = ["voltage_v", "current_discharge_a", "power_discharge_w", "cell_temp_c", "ir_a_temp_c", "ir_b_temp_c"]
CONTEXT, HISTORY, PREDICTION = 5, 96, 32
TOTAL = CONTEXT + HISTORY + PREDICTION
FEATURE_SETS = ["absolute6", "local_relative6", "local_relative_rate12"]
FEATURE_NAMES = {
    "absolute6": CORE,
    "local_relative6": [f"rel_{name}" for name in CORE],
    "local_relative_rate12": [f"rel_{name}" for name in CORE] + [f"rate5_{name}" for name in CORE],
}


def eligibility(frame: pd.DataFrame, calibration_seconds: int = 30) -> np.ndarray:
    """Rows usable inside a training/evaluation window.

    A row is eligible when it is in the ``active`` phase, has no gap flag and
    finite features, is preceded by five more such rows, and lies after the
    first ``calibration_seconds`` consecutive valid active seconds of the run.
    """
    times = pd.to_datetime(frame.timestamp)
    if not times.diff().iloc[1:].eq(pd.Timedelta(seconds=1)).all():
        raise ValueError("Expected a strictly continuous one-second processed grid")
    valid = frame.phase.eq("active") & ~frame.data_gap_flag & np.isfinite(frame[FEATURES]).all(axis=1)
    consecutive = valid.rolling(calibration_seconds, min_periods=calibration_seconds).sum().eq(calibration_seconds)
    if not consecutive.any():
        raise ValueError(f"No valid consecutive {calibration_seconds}-second interval")
    end = int(np.flatnonzero(consecutive)[0])
    eligible = valid & valid.rolling(6, min_periods=6).sum().eq(6)
    eligible.iloc[: end + 1] = False
    return eligible.to_numpy()


def run_windows(frame: pd.DataFrame, stride: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """All physical windows of one processed run: (n, 133, 10) and start indices."""
    values = frame[FEATURES].to_numpy(dtype=np.float32)
    values[:, FEATURES.index("power_discharge_w")] = values[:, 0] * values[:, 1]
    good = eligibility(frame) & np.isfinite(values).all(axis=1)
    cumulative = np.r_[0, np.cumsum(~good)]
    index = np.arange(CONTEXT, len(frame) - (HISTORY + PREDICTION) + 1, stride)
    index = index[(cumulative[index + HISTORY + PREDICTION] - cumulative[index - CONTEXT]) == 0]
    return values[index[:, None] + np.arange(-CONTEXT, HISTORY + PREDICTION)], index


def physical_windows(processed_dir: Path, pattern: str = "*_run_*.csv", stride: int = 10):
    """Stack windows from every processed run. Returns (raw, run_ids, starts)."""
    arrays, ids, starts = [], [], []
    for path in sorted(processed_dir.glob(pattern)):
        try:
            windows, index = run_windows(pd.read_csv(path), stride)
        except ValueError as error:
            # e.g. a run recorded without the contact probe has no finite cell_temp_c rows.
            print(f"skip {path.stem}: {error}", flush=True)
            continue
        if not len(windows):
            print(f"skip {path.stem}: no eligible windows", flush=True)
            continue
        arrays.append(windows)
        ids.extend([path.stem] * len(index))
        starts.extend(index.tolist())
    if not arrays:
        raise ValueError(f"No eligible windows under {processed_dir}")
    return np.concatenate(arrays), np.array(ids), np.array(starts)


def transform(raw: np.ndarray, feature_set: str) -> np.ndarray:
    """(n, 133, 10) physical windows -> (n, 128, k) model input."""
    core = raw[:, :, [FEATURES.index(name) for name in CORE]]
    base = np.median(core[:, CONTEXT : CONTEXT + 16], axis=1, keepdims=True)
    denominator = np.ones_like(base)
    denominator[:, :, :3] = np.maximum(np.abs(base[:, :, :3]), [0.1, 0.1, 0.5])
    relative = (core[:, CONTEXT:] - base) / denominator
    if feature_set == "absolute6":
        return core[:, CONTEXT:].copy()
    if feature_set == "local_relative6":
        return relative
    if feature_set == "local_relative_rate12":
        rate = (core[:, CONTEXT:] - core[:, :-CONTEXT]) / float(CONTEXT) / denominator
        return np.concatenate([relative, rate], axis=2)
    raise ValueError(f"Unknown feature set: {feature_set}")


def split_history(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(n, 128, k) -> history (n, 96, k), future (n, 32, k)."""
    return values[:, :HISTORY].copy(), values[:, HISTORY:].copy()
