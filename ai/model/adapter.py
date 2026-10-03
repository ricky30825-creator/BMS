"""Runtime bridge between ``ai.runtime`` and the baseline models (mode 2).

Wired through the bundle manifest as ``python:ai.model.adapter:create_adapter``
(see ``export_bundle.py``). Behaviour is deliberately strict:

* Only a ``local_relative5`` bundle with a ``global`` calibration is usable
  (``export_bundle`` refuses anything else), and only mode-2 frames with
  exactly two IR zones are accepted. Anything else raises - the runtime stops
  instead of scoring a stream the model was not trained for.
* 100 ms frames become a 1 s grid by taking the frame **nearest to each whole
  second**, which is what ``preprocess.resample_run`` did at training time
  (``merge_asof nearest``). Averaging or max-ing would be train/serve skew.
* No score is invented. While the window fills, after a data gap, or while the
  load is idle the adapter returns ``None`` (the runtime commits without
  publishing). A score exists only for 133 consecutive valid active seconds,
  and only after the same startup/calibration warm-up that excluded the start
  of every training run.
* The Informer term compares the model's forecast with the *observed next
  32 s*, so the published score describes the window ending 32 s before the
  frame it is stamped with. The AE term has no such delay.
* Kalman and internal-cell temperature are explicitly unavailable (``None``).
"""
from __future__ import annotations

import math
from collections import deque
from datetime import datetime
from pathlib import Path

import numpy as np
import torch

from ..contracts import InferenceOutput
from .features import FEATURE_NAMES, PREDICTION, TOTAL, split_history, transform
from .networks import build_model
from .preprocess import FEATURES
from .scoring import apply_calibration, combine, feature_errors, wire_score

FEATURE_SET = "local_relative5"
IDLE_CURRENT_A = 0.10        # preprocess: phase is "active" above this discharge current
STARTUP_SECONDS = 10         # preprocess: first 10 active rows are phase "startup"
CALIBRATION_SECONDS = 30     # features.eligibility: first 30 valid active seconds are skipped
WARMUP_SECONDS = STARTUP_SECONDS + CALIBRATION_SECONDS
FIRST_SCORE_STREAK = WARMUP_SECONDS + TOTAL
CONTRIBUTIONS = 2


class AdapterNotReady(RuntimeError):
    code = "AI_INFERENCE_ADAPTER_UNAVAILABLE"


class UnsupportedInput(RuntimeError):
    code = "AI_INFERENCE_INPUT_UNSUPPORTED"


def _epoch(timestamp: str) -> float:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()


def _finite(*values) -> bool:
    return all(v is not None and math.isfinite(float(v)) for v in values)


class _DeviceState:
    """Per-device 1 s grid builder and valid-row streak."""

    def __init__(self) -> None:
        self.second: int | None = None          # whole second currently being collected
        self.best: tuple[float, tuple] | None = None  # (distance to the second, row)
        self.last_row_second: int | None = None
        self.rows: deque = deque(maxlen=TOTAL)
        self.streak = 0

    def reset(self) -> None:
        self.rows.clear()
        self.streak = 0

    def offer(self, t: float, row: tuple | None) -> bool:
        """Add one frame. True when the previous second was just finalized."""
        second = round(t)
        distance = abs(t - second)
        if self.second is not None and second < self.second:
            return False                          # out-of-order / replayed frame
        finalized = False
        if self.second is not None and second > self.second:
            gap = second - self.second > 1
            self._finalize()
            if gap:
                # The frames before the hole are stale by now: drop the window instead
                # of publishing an old score stamped with the current frame time.
                self.reset()
            else:
                finalized = True
        if self.second != second:
            self.second, self.best = second, None
        if self.best is None or distance < self.best[0]:
            self.best = (distance, row)
        return finalized

    def _finalize(self) -> None:
        row = self.best[1] if self.best else None
        if self.last_row_second is not None and self.second != self.last_row_second + 1:
            self.reset()                          # a whole second is missing
        self.last_row_second = self.second
        if row is None or row[1] <= IDLE_CURRENT_A:
            self.reset()                          # gap flag or idle: breaks windows in training too
            return
        self.rows.append(row)
        self.streak += 1


