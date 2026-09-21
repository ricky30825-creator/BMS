"""Unit tests for the baseline package (no data, no checkpoints required)."""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from ai.model.features import CONTEXT, HISTORY, PREDICTION, TOTAL, eligibility, run_windows, transform
from ai.model.networks import build_model
from ai.model.preprocess import FEATURES
from ai.model.scoring import apply_calibration, calibrate, combine, grade, risk_index
from ai.model.synthetic import SCENARIOS, SEVERITIES, inject_case


def synthetic_run(seconds: int = 600, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    t = np.arange(seconds)
    frame = pd.DataFrame({"timestamp": pd.date_range("2026-01-01", periods=seconds, freq="1s")})
    frame["voltage_v"] = 4.95 + rng.normal(0, 0.002, seconds)
    frame["current_discharge_a"] = 2.0 + rng.normal(0, 0.005, seconds)
    frame["power_discharge_w"] = frame.voltage_v * frame.current_discharge_a
    frame["soc_pct"] = 100 - t * 0.01
    for name, base in [("cell_temp_c", 28.0), ("ir_a_temp_c", 28.5), ("ir_b_temp_c", 28.2)]:
        frame[name] = base + t * 0.001 + rng.normal(0, 0.05, seconds)
    frame["delta_c"] = frame.cell_temp_c - 27.5
    frame["ir_diff_5a_c"] = frame.ir_a_temp_c - 27.5
    frame["ir_diff_5b_c"] = frame.ir_b_temp_c - 27.5
    frame["phase"] = "active"
    frame.loc[:9, "phase"] = "startup"
    frame["is_imputed"] = False
    frame["data_gap_flag"] = False
    return frame


class FeatureTests(unittest.TestCase):
    def test_eligibility_excludes_calibration_interval(self):
        frame = synthetic_run()
        eligible = eligibility(frame)
        self.assertFalse(eligible[:40].any())
        self.assertTrue(eligible[60:].all())

    def test_windows_shape_and_stride(self):
        windows, starts = run_windows(synthetic_run(), stride=10)
        self.assertEqual(windows.shape[1:], (TOTAL, len(FEATURES)))
        self.assertTrue(np.all(np.diff(starts) == 10))

    def test_local_relative_uses_first_16_history_seconds_only(self):
        windows, _ = run_windows(synthetic_run())
        base = transform(windows, "local_relative6")
        perturbed = windows.copy()
        perturbed[:, CONTEXT + 40 :, 0] += 0.5  # later voltage change must not alter the reference
        self.assertTrue(np.allclose(transform(perturbed, "local_relative6")[:, :40], base[:, :40]))
        self.assertEqual(base.shape[1:], (HISTORY + PREDICTION, 6))

    def test_gap_breaks_windows(self):
        frame = synthetic_run()
        frame.loc[300, "data_gap_flag"] = True
        _, starts = run_windows(frame)
        self.assertFalse(any(s - CONTEXT <= 300 < s + HISTORY + PREDICTION for s in starts))


class ScoringTests(unittest.TestCase):
    def test_calibration_normal_p99_is_one(self):
        rng = np.random.default_rng(1)
        normal = rng.gamma(2.0, 1.0, (500, 6))
        runs = np.array(["a"] * 250 + ["b"] * 250)
        scores, params = calibrate(normal, [normal * 3], runs, [runs], "per_run", 2)
        for run in ["a", "b"]:
            self.assertAlmostEqual(np.quantile(scores[0][runs == run], 0.99), 1.0, places=6)
        self.assertGreater(scores[1].mean(), scores[0].mean())
        self.assertAlmostEqual(apply_calibration(normal[0], params["a"], 2), scores[0][0], places=6)

    def test_fusion_and_grade(self):
        self.assertEqual(combine(0.2, 0.9, "max", None), 0.9)
        self.assertAlmostEqual(combine(0.2, 1.0, "weighted_sum", 0.25), 0.8)
        self.assertEqual(grade(risk_index(0.0, 1.0)), "NORMAL")
        self.assertEqual(grade(risk_index(1.0, 1.0)), "WARNING")
        self.assertEqual(grade(risk_index(2.0, 1.0)), "DANGER")


class ModelTests(unittest.TestCase):
    def test_shapes(self):
        import torch

        history = torch.zeros(3, HISTORY, 6)
        self.assertEqual(tuple(build_model("ae", 6)(history).shape), (3, HISTORY, 6))
        self.assertEqual(tuple(build_model("informer", 6)(history).shape), (3, PREDICTION, 6))


class SyntheticTests(unittest.TestCase):
    def test_power_stays_consistent(self):
        windows, _ = run_windows(synthetic_run())
        for scenario in SCENARIOS:
            for severity in SEVERITIES:
                h, f, meta = inject_case(windows[0, CONTEXT : CONTEXT + HISTORY], windows[0, CONTEXT + HISTORY :], scenario, severity)
                joined = np.concatenate([h, f])
                self.assertTrue(np.allclose(joined[:, 2], joined[:, 0] * joined[:, 1], atol=1e-5))
                self.assertGreaterEqual(meta["anomaly_start_step"], 0)


if __name__ == "__main__":
    unittest.main()
