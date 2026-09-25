"""Version-1 contracts used by the local inference process.

The TypeScript contract in ``backend/src/kafka.ts`` remains the wire source of
truth.  This module intentionally contains validation and interfaces only; it
does not contain a model, a score fallback, or any safety decision.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol, TypeAlias


CONTRACT_VERSION: Literal[1] = 1
RAW_TOPIC = "battery-raw-metrics"
ANOMALY_TOPIC = "battery-anomaly-alerts"


class ContractError(ValueError):
    """Raised when a Kafka payload or adapter result violates the v1 contract."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


Number: TypeAlias = int | float
NullableNumber: TypeAlias = Number | None
ContactPoints: TypeAlias = tuple[NullableNumber, NullableNumber, NullableNumber]


def _mapping(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError("AI_RAW_CONTRACT_INVALID", f"{field} must be an object")
    return value


def _number(value: object, field: str, *, nullable: bool = False, error_code: str = "AI_RAW_CONTRACT_INVALID") -> Number | None:
    if value is None and nullable:
        return None
    # bool is an int subclass but is never a sensor value.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(error_code, f"{field} must be a finite number or null")
    if not math.isfinite(float(value)):
        raise ContractError(error_code, f"{field} must be finite")
    return value


def _score(value: object, field: str, *, nullable: bool = False, error_code: str = "AI_INFERENCE_OUTPUT_INVALID") -> float | None:
    number = _number(value, field, nullable=nullable, error_code=error_code)
    if number is None:
        return None
    score = float(number)
    if score < 0 or score > 1:
        raise ContractError(error_code, f"{field} must be between 0 and 1")
    return score


def _timestamp(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ContractError("AI_CONTRACT_INVALID", f"{field} must be an ISO8601 UTC timestamp with a Z suffix")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ContractError("AI_CONTRACT_INVALID", f"{field} is not a valid timestamp") from exc
    if parsed.utcoffset() != timedelta(0):
        raise ContractError("AI_CONTRACT_INVALID", f"{field} must be UTC")
    return value


def _strict_keys(payload: Mapping[str, Any], required: set[str], optional: set[str], *, code: str) -> None:
    missing = sorted(required - payload.keys())
    unknown = sorted(set(payload.keys()) - required - optional)
    if missing:
        raise ContractError(code, f"missing fields: {', '.join(missing)}")
    if unknown:
        raise ContractError(code, f"unknown fields: {', '.join(unknown)}")


def _temperature_points(value: object) -> tuple[ContactPoints | None, tuple[NullableNumber, ...]]:
    points = _mapping(value, "temp_points")
    _strict_keys(points, {"contact", "ir"}, set(), code="AI_RAW_CONTRACT_INVALID")

    contact_value = points["contact"]
    contact: ContactPoints | None
    if contact_value is None:
        contact = None
    else:
        if not isinstance(contact_value, Sequence) or isinstance(contact_value, (str, bytes, bytearray)) or len(contact_value) != 3:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "temp_points.contact must contain exactly three values or null")
        parsed_contact = tuple(_number(item, f"temp_points.contact[{index}]", nullable=True) for index, item in enumerate(contact_value))
        contact = (parsed_contact[0], parsed_contact[1], parsed_contact[2])

    ir_value = points["ir"]
    if not isinstance(ir_value, Sequence) or isinstance(ir_value, (str, bytes, bytearray)) or len(ir_value) < 1:
        raise ContractError("AI_RAW_CONTRACT_INVALID", "temp_points.ir must contain at least one value")
    ir = tuple(_number(item, f"temp_points.ir[{index}]", nullable=True) for index, item in enumerate(ir_value))
    return contact, ir


def _check_peak(field: str, scalar: Number | None, points: Sequence[Number | None] | None) -> None:
    if points is None:
        if scalar is not None:
            raise ContractError("AI_RAW_CONTRACT_INVALID", f"{field} must be null when temperature points are unavailable")
        return
    present = [float(point) for point in points if point is not None]
    expected = None if not present else max(present)
    if scalar is None and expected is None:
        return
    if scalar is None or expected is None or float(scalar) != expected:
        raise ContractError("AI_RAW_CONTRACT_INVALID", f"{field} must equal the maximum non-null temperature point")


@dataclass(frozen=True, slots=True)
class RawMetricsFrame:
    """Validated version-1 frame produced by the edge."""

    version: Literal[1]
    device_id: str
    mode: Literal[1, 2]
    timestamp: str
    voltage_v: NullableNumber
    current_a: NullableNumber
    power_w: NullableNumber
    soc_pct: NullableNumber
    temp_contact: NullableNumber
    temp_ir_surface: NullableNumber
    temp_points_contact: ContactPoints | None
    temp_points_ir: tuple[NullableNumber, ...]
    gas_raw: NullableNumber
    pressure_raw: NullableNumber
    acoustic_raw: None
    age_ms: Mapping[str, int]
    diag_phase: str | None = None
    load_target_a: NullableNumber = None
    # Room temperature from a probe not attached to the battery; the reference
    # for heat rise (surface - ambient). Not a temp_points entry, no peak rule.
    temp_ambient: NullableNumber = None

    def to_payload(self) -> dict[str, Any]:
        """Return a JSON-compatible copy without adding derived values."""

        payload: dict[str, Any] = {
            "version": self.version,
            "device_id": self.device_id,
            "mode": self.mode,
            "timestamp": self.timestamp,
            "voltage_v": self.voltage_v,
            "current_a": self.current_a,
            "power_w": self.power_w,
            "soc_pct": self.soc_pct,
            "temp_contact": self.temp_contact,
            "temp_ir_surface": self.temp_ir_surface,
            "temp_points": {
                "contact": None if self.temp_points_contact is None else list(self.temp_points_contact),
                "ir": list(self.temp_points_ir),
            },
            "gas_raw": self.gas_raw,
            "pressure_raw": self.pressure_raw,
            "acoustic_raw": self.acoustic_raw,
            "age_ms": dict(self.age_ms),
            "diag_phase": self.diag_phase,
            "load_target_a": self.load_target_a,
            "temp_ambient": self.temp_ambient,
        }
        # The backend schema makes these fields optional.  Including them as
        # null is valid and keeps the internal representation deterministic.
        return payload


_PHASES = {
    "P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "CAPACITY",
    "S0", "S1A", "S1B", "S1C", "S1D", "S1E", "S1F", "S2", "S3",
}


def parse_raw_metrics(payload: object) -> RawMetricsFrame:
    """Validate and parse a raw v1 payload from ``battery-raw-metrics``."""

    value = _mapping(payload, "raw payload")
    required = {
        "version", "device_id", "mode", "timestamp", "voltage_v", "current_a", "power_w",
        "soc_pct", "temp_contact", "temp_ir_surface", "temp_points", "gas_raw", "pressure_raw",
        "acoustic_raw", "age_ms",
    }
    optional = {"diag_phase", "load_target_a", "temp_ambient"}
    _strict_keys(value, required, optional, code="AI_RAW_CONTRACT_INVALID")

    if value["version"] != CONTRACT_VERSION:
        raise ContractError("AI_RAW_CONTRACT_INVALID", "version must be 1")
    device_id = value["device_id"]
    if not isinstance(device_id, str) or not device_id.strip():
        raise ContractError("AI_RAW_CONTRACT_INVALID", "device_id must be a non-empty string")
    mode = value["mode"]
    if mode not in (1, 2):
        raise ContractError("AI_RAW_CONTRACT_INVALID", "mode must be 1 or 2")
    timestamp = _timestamp(value["timestamp"], "timestamp")

    numeric_fields = {
        field: _number(value.get(field), field, nullable=True)
        for field in ("voltage_v", "current_a", "power_w", "temp_contact", "temp_ir_surface", "temp_ambient", "gas_raw", "pressure_raw", "load_target_a")
    }
    soc = _number(value["soc_pct"], "soc_pct", nullable=True)
    if soc is not None and not 0 <= float(soc) <= 100:
        raise ContractError("AI_RAW_CONTRACT_INVALID", "soc_pct must be between 0 and 100")
    if value["acoustic_raw"] is not None:
        raise ContractError("AI_RAW_CONTRACT_INVALID", "acoustic_raw is fixed to null for current hardware")

    points_contact, points_ir = _temperature_points(value["temp_points"])
    _check_peak("temp_contact", numeric_fields["temp_contact"], points_contact)
    _check_peak("temp_ir_surface", numeric_fields["temp_ir_surface"], points_ir)

    if mode == 1:
        if numeric_fields["gas_raw"] is not None:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "mode 1 does not have a gas sensor")
        if points_contact is None:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "mode 1 requires three contact temperature points")
    else:
        if numeric_fields["pressure_raw"] is not None:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "mode 2 does not have a pressure sensor")
        if points_contact is not None or numeric_fields["temp_contact"] is not None:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "mode 2 has no contact temperature sensor")

    age_value = _mapping(value["age_ms"], "age_ms")
    age_ms: dict[str, int] = {}
    for key, age in age_value.items():
        if not isinstance(key, str) or isinstance(age, bool) or not isinstance(age, int) or age < 0:
            raise ContractError("AI_RAW_CONTRACT_INVALID", "age_ms values must be non-negative integers")
        age_ms[key] = age

    phase = value.get("diag_phase")
    if phase is not None and (not isinstance(phase, str) or phase not in _PHASES):
        raise ContractError("AI_RAW_CONTRACT_INVALID", "diag_phase is not a known v1 phase")

    return RawMetricsFrame(
        version=CONTRACT_VERSION,
        device_id=device_id,
        mode=mode,
        timestamp=timestamp,
        voltage_v=numeric_fields["voltage_v"],
        current_a=numeric_fields["current_a"],
        power_w=numeric_fields["power_w"],
        soc_pct=soc,
        temp_contact=numeric_fields["temp_contact"],
        temp_ir_surface=numeric_fields["temp_ir_surface"],
        temp_points_contact=points_contact,
        temp_points_ir=points_ir,
        gas_raw=numeric_fields["gas_raw"],
        pressure_raw=numeric_fields["pressure_raw"],
        acoustic_raw=None,
        age_ms=age_ms,
        diag_phase=phase,
        load_target_a=numeric_fields["load_target_a"],
        temp_ambient=numeric_fields["temp_ambient"],
    )


