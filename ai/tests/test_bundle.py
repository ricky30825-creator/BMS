from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from ai.bundle import BundleLoadError, load_model_bundle


FEATURE_ORDER = ["V_scaled", "V_delta", "V_drop"]
MODEL_VERSION = "ae-test+informer-test"
FEATURE_VERSION = "features-v1"


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_bundle(root: Path) -> dict[str, object]:
    scaler_path = root / "scaler.json"
    _write_json(scaler_path, {
        "schema_version": 1,
        "feature_version": FEATURE_VERSION,
        "model_version": MODEL_VERSION,
        "feature_order": FEATURE_ORDER,
        "method": "standard",
        "parameters": {"mean": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]},
    })
    feature_path = root / "feature_metadata.json"
    _write_json(feature_path, {
        "schema_version": 1,
        "feature_version": FEATURE_VERSION,
        "model_version": MODEL_VERSION,
        "feature_order": FEATURE_ORDER,
        "window_size": 30,
        "normalization": {
            "kind": "standard",
            "scaler_file": "scaler.json",
            "scaler_sha256": _digest(scaler_path),
        },
    })
    checkpoints: dict[str, dict[str, object]] = {}
    for name, content in (("lstm_autoencoder.pt", b"test-only checkpoint ae"), ("informer.pt", b"test-only checkpoint informer")):
        path = root / name
        path.write_bytes(content)
        checkpoints[name.removesuffix(".pt")] = {
            "file": name,
            "sha256": _digest(path),
            "model_version": MODEL_VERSION,
            "feature_version": FEATURE_VERSION,
            "feature_order": FEATURE_ORDER,
            "window_size": 30,
        }
    _write_json(root / "metadata.json", {
        "schema_version": 1,
        "bundle_id": "test-bundle",
        "model_version": MODEL_VERSION,
        "feature_metadata_file": "feature_metadata.json",
        "scaler_file": "scaler.json",
        "checkpoints": checkpoints,
        "implementations": {
            "adapter": "external:test-runner",
            "score_fusion": "external:test-fusion",
            "kalman": "external:test-kalman",
            "internal_cell_temperature": "external:test-cell-temperature",
        },
    })
    return {"feature": feature_path, "scaler": scaler_path, "checkpoints": checkpoints}


class ModelBundleTests(unittest.TestCase):
    def test_loads_and_cross_checks_complete_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            make_bundle(Path(directory))
            loaded = load_model_bundle(directory)
            self.assertEqual(loaded.model_version, MODEL_VERSION)
            self.assertEqual(loaded.feature_metadata.feature_order, tuple(FEATURE_ORDER))
            self.assertEqual(loaded.feature_metadata.window_size, 30)
            self.assertEqual(loaded.lstm_autoencoder.path.name, "lstm_autoencoder.pt")
            self.assertEqual(loaded.informer.path.name, "informer.pt")

    def test_missing_bundle_is_startup_blocking(self) -> None:
        with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_NOT_CONFIGURED"):
            load_model_bundle(None)
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_NOT_FOUND"):
                load_model_bundle(missing)

    def test_missing_or_modified_checkpoint_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            (root / "informer.pt").unlink()
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_FILE_MISSING"):
                load_model_bundle(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            (root / "informer.pt").write_bytes(b"changed")
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_CHECKSUM_MISMATCH"):
                load_model_bundle(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            (root / "lstm_autoencoder.pt").write_bytes(b"")
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_FILE_EMPTY"):
                load_model_bundle(root)

    def test_feature_and_scaler_metadata_must_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            feature_path = root / "feature_metadata.json"
            feature = json.loads(feature_path.read_text(encoding="utf-8"))
            feature["window_size"] = 31
            _write_json(feature_path, feature)
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_METADATA_MISMATCH"):
                load_model_bundle(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            scaler_path = root / "scaler.json"
            scaler = json.loads(scaler_path.read_text(encoding="utf-8"))
            scaler["model_version"] = "wrong"
            _write_json(scaler_path, scaler)
            feature_path = root / "feature_metadata.json"
            feature = json.loads(feature_path.read_text(encoding="utf-8"))
            feature["normalization"]["scaler_sha256"] = _digest(scaler_path)
            _write_json(feature_path, feature)
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_METADATA_MISMATCH"):
                load_model_bundle(root)

    def test_fake_implementation_is_not_a_bundle_option(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            manifest_path = root / "metadata.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["implementations"]["adapter"] = "fake"
            _write_json(manifest_path, manifest)
            with self.assertRaisesRegex(BundleLoadError, "AI_MODEL_BUNDLE_IMPLEMENTATION_FORBIDDEN"):
                load_model_bundle(root)


if __name__ == "__main__":
    unittest.main()
