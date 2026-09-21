"""Runtime bridge between ``ai.runtime`` and the baseline scorer.

STATUS: skeleton. ``create_adapter`` is the factory the bundle manifest
would name as ``python:ai.model.adapter:create_adapter``. It is not yet
wired because three contract gaps remain open (see README "Integration"):

1. Raw frames arrive at 100 ms with signed current and mode-dependent
   temperature fields; the baseline expects a 1-second grid with the ten
   ``FEATURES`` columns (discharge-positive current, cell/IR-A/IR-B temps).
   The 1-second aggregation and column mapping are implemented below, but the
   mode-2 contract has no contact temperature while the baseline was trained
   with one. A mode-2 checkpoint trained without ``cell_temp_c`` is required.
2. The v0.5 selected configuration uses ``per_run`` calibration, which needs
   the run id. Runtime scoring must use a ``global``-scope configuration.
3. The runtime requires scores in 0-1 and grades at 0.3/0.6/0.8; the baseline
   score is threshold-normalised (~1.0 = warning). The 0-100 risk index in
   ``scoring.risk_index`` is the intended user-facing value; the 0-1 mapping
   for the wire contract has to be agreed with the backend.

Until those are settled, the adapter raises at construction time so the
runtime fails closed instead of publishing an unverified score.
"""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime

import numpy as np

from .features import TOTAL
from .preprocess import FEATURES


class AdapterNotReady(RuntimeError):
    code = "AI_INFERENCE_ADAPTER_UNAVAILABLE"


def frame_to_row(frame) -> dict[str, float | None]:
    """Map one validated ``RawMetricsFrame`` to the baseline feature columns."""
    current = frame.current_a
    discharge = None if current is None else -float(current)  # wire: negative = discharge
    voltage = None if frame.voltage_v is None else float(frame.voltage_v)
    ir = [v for v in frame.temp_points_ir if v is not None]
    ir_a = float(ir[0]) if len(ir) > 0 else None
    ir_b = float(ir[1]) if len(ir) > 1 else ir_a
    contact = None if frame.temp_contact is None else float(frame.temp_contact)
    return {
        "voltage_v": voltage,
        "current_discharge_a": discharge,
        "power_discharge_w": None if voltage is None or discharge is None else voltage * discharge,
        "soc_pct": None if frame.soc_pct is None else float(frame.soc_pct),
        "cell_temp_c": contact,
        "ir_a_temp_c": ir_a,
        "ir_b_temp_c": ir_b,
        "delta_c": None,
        "ir_diff_5a_c": None,
        "ir_diff_5b_c": None,
    }


class SecondAggregator:
    """Collapse 100 ms frames into 1-second rows per device (mean V/I/W/SOC, max temperatures)."""

    def __init__(self) -> None:
        self.buckets: dict[str, tuple[int, list[dict]]] = {}
        self.rows: dict[str, deque] = defaultdict(lambda: deque(maxlen=TOTAL))

    def push(self, frame) -> bool:
        """Return True when a new 1-second row was completed for this device."""
        second = int(datetime.fromisoformat(frame.timestamp.replace("Z", "+00:00")).timestamp())
        current_second, rows = self.buckets.get(frame.device_id, (second, []))
        if second != current_second and rows:
            self.rows[frame.device_id].append(self._reduce(rows))
            rows = []
        rows.append(frame_to_row(frame))
        self.buckets[frame.device_id] = (second, rows)
        return second != current_second

    @staticmethod
    def _reduce(rows: list[dict]) -> np.ndarray:
        out = np.full(len(FEATURES), np.nan, dtype=np.float32)
        for j, name in enumerate(FEATURES):
            values = [r[name] for r in rows if r[name] is not None]
            if values:
                out[j] = max(values) if name.endswith("_c") else float(np.mean(values))
        return out

    def window(self, device_id: str) -> np.ndarray | None:
        rows = self.rows[device_id]
        return None if len(rows) < TOTAL else np.stack(rows)[None]


def create_adapter(bundle):
    raise AdapterNotReady(
        "ai.model baseline is not yet wired to the runtime: needs a global-scope, "
        "mode-2 (no contact temperature) configuration and an agreed 0-1 score mapping"
    )