Contribution: TypeAlias = tuple[str, float]


def _contributions(value: object, *, error_code: str) -> tuple[Contribution, ...] | None:
    if value is None:
        return None
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ContractError(error_code, "contributions must be an array or null")
    parsed: list[Contribution] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise ContractError(error_code, f"contributions[{index}] must be an object")
        _strict_keys(item, {"feature", "contribution"}, set(), code=error_code)
        feature = item["feature"]
        if not isinstance(feature, str) or not feature.strip():
            raise ContractError(error_code, f"contributions[{index}].feature must be non-empty")
        amount = _number(
            item["contribution"],
            f"contributions[{index}].contribution",
            error_code=error_code,
        )
        assert amount is not None
        if float(amount) < 0:
            raise ContractError(error_code, "contribution must be non-negative")
        parsed.append((feature, float(amount)))
    return tuple(parsed)


@dataclass(frozen=True, slots=True)
class InferenceOutput:
    """Output supplied by an explicitly implemented model adapter.

    The adapter, not this runtime, owns feature extraction, normalization,
    score fusion, Kalman filtering, and internal-cell estimation.  ``None`` is
    only valid for an explicitly unavailable derived-temperature channel.
    """

    evaluated_at: str
    score: float
    ae_score: float | None
    informer_score: float | None
    contributions: tuple[Contribution, ...] | None
    model_version: str
    temp_kalman: float | None
    temp_cell_estimated: float | None

    def to_payload(self, device_id: str, *, evaluated_at: str | None = None) -> dict[str, Any]:
        """Serialize the adapter result for the anomaly wire contract.

        ``evaluated_at`` normally remains the adapter value.  The production
        raw-to-anomaly boundary passes the validated raw frame timestamp here
        so the wire natural key does not depend on process wall-clock time.
        All other values remain exclusively adapter supplied.
        """

        return {
            "version": CONTRACT_VERSION,
            "device_id": device_id,
            "evaluated_at": self.evaluated_at if evaluated_at is None else evaluated_at,
            "score": self.score,
            "ae_score": self.ae_score,
            "informer_score": self.informer_score,
            "contributions": None if self.contributions is None else [
                {"feature": feature, "contribution": contribution}
                for feature, contribution in self.contributions
            ],
            "model_version": self.model_version,
            "temp_kalman": self.temp_kalman,
            "temp_cell_estimated": self.temp_cell_estimated,
        }


