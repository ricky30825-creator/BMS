"""Explicit, fail-closed configuration for the edge command service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, TypeAlias


HardwareProfile: TypeAlias = Literal["MODE1_EXTERNAL_CELL_V1", "COMBINED_EXISTING_PARTS_V1"]
Environment: TypeAlias = Literal["production", "test"]
SUPPORTED_PROFILES = frozenset({"MODE1_EXTERNAL_CELL_V1", "COMBINED_EXISTING_PARTS_V1"})


class EdgeConfigError(RuntimeError):
    """A configuration error that must stop before Kafka/GPIO startup."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def _text(values: Mapping[str, str], name: str, default: str = "") -> str:
    value = values.get(name, default)
    return value.strip()


def _positive_int(values: Mapping[str, str], name: str, default: int) -> int:
    raw = _text(values, name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise EdgeConfigError("EDGE_CONFIG_INVALID", f"{name} must be a positive integer") from exc
    if value <= 0:
        raise EdgeConfigError("EDGE_CONFIG_INVALID", f"{name} must be a positive integer")
    return value


def _brokers(values: Mapping[str, str]) -> tuple[str, ...]:
    raw = _text(values, "EDGE_KAFKA_BROKERS")
    brokers = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not brokers:
        raise EdgeConfigError("EDGE_CONFIG_INVALID", "EDGE_KAFKA_BROKERS must contain at least one broker")
    if any(any(character.isspace() for character in broker) for broker in brokers):
        raise EdgeConfigError("EDGE_CONFIG_INVALID", "EDGE_KAFKA_BROKERS must not contain whitespace inside a broker")
    return brokers


@dataclass(frozen=True, slots=True)
class EdgeConfig:
    environment: Environment
    brokers: tuple[str, ...]
    client_id: str
    group_id: str
    topic: str
    idempotency_db: Path
    hardware_profile: HardwareProfile
    source_gate_file: Path | None
    poll_timeout_ms: int
    retry_delay_ms: int
    # These are intentionally optional at configuration time.  A missing file
    # is a denied physical gate (never an implicit approval), which keeps a
    # deployment fail-closed while allowing mode-1-only hardware to run.
    current_gate_file: Path | None = None
    ovf_gate_file: Path | None = None

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> "EdgeConfig":
        source = os.environ if values is None else values
        environment_value = _text(source, "EDGE_ENV", "production").casefold()
        if environment_value not in {"production", "test"}:
            raise EdgeConfigError("EDGE_CONFIG_INVALID", "EDGE_ENV must be production or test")
        environment: Environment = environment_value  # type: ignore[assignment]

        profile = _text(source, "EDGE_HARDWARE_PROFILE")
        if profile not in SUPPORTED_PROFILES:
            raise EdgeConfigError(
                "EDGE_HARDWARE_PROFILE_INVALID",
                "EDGE_HARDWARE_PROFILE must explicitly be MODE1_EXTERNAL_CELL_V1 or COMBINED_EXISTING_PARTS_V1",
            )

        gpio_backend = _text(source, "EDGE_GPIO_BACKEND", "rpi").casefold()
        if gpio_backend in {"fake", "mock", "stub", "noop", "placeholder"}:
            raise EdgeConfigError("EDGE_FAKE_GPIO_FORBIDDEN", "production edge runtime cannot select a fake GPIO backend")
        if gpio_backend != "rpi":
            raise EdgeConfigError("EDGE_GPIO_BACKEND_INVALID", "only the explicit rpi GPIO backend is supported")

        client_id = _text(source, "EDGE_KAFKA_CLIENT_ID", "cellguard-edge-command")
        group_id = _text(source, "EDGE_KAFKA_GROUP_ID", "cellguard-edge-command")
        if not client_id or not group_id:
            raise EdgeConfigError("EDGE_CONFIG_INVALID", "Kafka client and group IDs must be non-empty")

        topic = _text(source, "EDGE_KAFKA_TOPIC", "battery-events")
        if topic != "battery-events":
            raise EdgeConfigError("EDGE_TOPIC_INVALID", "edge command consumer must subscribe to battery-events")

        idempotency_text = _text(source, "EDGE_IDEMPOTENCY_DB")
        if not idempotency_text:
            raise EdgeConfigError("EDGE_IDEMPOTENCY_DB_REQUIRED", "set EDGE_IDEMPOTENCY_DB to a durable local SQLite path")
        if environment == "production" and idempotency_text == ":memory:":
            raise EdgeConfigError("EDGE_IDEMPOTENCY_DB_INVALID", "production idempotency store cannot use :memory:")

        gate_text = _text(source, "EDGE_SOURCE_GATE_FILE")
        current_gate_text = _text(source, "EDGE_CURRENT_GATE_FILE")
        ovf_gate_text = _text(source, "EDGE_OVF_GATE_FILE")
        return cls(
            environment=environment,
            brokers=_brokers(source),
            client_id=client_id,
            group_id=group_id,
            topic=topic,
            idempotency_db=Path(idempotency_text),
            hardware_profile=profile,  # type: ignore[assignment]
            source_gate_file=Path(gate_text) if gate_text else None,
            current_gate_file=Path(current_gate_text) if current_gate_text else None,
            ovf_gate_file=Path(ovf_gate_text) if ovf_gate_text else None,
            poll_timeout_ms=_positive_int(source, "EDGE_POLL_TIMEOUT_MS", 1000),
            retry_delay_ms=_positive_int(source, "EDGE_RETRY_DELAY_MS", 1000),
        )
