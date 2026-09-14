"""Fail-closed loading and cross-checking of an external model bundle.

No checkpoint is deserialized here.  The model implementation is deliberately
outside this repository; this loader proves that the files and their
authoritative metadata agree before an adapter can be constructed.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class BundleLoadError(RuntimeError):
    """A startup-blocking model bundle error with a stable operator code."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def _object(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must be an object")
    return value


def _keys(value: Mapping[str, Any], required: set[str], *, label: str) -> None:
    missing = sorted(required - value.keys())
    unknown = sorted(set(value.keys()) - required)
    if missing:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} missing: {', '.join(missing)}")
    if unknown:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} unknown: {', '.join(unknown)}")


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must be a non-empty string")
    return value


def _positive_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must be a positive integer")
    return value


def _string_list(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)) or not value:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must be a non-empty array")
    result = tuple(_string(item, f"{label}[{index}]") for index, item in enumerate(value))
    if len(set(result)) != len(result):
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must not contain duplicates")
    return result


def _sha256(value: object, label: str) -> str:
    digest = _string(value, label).lower()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"{label} must be a SHA-256 hex digest")
    return digest


def _json(path: Path, label: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", f"cannot read {label}") from exc
    return _object(parsed, label)


def _safe_file(root: Path, declared: object, label: str) -> Path:
    name = _string(declared, label)
    candidate = Path(name)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise BundleLoadError("AI_MODEL_BUNDLE_PATH_INVALID", f"{label} must be a relative path inside the bundle")
    resolved = (root / candidate).resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise BundleLoadError("AI_MODEL_BUNDLE_PATH_INVALID", f"{label} escapes the bundle root") from exc
    if not resolved.is_file():
        raise BundleLoadError("AI_MODEL_BUNDLE_FILE_MISSING", name)
    return resolved


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise BundleLoadError("AI_MODEL_BUNDLE_FILE_UNREADABLE", path.name) from exc
    return digest.hexdigest()


def _require_nonempty(path: Path) -> None:
    try:
        if path.stat().st_size == 0:
            raise BundleLoadError("AI_MODEL_BUNDLE_FILE_EMPTY", path.name)
    except OSError as exc:
        raise BundleLoadError("AI_MODEL_BUNDLE_FILE_UNREADABLE", path.name) from exc


def _check_sha256(path: Path, expected: str) -> None:
    if _file_sha256(path) != expected:
        raise BundleLoadError("AI_MODEL_BUNDLE_CHECKSUM_MISMATCH", path.name)


def _finite_vector(value: object, label: str, expected_length: int) -> None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)) or len(value) != expected_length:
        raise BundleLoadError("AI_MODEL_BUNDLE_SCALER_INVALID", f"{label} must contain {expected_length} values")
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise BundleLoadError("AI_MODEL_BUNDLE_SCALER_INVALID", f"{label}[{index}] must be finite")


@dataclass(frozen=True, slots=True)
class FeatureMetadata:
    schema_version: int
    feature_version: str
    model_version: str
    feature_order: tuple[str, ...]
    window_size: int
    normalization_kind: str
    scaler_file: str
    scaler_sha256: str


@dataclass(frozen=True, slots=True)
class ScalerArtifact:
    path: Path
    schema_version: int
    feature_version: str
    model_version: str
    feature_order: tuple[str, ...]
    method: str
    parameters: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class CheckpointArtifact:
    name: str
    path: Path
    sha256: str
    model_version: str
    feature_version: str
    feature_order: tuple[str, ...]
    window_size: int


@dataclass(frozen=True, slots=True)
class ModelBundle:
    """Validated file set handed to an external inference adapter."""

    root: Path
    bundle_id: str
    model_version: str
    feature_metadata: FeatureMetadata
    scaler: ScalerArtifact
    lstm_autoencoder: CheckpointArtifact
    informer: CheckpointArtifact
    implementations: Mapping[str, str]