class BaselineAdapter:
    def __init__(self, bundle, models: dict, parameters: dict) -> None:
        self.bundle = bundle
        self.models = models
        self.parameters = parameters
        self.order = bundle.feature_metadata.feature_order
        self.topk = int(self._scalar("topk"))
        self.threshold = self._scalar("fusion_threshold")
        self.is_max = self._scalar("fusion_is_max") == 1.0
        self.alpha = self._scalar("fusion_alpha_ae")
        self.states: dict[str, _DeviceState] = {}

    def _scalar(self, name: str) -> float:
        values = self.parameters[name]
        if any(v != values[0] for v in values):
            raise AdapterNotReady(f"bundle parameter {name} must be a constant vector")
        return float(values[0])

    def _row(self, frame) -> tuple | None:
        """(voltage, discharge current, power, ir_a, ir_b) or None when any value is missing."""
        ir = frame.temp_points_ir
        if frame.mode != 2:
            raise UnsupportedInput(f"mode {frame.mode} frame; this bundle is mode 2 only")
        if len(ir) != 2:
            raise UnsupportedInput(f"{len(ir)} IR zones; the model input needs exactly 2")
        if frame.current_a is None or not _finite(frame.voltage_v, frame.current_a, *ir):
            return None
        voltage, discharge = float(frame.voltage_v), -float(frame.current_a)  # wire: negative = discharge
        return (voltage, discharge, voltage * discharge, float(ir[0]), float(ir[1]))

    def infer(self, frame) -> InferenceOutput | None:
        row = self._row(frame)
        state = self.states.setdefault(frame.device_id, _DeviceState())
        if not state.offer(_epoch(frame.timestamp), row) or state.streak < FIRST_SCORE_STREAK:
            return None
        return self._score(state, frame)

    def _score(self, state: _DeviceState, frame) -> InferenceOutput:
        raw = np.full((1, TOTAL, len(FEATURES)), np.nan, dtype=np.float32)
        window = np.asarray(state.rows, dtype=np.float32)
        for j, name in enumerate(("voltage_v", "current_discharge_a", "power_discharge_w", "ir_a_temp_c", "ir_b_temp_c")):
            raw[0, :, FEATURES.index(name)] = window[:, j]
        scores, z_by_model = {}, {}
        for tag, model in self.models.items():
            p = self.parameters
            values = ((transform(raw, FEATURE_SET) - np.array(p[f"{tag}_mean"])) / np.array(p[f"{tag}_std"])).astype(np.float32)
            error = feature_errors(model, *split_history(values), tag)[0]
            calibration = dict(median=p[f"{tag}_median"], spread=p[f"{tag}_spread"], score_q99=self._scalar(f"{tag}_score_q99"))
            scores[tag] = apply_calibration(error, calibration, self.topk)
            z_by_model[tag] = np.maximum((error - np.array(calibration["median"])) / np.array(calibration["spread"]), 0)
        final = float(combine(scores["ae"], scores["informer"], "max" if self.is_max else "weighted_sum", self.alpha))
        lead = "ae" if scores["ae"] >= scores["informer"] else "informer"
        top = np.argsort(z_by_model[lead])[::-1][:CONTRIBUTIONS]
        return InferenceOutput(
            evaluated_at=frame.timestamp,
            score=wire_score(final, self.threshold),
            ae_score=wire_score(scores["ae"], self.threshold),
            informer_score=wire_score(scores["informer"], self.threshold),
            contributions=tuple((self.order[i], float(z_by_model[lead][i])) for i in top),
            model_version=self.bundle.model_version,
            temp_kalman=None,
            temp_cell_estimated=None,
        )


def create_adapter(bundle) -> BaselineAdapter:
    if tuple(bundle.feature_metadata.feature_order) != tuple(FEATURE_NAMES[FEATURE_SET]):
        raise AdapterNotReady(f"bundle feature_order is not {FEATURE_SET}")
    if bundle.feature_metadata.window_size != TOTAL:
        raise AdapterNotReady(f"bundle window_size must be {TOTAL}")
    k = len(bundle.feature_metadata.feature_order)
    models = {}
    for tag, artifact in (("ae", bundle.lstm_autoencoder), ("informer", bundle.informer)):
        model = build_model(tag, k, PREDICTION)
        model.load_state_dict(torch.load(Path(artifact.path), map_location="cpu", weights_only=True))
        model.eval()
        models[tag] = model
    return BaselineAdapter(bundle, models, {n: list(v) for n, v in bundle.scaler.parameters.items()})