def parse_inference_output(payload: object) -> InferenceOutput:
    """Validate an adapter mapping without filling in missing values."""

    value = _mapping(payload, "inference output")
    required = {
        "evaluated_at", "score", "ae_score", "informer_score", "contributions",
        "model_version", "temp_kalman", "temp_cell_estimated",
    }
    _strict_keys(value, required, set(), code="AI_INFERENCE_OUTPUT_INVALID")
    evaluated_at = _timestamp(value["evaluated_at"], "evaluated_at")
    score = _score(value["score"], "score")
    ae_score = _score(value["ae_score"], "ae_score", nullable=True)
    informer_score = _score(value["informer_score"], "informer_score", nullable=True)
    model_version = value["model_version"]
    if not isinstance(model_version, str) or not model_version.strip():
        raise ContractError("AI_INFERENCE_OUTPUT_INVALID", "model_version must be a non-empty string")

    contributions = _contributions(value["contributions"], error_code="AI_INFERENCE_OUTPUT_INVALID")

    temp_kalman = _number(value["temp_kalman"], "temp_kalman", nullable=True, error_code="AI_INFERENCE_OUTPUT_INVALID")
    temp_cell = _number(value["temp_cell_estimated"], "temp_cell_estimated", nullable=True, error_code="AI_INFERENCE_OUTPUT_INVALID")
    return InferenceOutput(
        evaluated_at=evaluated_at,
        score=float(score),
        ae_score=ae_score,
        informer_score=informer_score,
        contributions=contributions,
        model_version=model_version,
        temp_kalman=None if temp_kalman is None else float(temp_kalman),
        temp_cell_estimated=None if temp_cell is None else float(temp_cell),
    )


