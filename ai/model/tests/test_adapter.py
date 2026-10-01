"""Export + adapter tests with randomly initialised models (no data, no training)."""
from __future__ import annotations

import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import torch

from ai.bundle import load_model_bundle
from ai.contracts import build_anomaly_alert, parse_raw_metrics
from ai.inference import create_production_adapter
from ai.model.adapter import FIRST_SCORE_STREAK, BaselineAdapter, UnsupportedInput
from ai.model.export_bundle import ExportError, export_bundle
from ai.model.features import FEATURE_NAMES, PREDICTION
from ai.model.networks import build_model
from ai.model.scoring import wire_score

ORDER = FEATURE_NAMES["local_relative5"]
K = len(ORDER)
T0 = datetime(2026, 9, 29, 0, 0, 0, tzinfo=timezone.utc)


def make_artifacts(root: Path, **override) -> None:
    config = {}
    for tag in ("ae", "informer"):
        folder = root / f"{tag}_local_relative5"
        folder.mkdir(parents=True)
        torch.manual_seed(0 if tag == "ae" else 1)
        torch.save(build_model(tag, K, PREDICTION).state_dict(), folder / "model_epoch2.pt")
        (folder / "metadata_epoch2.json").write_text(json.dumps(dict(
            model=tag, feature_set="local_relative5", feature_names=ORDER, mean=[0.0] * K, std=[1.0] * K)))
        config[tag] = dict(id=tag, model=tag, features="local_relative5", epoch=2, scope="global", topk=2,
                           threshold=1.0, checkpoint=f"{folder.name}/model_epoch2.pt",
                           scaler=f"{folder.name}/metadata_epoch2.json")
        config[f"{tag}_calibration"] = {"global": dict(median=[0.0] * K, spread=[1.0] * K, score_q99=1.0)}
    config["fusion"] = dict(kind="max", alpha_ae=None, threshold=1.0)
    for key, value in override.items():
        config[key] = value
    (root / "selected_configuration.json").write_text(json.dumps(config))


def frame(t: datetime, *, current=-2.0, ir=(30.0, 30.2), mode=2, voltage=5.0):
    payload = {
        "version": 1, "device_id": "pi-1", "mode": mode,
        "timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z",
        "voltage_v": voltage, "current_a": current, "power_w": voltage * current, "soc_pct": None,
        "temp_contact": None if mode == 2 else 30.0, "temp_ir_surface": max((v for v in ir if v is not None), default=None),
        "temp_points": {"contact": None if mode == 2 else [30.0, 30.0, 30.0], "ir": list(ir)},
        "gas_raw": None, "pressure_raw": None if mode == 2 else 400, "acoustic_raw": None, "age_ms": {},
    }
    return parse_raw_metrics(payload)


def stream(adapter, seconds, start=0, **kwargs):
    """Feed 10 frames per second; return the outputs produced."""
    outputs = []
    for s in range(start, start + seconds):
        for i in range(10):
            out = adapter.infer(frame(T0 + timedelta(seconds=s, milliseconds=100 * i - 40 + (i == 0) * 0), **kwargs))
            if out is not None:
                outputs.append((s, out))
    return outputs


class AdapterFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_artifacts(self.root / "artifacts")
        self.manifest = export_bundle(self.root / "artifacts", self.root / "bundle")
        self.bundle = load_model_bundle(self.root / "bundle")
        torch.set_num_threads(1)

    def tearDown(self):
        self.tmp.cleanup()


class ExportTests(unittest.TestCase):
    def test_refuses_per_run_scope(self):
        with tempfile.TemporaryDirectory() as d:
            make_artifacts(Path(d) / "a")
            path = Path(d) / "a" / "selected_configuration.json"
            config = json.loads(path.read_text())
            config["ae"]["scope"] = "per_run"
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ExportError, "per_run"):
                export_bundle(Path(d) / "a", Path(d) / "b")

    def test_refuses_six_channel_feature_set(self):
        with tempfile.TemporaryDirectory() as d:
            make_artifacts(Path(d) / "a")
            path = Path(d) / "a" / "selected_configuration.json"
            config = json.loads(path.read_text())
            config["informer"]["features"] = "local_relative6"
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ExportError, "local_relative5"):
                export_bundle(Path(d) / "a", Path(d) / "b")


