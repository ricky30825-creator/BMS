"""Turn a ``train.py`` artifact folder into a runtime bundle (``ai/bundle.py``).

The runtime bundle format only allows per-feature vectors in ``scaler.json``
parameters (every value has ``len(feature_order)`` entries) and one
``feature_order`` for both checkpoints. Scalar settings (score_q99, threshold,
top-k, fusion weight) are therefore stored as constant vectors; the adapter
checks they are constant before reading them back as scalars. No contract in
``ai/bundle.py`` changes.

Refused on purpose (the runtime scores devices it has never seen):

* ``per_run`` calibration - needs a run id that does not exist online.
* AE and Informer using different feature sets - the bundle has one order.
* Feature sets other than ``local_relative5`` - mode 2 has no contact probe.

Usage::

    python -m ai.model.export_bundle --artifacts ai/artifacts/pb_5feat_global --output ai/bundles/pb_mode2
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from . import BASELINE_VERSION
from .features import CONTEXT, FEATURE_NAMES, HISTORY, PREDICTION

SUPPORTED_FEATURE_SET = "local_relative5"
WINDOW_ROWS = CONTEXT + HISTORY + PREDICTION  # 133 one-second rows the adapter must buffer
ADAPTER = "python:ai.model.adapter:create_adapter"


class ExportError(ValueError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _constant(value: float, k: int) -> list[float]:
    return [float(value)] * k


def export_bundle(artifacts: Path, output: Path, config_name: str = "selected_configuration.json") -> Path:
    artifacts, output = Path(artifacts), Path(output)
    config = json.loads((artifacts / config_name).read_text(encoding="utf-8"))
    ae, inf, fusion = config["ae"], config["informer"], config["fusion"]

    for name, setting in (("ae", ae), ("informer", inf)):
        if setting["scope"] != "global":
            raise ExportError(f"{name} uses {setting['scope']!r} calibration; only 'global' can score unseen devices")
        if setting["features"] != SUPPORTED_FEATURE_SET:
            raise ExportError(f"{name} uses feature set {setting['features']!r}; mode 2 requires {SUPPORTED_FEATURE_SET!r}")
    if ae["topk"] != inf["topk"]:
        raise ExportError("AE and Informer top-k differ; the bundle stores one value")
    if fusion["kind"] not in ("max", "weighted_sum"):
        raise ExportError(f"unknown fusion kind {fusion['kind']!r}")

    order = FEATURE_NAMES[SUPPORTED_FEATURE_SET]
    k = len(order)
    parameters: dict[str, list[float]] = {}
    sources: dict[str, Path] = {}
    for tag, setting, key in (("ae", ae, "ae_calibration"), ("informer", inf, "informer_calibration")):
        scaler = json.loads((artifacts / setting["scaler"]).read_text(encoding="utf-8"))
        if scaler["feature_names"] != order:
            raise ExportError(f"{tag} scaler feature_names differ from {order}")
        calibration = config[key]["global"]
        parameters[f"{tag}_mean"] = [float(v) for v in scaler["mean"]]
        parameters[f"{tag}_std"] = [float(v) for v in scaler["std"]]
        parameters[f"{tag}_median"] = [float(v) for v in calibration["median"]]
        parameters[f"{tag}_spread"] = [float(v) for v in calibration["spread"]]
        parameters[f"{tag}_score_q99"] = _constant(calibration["score_q99"], k)
        sources[tag] = artifacts / setting["checkpoint"]
    parameters["topk"] = _constant(ae["topk"], k)
    parameters["fusion_threshold"] = _constant(fusion["threshold"], k)
    parameters["fusion_alpha_ae"] = _constant(-1.0 if fusion["alpha_ae"] is None else fusion["alpha_ae"], k)
    parameters["fusion_is_max"] = _constant(1.0 if fusion["kind"] == "max" else 0.0, k)
    for name, values in parameters.items():
        if len(values) != k:
            raise ExportError(f"{name} has {len(values)} values, expected {k}")

    model_version = f"baseline-{BASELINE_VERSION}-{SUPPORTED_FEATURE_SET}-global"
    output.mkdir(parents=True, exist_ok=True)
    scaler_file = output / "scaler.json"
    scaler_file.write_text(json.dumps(dict(
        schema_version=1, feature_version=SUPPORTED_FEATURE_SET, model_version=model_version,
        feature_order=order, method="robust_calibrated_local_relative", parameters=parameters), indent=2), encoding="utf-8")
    feature_file = output / "feature_metadata.json"
    feature_file.write_text(json.dumps(dict(
        schema_version=1, feature_version=SUPPORTED_FEATURE_SET, model_version=model_version,
        feature_order=order, window_size=WINDOW_ROWS,
        normalization=dict(kind="robust_calibrated_local_relative", scaler_file="scaler.json",
                           scaler_sha256=_sha256(scaler_file))), indent=2), encoding="utf-8")

    checkpoints = {}
    for tag, bundle_name in (("ae", "lstm_autoencoder"), ("informer", "informer")):
        target = output / f"{bundle_name}.pt"
        shutil.copyfile(sources[tag], target)
        checkpoints[bundle_name] = dict(file=target.name, sha256=_sha256(target), model_version=model_version,
                                        feature_version=SUPPORTED_FEATURE_SET, feature_order=order,
                                        window_size=WINDOW_ROWS)
    manifest = output / "metadata.json"
    manifest.write_text(json.dumps(dict(
        schema_version=1, bundle_id=f"{model_version}-{checkpoints['informer']['sha256'][:12]}",
        model_version=model_version, feature_metadata_file=feature_file.name, scaler_file=scaler_file.name,
        checkpoints=checkpoints,
        implementations=dict(adapter=ADAPTER, score_fusion="python:ai.model.scoring:combine",
                             kalman="not_available", internal_cell_temperature="not_available")), indent=2),
        encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(export_bundle(args.artifacts, args.output))


if __name__ == "__main__":
    main()