def build_anomaly_alert(
    frame: RawMetricsFrame,
    output: InferenceOutput | Mapping[str, Any],
    *,
    expected_model_version: str,
) -> dict[str, Any]:
    """Build the exact v1 anomaly payload; never synthesize a score or field."""

    parsed = output if isinstance(output, InferenceOutput) else parse_inference_output(output)
    # Mapping results have already gone through parse_inference_output.  An
    # adapter may inject the dataclass directly, so validate its timestamp too
    # before the runtime replaces only the wire identity timestamp below.
    try:
        _timestamp(parsed.evaluated_at, "evaluated_at")
    except ContractError as exc:
        raise ContractError("AI_INFERENCE_OUTPUT_INVALID", str(exc)) from exc
    if parsed.model_version != expected_model_version:
        raise ContractError(
            "AI_INFERENCE_OUTPUT_INVALID",
            f"model_version {parsed.model_version!r} does not match loaded bundle {expected_model_version!r}",
        )
    # A production bundle contains both models.  A missing individual score is
    # therefore an inference failure, not a reason to publish a partial alert.
    if parsed.ae_score is None or parsed.informer_score is None:
        raise ContractError("AI_INFERENCE_OUTPUT_INVALID", "both ae_score and informer_score are required")
    # The raw frame timestamp is the authoritative event time.  It is stable
    # across Kafka replay and process restarts; adapter wall-clock time must not
    # become the (device_id, evaluated_at) database natural key.
    payload = parsed.to_payload(frame.device_id, evaluated_at=frame.timestamp)
    validate_anomaly_alert(payload)
    return payload


def validate_anomaly_alert(payload: object) -> dict[str, Any]:
    """Validate the output wire shape against ``battery-anomaly-alerts`` v1."""

    value = _mapping(payload, "anomaly payload")
    required = {
        "version", "device_id", "evaluated_at", "score", "ae_score", "informer_score",
        "contributions", "model_version", "temp_kalman", "temp_cell_estimated",
    }
    _strict_keys(value, required, set(), code="AI_ANOMALY_CONTRACT_INVALID")
    if value["version"] != CONTRACT_VERSION:
        raise ContractError("AI_ANOMALY_CONTRACT_INVALID", "version must be 1")
    device_id = value["device_id"]
    if not isinstance(device_id, str) or not device_id.strip():
        raise ContractError("AI_ANOMALY_CONTRACT_INVALID", "device_id must be non-empty")
    _timestamp(value["evaluated_at"], "evaluated_at")
    _score(value["score"], "score", error_code="AI_ANOMALY_CONTRACT_INVALID")
    _score(value["ae_score"], "ae_score", nullable=True, error_code="AI_ANOMALY_CONTRACT_INVALID")
    _score(value["informer_score"], "informer_score", nullable=True, error_code="AI_ANOMALY_CONTRACT_INVALID")
    model_version = value["model_version"]
    if model_version is not None and (not isinstance(model_version, str) or not model_version.strip()):
        raise ContractError("AI_ANOMALY_CONTRACT_INVALID", "model_version must be non-empty or null")
    _contributions(value["contributions"], error_code="AI_ANOMALY_CONTRACT_INVALID")
    _number(value["temp_kalman"], "temp_kalman", nullable=True, error_code="AI_ANOMALY_CONTRACT_INVALID")
    _number(value["temp_cell_estimated"], "temp_cell_estimated", nullable=True, error_code="AI_ANOMALY_CONTRACT_INVALID")
    return dict(value)


class InferenceAdapter(Protocol):
    """Contract for an externally implemented model bundle adapter."""

    def infer(self, frame: RawMetricsFrame) -> InferenceOutput | Mapping[str, Any] | Awaitable[InferenceOutput | Mapping[str, Any]]:
        """Infer from one validated raw frame without changing safety state."""


@dataclass(frozen=True, slots=True)
class BrokerMessage:
    topic: str
    partition: int
    offset: str
    value: bytes | str | None


class BrokerConsumer(Protocol):
    async def connect(self) -> None: ...

    async def subscribe(self, topic: str) -> None: ...

    async def receive(self, timeout_ms: int) -> BrokerMessage | None: ...

    async def commit(self, topic: str, partition: int, offset: str) -> None: ...

    async def close(self) -> None: ...


class BrokerProducer(Protocol):
    async def connect(self) -> None: ...

    async def publish(self, topic: str, key: str, value: bytes) -> None: ...

    async def close(self) -> None: ...
