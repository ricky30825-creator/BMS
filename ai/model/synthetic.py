"""Physically constrained proxy anomalies (evaluation only, never training).

Scenarios follow the thermal-runaway precursor summary used in the design
document: gradual temperature acceleration, voltage sag under load, a
deviation that appears only in the forecast horizon, their coupling, and
current instability. Severity levels are designer-set injection rates, not
reconstructed measurements. Power is always recomputed as V x I.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .features import CONTEXT, HISTORY
from .preprocess import FEATURES

SCENARIOS = ["thermal_acceleration", "voltage_sag", "future_voltage_deviation",
             "coupled_thermal_voltage", "electrical_instability"]
SEVERITIES = ["weak", "medium", "critical"]


@dataclass(frozen=True)
class InjectionConfig:
    temp_rate_start: float
    temp_rate_end: float
    voltage_rate_start: float
    voltage_rate_end: float
    current_amplitude: float


CONFIGS = {
    "weak": InjectionConfig(0.005, 0.020, 0.0003, 0.0010, 0.05),
    "medium": InjectionConfig(0.020, 0.080, 0.0010, 0.0040, 0.20),
    "critical": InjectionConfig(0.200, 1.000, 0.0030, 0.0150, 0.60),
}


def cumulative_ramp(length: int, start_rate: float, end_rate: float) -> np.ndarray:
    if length <= 0:
        return np.empty(0, dtype=np.float32)
    return np.cumsum(np.linspace(start_rate, end_rate, length, dtype=np.float32))


def inject_case(history: np.ndarray, future: np.ndarray, scenario: str, severity: str):
    config = CONFIGS[severity]
    joined = np.concatenate([history.copy(), future.copy()], axis=0)
    history_len, total_len = len(history), len(history) + len(future)
    voltage, current, power = (FEATURES.index(n) for n in ["voltage_v", "current_discharge_a", "power_discharge_w"])
    temperatures = [FEATURES.index(n) for n in ["cell_temp_c", "ir_a_temp_c", "ir_b_temp_c"]]
    onsets: dict[str, int | None] = dict(temperature=None, voltage=None, current=None)

    def add_temperature(onset: int) -> None:
        onsets["temperature"] = onset
        rise = cumulative_ramp(total_len - onset, config.temp_rate_start, config.temp_rate_end)
        for feature, gain in zip(temperatures, [0.75, 0.90, 1.00]):
            joined[onset:, feature] += rise * gain

    def add_voltage_sag(onset: int) -> None:
        onsets["voltage"] = onset
        sag = cumulative_ramp(total_len - onset, config.voltage_rate_start, config.voltage_rate_end)
        joined[onset:, voltage] = np.maximum(joined[onset:, voltage] - sag, 0.1)

    def add_current_instability(onset: int) -> None:
        onsets["current"] = onset
        length = total_len - onset
        phase = np.linspace(0, 8 * np.pi, length, dtype=np.float32)
        envelope = np.linspace(0.25, 1.0, length, dtype=np.float32)
        joined[onset:, current] = np.maximum(joined[onset:, current] + config.current_amplitude * envelope * np.sin(phase), 0.0)

    if scenario == "thermal_acceleration":
        add_temperature(max(0, history_len - 48))
    elif scenario == "voltage_sag":
        add_voltage_sag(max(0, history_len - 32))
    elif scenario == "future_voltage_deviation":
        add_voltage_sag(history_len + 4)
    elif scenario == "coupled_thermal_voltage":
        add_temperature(max(0, history_len - 48))
        add_voltage_sag(history_len + 8)
    elif scenario == "electrical_instability":
        add_current_instability(max(0, history_len - 24))
        if severity != "weak":
            add_voltage_sag(history_len)
    else:
        raise ValueError(f"Unknown scenario: {scenario}")

    joined[:, power] = joined[:, voltage] * joined[:, current]
    starts = [v for v in onsets.values() if v is not None]
    meta = dict(scenario=scenario, severity=severity, anomaly_start_step=int(min(starts)),
                temperature_start_step=onsets["temperature"], voltage_start_step=onsets["voltage"],
                current_start_step=onsets["current"])
    return joined[:history_len], joined[history_len:], meta


def generate(raw: np.ndarray, runs: np.ndarray, starts: np.ndarray, seed: int,
             per_run: int = 16, forbidden: np.ndarray | None = None):
    """Inject every scenario x severity into ``per_run`` source windows per run.

    ``forbidden`` excludes source windows already used by another suite so the
    development and confirmation suites never share a source window.
    """
    rng = np.random.default_rng(seed)
    chosen = []
    for run in np.unique(runs):
        pool = np.flatnonzero(runs == run)
        if forbidden is not None:
            pool = np.setdiff1d(pool, forbidden)
        chosen.extend(rng.choice(pool, size=min(per_run, len(pool)), replace=False).tolist())
    altered, records = [], []
    for scenario in SCENARIOS:
        for severity in SEVERITIES:
            for index in chosen:
                sample = raw[index].copy()
                h, f, meta = inject_case(sample[CONTEXT : CONTEXT + HISTORY], sample[CONTEXT + HISTORY :], scenario, severity)
                sample[CONTEXT:] = np.concatenate([h, f])
                altered.append(sample)
                records.append(dict(source_index=index, run=runs[index], start=int(starts[index]),
                                    scenario=scenario, severity=severity, anomaly_start=meta["anomaly_start_step"]))
    return np.array(altered), pd.DataFrame(records), np.array(chosen)