class AdapterTests(AdapterFixture):
    def test_bundle_loads_and_adapter_is_created_from_manifest(self):
        adapter = create_production_adapter(self.bundle)
        self.assertIsInstance(adapter, BaselineAdapter)
        self.assertEqual(adapter.bundle.feature_metadata.window_size, 133)

    def test_no_score_until_warmup_and_window_are_full(self):
        adapter = create_production_adapter(self.bundle)
        outputs = stream(adapter, FIRST_SCORE_STREAK - 1)
        self.assertEqual(outputs, [])
        # the row for second N is finalized by the first frame of second N+1
        outputs = stream(adapter, 4, start=FIRST_SCORE_STREAK - 1)
        self.assertGreaterEqual(len(outputs), 1)

    def test_scores_are_valid_wire_payloads(self):
        adapter = create_production_adapter(self.bundle)
        last = None
        for s in range(FIRST_SCORE_STREAK + 3):
            for i in range(10):
                f = frame(T0 + timedelta(seconds=s, milliseconds=100 * i))
                out = adapter.infer(f)
                if out is not None:
                    last = (f, out)
        self.assertIsNotNone(last)
        f, out = last
        payload = build_anomaly_alert(f, out, expected_model_version=self.bundle.model_version)
        self.assertTrue(0.0 <= payload["score"] <= 1.0)
        self.assertEqual(len(payload["contributions"]), 2)
        self.assertIsNone(payload["temp_kalman"])
        self.assertIsNone(payload["temp_cell_estimated"])
        self.assertEqual(payload["model_version"], self.bundle.model_version)

    def test_missing_second_resets_the_window(self):
        adapter = create_production_adapter(self.bundle)
        stream(adapter, FIRST_SCORE_STREAK + 2)
        # 5 s hole, then valid data again: no score until a full new streak
        self.assertEqual(stream(adapter, 20, start=FIRST_SCORE_STREAK + 8), [])

    def test_missing_value_resets_the_window(self):
        adapter = create_production_adapter(self.bundle)
        stream(adapter, FIRST_SCORE_STREAK + 2)
        stream(adapter, 3, start=FIRST_SCORE_STREAK + 2, ir=(None, 30.0))
        self.assertEqual(stream(adapter, 20, start=FIRST_SCORE_STREAK + 5), [])

    def test_idle_load_resets_the_window(self):
        adapter = create_production_adapter(self.bundle)
        stream(adapter, FIRST_SCORE_STREAK + 2)
        stream(adapter, 3, start=FIRST_SCORE_STREAK + 2, current=-0.05)
        self.assertEqual(stream(adapter, 20, start=FIRST_SCORE_STREAK + 5), [])

    def test_rejects_mode1_and_wrong_ir_zone_count(self):
        adapter = create_production_adapter(self.bundle)
        with self.assertRaises(UnsupportedInput):
            adapter.infer(frame(T0, mode=1))
        with self.assertRaises(UnsupportedInput):
            adapter.infer(frame(T0, ir=(30.0,)))

    def test_charging_frames_are_not_scored(self):
        adapter = create_production_adapter(self.bundle)
        self.assertEqual(stream(adapter, FIRST_SCORE_STREAK + 5, current=+1.0), [])

    def test_nearest_frame_to_the_whole_second_is_used(self):
        adapter = create_production_adapter(self.bundle)
        state = adapter.states.setdefault("pi-1", __import__("ai.model.adapter", fromlist=["x"])._DeviceState())
        row = lambda v: (v, 2.0, 2.0 * v, 30.0, 30.0)
        state.offer(10.40, row(1.0))
        state.offer(10.96, row(2.0))     # nearest to 11.0
        state.offer(11.02, row(3.0))     # nearer still: wins second 11
        state.offer(11.52, row(9.0))     # second 12 begins -> second 11 finalized
        self.assertEqual(state.rows[-1][0], 3.0)


class ScoreMapTests(unittest.TestCase):
    def test_boundaries_match_web_grades(self):
        self.assertAlmostEqual(wire_score(0.25, 1.0), 0.3)
        self.assertAlmostEqual(wire_score(0.5, 1.0), 0.6)
        self.assertAlmostEqual(wire_score(1.0, 1.0), 0.8)
        self.assertEqual(wire_score(9.0, 1.0), 1.0)
        self.assertEqual(wire_score(0.0, 1.0), 0.0)


if __name__ == "__main__":
    unittest.main()
