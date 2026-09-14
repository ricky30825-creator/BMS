"""Environment validation for the production inference process."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping

from .contracts import ANOMALY_TOPIC, RAW_TOPIC


class ConfigError(RuntimeError):
    """A configuration error that must stop the process before Kafka connects."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


Environment = Literal["production", "test"]


def _text(values: Mapping[str, str], name: str, default: str = "") -> str:
    value = values.get(name, default).strip()
    return value


def _positive_int(values: Mapping[str, str], name: str, default: int) -> int:
    value = _text(values, name, str(default))
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigError("AI_CONFIG_INVALID", f"{name} must be a positive integer") from exc
    if parsed <= 0:
        raise ConfigError("AI_CONFIG_INVALID", f"{name} must be a positive integer")
    return parsed


def _brokers(values: Mapping[str, str]) -> tuple[str, ...]:
    raw = _text(values, "AI_KAFKA_BROKERS", "127.0.0.1:9092")
    brokers = tuple(item.strip() for item in raw.split(",") if item.strip())
    if not brokers:
        raise ConfigError("AI_CONFIG_INVALID", "AI_KAFKA_BROKERS must contain at least one broker")
    if any(any(character.isspace() for character in broker) for broker in brokers):
        raise ConfigError("AI_CONFIG_INVALID", "AI_KAFKA_BROKERS must not contain whitespace inside a broker")
    return brokers


def _reject_fake_selection(values: Mapping[str, str]) -> None:
    """Do not let an environment flag turn production into a fake service."""

    selector_names = ("AI_ADAPTER", "AI_MODEL_BACKEND", "AI_INFERENCE_ADAPTER")
    for name in selector_names:
        value = values.get(name, "").strip().casefold()
        if any(token in value for token in ("fake", "mock", "stub", "placeholder", "noop")):
            raise ConfigError("AI_FAKE_ADAPTER_FORBIDDEN", f"{name} is not a production selection")
    for name in ("AI_USE_FAKE_MODEL", "AI_FAKE_MODEL"):
        value = values.get(name, "").strip().casefold()
        if value and value not in {"false", "0", "no"}:
            raise ConfigError("AI_FAKE_ADAPTER_FORBIDDEN", f"{name} is not a production selection")


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    environment: Environment
    brokers: tuple[str, ...]
    client_id: str
    group_id: str
    raw_topic: str
    anomaly_topic: str
    model_bundle_dir: Path | None
    poll_timeout_ms: int
    publish_timeout_ms: int

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> "RuntimeConfig":
        source = os.environ if values is None else values
        _reject_fake_selection(source)
        environment_value = _text(source, "AI_ENV", "production").casefold()
        if environment_value not in {"production", "test"}:
            raise ConfigError("AI_CONFIG_INVALID", "AI_ENV must be production or test")
        environment: Environment = environment_value  # type: ignore[assignment]

        client_id = _text(source, "AI_KAFKA_CLIENT_ID", "cellguard-ai-inference")
        group_id = _text(source, "AI_KAFKA_GROUP_ID", "cellguard-ai-inference")
        if not client_id or not group_id:
            raise ConfigError("AI_CONFIG_INVALID", "Kafka client and group ids must be non-empty")
        raw_topic = _text(source, "AI_RAW_TOPIC", RAW_TOPIC)
        anomaly_topic = _text(source, "AI_ANOMALY_TOPIC", ANOMALY_TOPIC)
        if not raw_topic or not anomaly_topic:
            raise ConfigError("AI_CONFIG_INVALID", "Kafka topics must be non-empty")
        if raw_topic == anomaly_topic:
            raise ConfigError("AI_CONFIG_INVALID", "raw and anomaly topics must be different")

        brokers = _brokers(source)
        bundle_text = _text(source, "AI_MODEL_BUNDLE_DIR")
        bundle_dir = Path(bundle_text).expanduser() if bundle_text else None
        if environment == "production" and bundle_dir is None:
            raise ConfigError("AI_MODEL_BUNDLE_NOT_CONFIGURED", "set AI_MODEL_BUNDLE_DIR")

        return cls(
            environment=environment,
            brokers=brokers,
            client_id=client_id,
            group_id=group_id,
            raw_topic=raw_topic,
            anomaly_topic=anomaly_topic,
            model_bundle_dir=bundle_dir,
            poll_timeout_ms=_positive_int(source, "AI_POLL_TIMEOUT_MS", 1000),
            publish_timeout_ms=_positive_int(source, "AI_PUBLISH_TIMEOUT_MS", 10000),
        )