def load_model_bundle(bundle_dir: str | Path | None) -> ModelBundle:
    """Load and cross-check a bundle, or raise a startup-blocking error.

    Expected files are described in ``docs/ai_inference.md``.  Every path,
    checksum, model version, feature order, window, and scaler declaration is
    checked before the returned object is usable.
    """

    if bundle_dir is None or not str(bundle_dir).strip():
        raise BundleLoadError("AI_MODEL_BUNDLE_NOT_CONFIGURED", "set AI_MODEL_BUNDLE_DIR")
    root = Path(bundle_dir).expanduser().resolve(strict=False)
    if not root.is_dir():
        raise BundleLoadError("AI_MODEL_BUNDLE_NOT_FOUND", str(root))

    manifest_path = root / "metadata.json"
    if not manifest_path.is_file():
        raise BundleLoadError("AI_MODEL_BUNDLE_FILE_MISSING", "metadata.json")
    manifest = _json(manifest_path, "metadata.json")
    _keys(manifest, {
        "schema_version", "bundle_id", "model_version", "feature_metadata_file", "scaler_file",
        "checkpoints", "implementations",
    }, label="metadata.json")
    if manifest["schema_version"] != 1:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", "metadata.json schema_version must be 1")
    bundle_id = _string(manifest["bundle_id"], "metadata.json.bundle_id")
    model_version = _string(manifest["model_version"], "metadata.json.model_version")

    feature_path = _safe_file(root, manifest["feature_metadata_file"], "metadata.json.feature_metadata_file")
    feature_payload = _json(feature_path, "feature metadata")
    _keys(feature_payload, {
        "schema_version", "feature_version", "model_version", "feature_order", "window_size", "normalization",
    }, label="feature metadata")
    if feature_payload["schema_version"] != 1:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", "feature metadata schema_version must be 1")
    feature_version = _string(feature_payload["feature_version"], "feature_version")
    feature_model_version = _string(feature_payload["model_version"], "feature metadata.model_version")
    feature_order = _string_list(feature_payload["feature_order"], "feature_order")
    window_size = _positive_int(feature_payload["window_size"], "window_size")
    normalization = _object(feature_payload["normalization"], "normalization")
    _keys(normalization, {"kind", "scaler_file", "scaler_sha256"}, label="normalization")
    normalization_kind = _string(normalization["kind"], "normalization.kind")
    scaler_declared = _string(manifest["scaler_file"], "metadata.json.scaler_file")
    normalization_scaler_declared = _string(normalization["scaler_file"], "normalization.scaler_file")
    if scaler_declared != normalization_scaler_declared:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "manifest and feature metadata scaler paths differ")
    scaler_sha256 = _sha256(normalization["scaler_sha256"], "normalization.scaler_sha256")
    if feature_model_version != model_version:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "feature metadata model_version differs")

    scaler_path = _safe_file(root, scaler_declared, "scaler_file")
    _require_nonempty(scaler_path)
    _check_sha256(scaler_path, scaler_sha256)
    scaler_payload = _json(scaler_path, "scaler")
    _keys(scaler_payload, {
        "schema_version", "feature_version", "model_version", "feature_order", "method", "parameters",
    }, label="scaler")
    if scaler_payload["schema_version"] != 1:
        raise BundleLoadError("AI_MODEL_BUNDLE_SCALER_INVALID", "scaler schema_version must be 1")
    if _string(scaler_payload["feature_version"], "scaler.feature_version") != feature_version:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "scaler feature_version differs")
    if _string(scaler_payload["model_version"], "scaler.model_version") != model_version:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "scaler model_version differs")
    if _string_list(scaler_payload["feature_order"], "scaler.feature_order") != feature_order:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "scaler feature_order differs")
    scaler_method = _string(scaler_payload["method"], "scaler.method")
    if scaler_method != normalization_kind:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", "scaler method differs from normalization kind")
    scaler_parameters = _object(scaler_payload["parameters"], "scaler.parameters")
    if not scaler_parameters:
        raise BundleLoadError("AI_MODEL_BUNDLE_SCALER_INVALID", "scaler.parameters must not be empty")
    for parameter_name, parameter_values in scaler_parameters.items():
        _finite_vector(parameter_values, f"scaler.parameters.{parameter_name}", len(feature_order))

    checkpoints_payload = _object(manifest["checkpoints"], "metadata.json.checkpoints")
    if set(checkpoints_payload) != {"lstm_autoencoder", "informer"}:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", "both lstm_autoencoder and informer checkpoints are required")

    def checkpoint(name: str) -> CheckpointArtifact:
        payload = _object(checkpoints_payload[name], f"checkpoints.{name}")
        _keys(payload, {"file", "sha256", "model_version", "feature_version", "feature_order", "window_size"}, label=f"checkpoints.{name}")
        path = _safe_file(root, payload["file"], f"checkpoints.{name}.file")
        _require_nonempty(path)
        expected_sha = _sha256(payload["sha256"], f"checkpoints.{name}.sha256")
        _check_sha256(path, expected_sha)
        descriptor_model_version = _string(payload["model_version"], f"checkpoints.{name}.model_version")
        descriptor_feature_version = _string(payload["feature_version"], f"checkpoints.{name}.feature_version")
        descriptor_order = _string_list(payload["feature_order"], f"checkpoints.{name}.feature_order")
        descriptor_window = _positive_int(payload["window_size"], f"checkpoints.{name}.window_size")
        if descriptor_model_version != model_version or descriptor_feature_version != feature_version:
            raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", f"{name} checkpoint version differs")
        if descriptor_order != feature_order:
            raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", f"{name} checkpoint feature_order differs")
        if descriptor_window != window_size:
            raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_MISMATCH", f"{name} checkpoint window_size differs")
        return CheckpointArtifact(
            name=name,
            path=path,
            sha256=expected_sha,
            model_version=descriptor_model_version,
            feature_version=descriptor_feature_version,
            feature_order=descriptor_order,
            window_size=descriptor_window,
        )

    lstm = checkpoint("lstm_autoencoder")
    informer = checkpoint("informer")
    if lstm.path == informer.path:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", "LSTM-AE and Informer must use distinct checkpoint files")

    implementations = _object(manifest["implementations"], "metadata.json.implementations")
    required_implementations = {"adapter", "score_fusion", "kalman", "internal_cell_temperature"}
    if set(implementations) != required_implementations:
        raise BundleLoadError("AI_MODEL_BUNDLE_METADATA_INVALID", "all inference implementations must be declared")
    implementation_values: dict[str, str] = {}
    for role, implementation in implementations.items():
        declared = _string(implementation, f"implementations.{role}")
        if any(token in declared.casefold() for token in ("fake", "mock", "stub", "placeholder", "noop")):
            raise BundleLoadError("AI_MODEL_BUNDLE_IMPLEMENTATION_FORBIDDEN", f"{role} cannot select a fake implementation")
        if role in {"adapter", "score_fusion"} and declared.casefold() in {"none", "disabled", "not_available"}:
            raise BundleLoadError("AI_MODEL_BUNDLE_IMPLEMENTATION_FORBIDDEN", f"{role} must have an implementation")
        implementation_values[role] = declared

    return ModelBundle(
        root=root,
        bundle_id=bundle_id,
        model_version=model_version,
        feature_metadata=FeatureMetadata(
            schema_version=1,
            feature_version=feature_version,
            model_version=model_version,
            feature_order=feature_order,
            window_size=window_size,
            normalization_kind=normalization_kind,
            scaler_file=scaler_declared,
            scaler_sha256=scaler_sha256,
        ),
        scaler=ScalerArtifact(
            path=scaler_path,
            schema_version=1,
            feature_version=feature_version,
            model_version=model_version,
            feature_order=feature_order,
            method=scaler_method,
            parameters=dict(scaler_parameters),
        ),
        lstm_autoencoder=lstm,
        informer=informer,
        implementations=implementation_values,
    )
