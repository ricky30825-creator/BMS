"""Score one physical sample with a saved configuration.

Input: a CSV with 133 one-second rows and the ten ``FEATURES`` columns
(5 context + 96 history + 32 observed future). Output: AE score, Informer
score, fused score, threshold, 0-100 risk index and grade.

The v0.5 selection uses ``per_run`` calibration, so ``--run`` must name a run
that was calibrated offline. Use a ``global``-scope configuration for devices
that were never seen during calibration.

Example::

    python -m ai.model.predict --artifacts ai/artifacts/pb_v0_5 --csv sample.csv --run PB20000_run_04_2A
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from .features import PREDICTION, TOTAL, split_history, transform
from .networks import build_model
from .preprocess import FEATURES
from .scoring import apply_calibration, combine, feature_errors, grade, risk_index


class BaselineScorer:
    """Loads both checkpoints once and scores (1, 133, 10) physical windows."""

    def __init__(self, artifacts: Path, config_name: str = "selected_configuration.json"):
        self.artifacts = Path(artifacts)
        self.config = json.loads((self.artifacts / config_name).read_text(encoding="utf-8"))
        self.models, self.scalers = {}, {}
        for name in ["ae", "informer"]:
            setting = self.config[name]
            scaler = json.loads((self.artifacts / setting["scaler"]).read_text(encoding="utf-8"))
            model = build_model(name, len(scaler["mean"]), PREDICTION)
            model.load_state_dict(torch.load(self.artifacts / setting["checkpoint"], map_location="cpu", weights_only=True))
            model.eval()
            self.models[name], self.scalers[name] = model, scaler

    def score(self, raw: np.ndarray, run_id: str | None = None) -> dict:
        if raw.shape != (1, TOTAL, len(FEATURES)):
            raise ValueError(f"Expected shape (1, {TOTAL}, {len(FEATURES)}), got {raw.shape}")
        if not np.isfinite(raw).all():
            raise ValueError("Sample contains missing or non-finite data")
        raw = raw.astype(np.float32).copy()
        raw[:, :, 2] = raw[:, :, 0] * raw[:, :, 1]
        scores = {}
        for name, model in self.models.items():
            setting, scaler = self.config[name], self.scalers[name]
            values = ((transform(raw, setting["features"]) - np.array(scaler["mean"])) / np.array(scaler["std"])).astype(np.float32)
            error = feature_errors(model, *split_history(values), name)[0]
            key = run_id if setting["scope"] == "per_run" else "global"
            calibration = self.config[f"{name}_calibration"].get(key)
            if calibration is None:
                raise ValueError(f"No {setting['scope']} calibration for run {run_id!r}")
            scores[name] = apply_calibration(error, calibration, setting["topk"])
        fusion = self.config["fusion"]
        final = float(combine(scores["ae"], scores["informer"], fusion["kind"], fusion["alpha_ae"]))
        index = risk_index(final, fusion["threshold"])
        return dict(run=run_id, ae_score=scores["ae"], informer_score=scores["informer"], final_score=final,
                    threshold=fusion["threshold"], anomaly_flag=bool(final > fusion["threshold"]),
                    risk_index=index, grade=grade(index),
                    note="Deviation from learned normal pattern; not a thermal-runaway probability")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--run", default=None)
    args = parser.parse_args()
    torch.set_num_threads(2)
    frame = pd.read_csv(args.csv)
    raw = frame[FEATURES].to_numpy(dtype=np.float32)[None]
    print(json.dumps(BaselineScorer(args.artifacts).score(raw, args.run), indent=2))


if __name__ == "__main__":
    main()
