"""CellGuard local inference boundary.

Only contracts, bundle validation, and transport lifecycle live here.  Trained
model implementations are external artifacts and are not shipped in this
repository.
"""

from .bundle import BundleLoadError, ModelBundle, load_model_bundle
from .config import ConfigError, RuntimeConfig
from .contracts import (
    ANOMALY_TOPIC,
    CONTRACT_VERSION,
    RAW_TOPIC,
    BrokerMessage,
    ContractError,
    InferenceOutput,
    RawMetricsFrame,
    build_anomaly_alert,
    parse_raw_metrics,
    validate_anomaly_alert,
)

__all__ = [
    "ANOMALY_TOPIC",
    "CONTRACT_VERSION",
    "RAW_TOPIC",
    "BrokerMessage",
    "BundleLoadError",
    "ConfigError",
    "ContractError",
    "InferenceOutput",
    "ModelBundle",
    "RawMetricsFrame",
    "RuntimeConfig",
    "build_anomaly_alert",
    "load_model_bundle",
    "parse_raw_metrics",
    "validate_anomaly_alert",
]
