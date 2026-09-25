from __future__ import annotations

import unittest

from ai.contracts import (
    ContractError,
    InferenceOutput,
    build_anomaly_alert,
    parse_inference_output,
    parse_raw_metrics,
    validate_anomaly_alert,
)


def mode1_frame() -> dict[str, object]:
    return {
        "version": 1,
        "device_id": "rpi5-01",
        "mode": 1,
        "timestamp": "2026-09-15T00:00:00.100Z",
        "voltage_v": 3.82,
        "current_a": -1.25,
        "power_w": -4.78,
        "soc_pct": 81,
        "temp_contact": 36.8,
        "temp_ir_surface": 38.1,
        "temp_points": {"contact": [34.1, 36.8, 35.2], "ir": [38.1, 35.9]},
        "gas_raw": None,
        "pressure_raw": 420,
        "acoustic_raw": None,
        "age_ms": {"soc_pct": 640, "temp_contact": 310, "temp_ir_surface": 40},
    }


def mode2_frame() -> dict[str, object]:
    return {
        "version": 1,
        "device_id": "rpi5-02",
        "mode": 2,
        "timestamp": "2026-09-15T00:00:00.100Z",
        "voltage_v": 5.02,
        "current_a": -1.50,
        "power_w": -7.53,
        "soc_pct": None,
        "temp_contact": None,
        "temp_ir_surface": 38.1,
        "temp_points": {"contact": None, "ir": [38.1, 35.9]},
        "gas_raw": 812,
        "pressure_raw": None,
        "acoustic_raw": None,
        "age_ms": {"temp_ir_surface": 40},
        "diag_phase": "P3",
        "load_target_a": 1.5,
    }


class WireContractTests(unittest.TestCase):
    def test_parses_both_hardware_modes_without_fabricating_fields(self) -> None:
        first = parse_raw_metrics(mode1_frame())
        second = parse_raw_metrics(mode2_frame())
        self.assertEqual(first.device_id, "rpi5-01")
        self.assertEqual(first.temp_points_contact, (34.1, 36.8, 35.2))
        self.assertEqual(second.temp_points_contact, None)
        self.assertIsNone(second.temp_contact)
        self.assertIsNone(second.pressure_raw)
        self.assertEqual(second.gas_raw, 812)
        self.assertEqual(second.to_payload()["temp_points"]["contact"], None)  # type: ignore[index]

    def test_rejects_mode_sensor_substitution_and_peak_mismatch(self) -> None:
        invalid_mode = mode1_frame()
        invalid_mode["gas_raw"] = 1
        with self.assertRaisesRegex(ContractError, "mode 1 does not have a gas sensor"):
            parse_raw_metrics(invalid_mode)

        invalid_peak = mode1_frame()
        invalid_peak["temp_contact"] = 39.0
        with self.assertRaisesRegex(ContractError, "maximum non-null"):
            parse_raw_metrics(invalid_peak)

        invalid_contact = mode2_frame()
        invalid_contact["temp_contact"] = 36.0
        with self.assertRaisesRegex(ContractError, "temp_contact must be null"):
            parse_raw_metrics(invalid_contact)

    def test_ambient_temperature_is_optional_and_outside_the_peak_invariant(self) -> None:
        # Absent key is still a valid v1 frame (edges that predate temp_ambient).
        self.assertIsNone(parse_raw_metrics(mode1_frame()).temp_ambient)

        for frame in (mode1_frame(), mode2_frame()):
            frame["temp_ambient"] = 24.5
            parsed = parse_raw_metrics(frame)
            self.assertEqual(parsed.temp_ambient, 24.5)
            self.assertEqual(parsed.to_payload()["temp_ambient"], 24.5)

        # Ambient is not a cell-surface point: it never changes the surface peak.
        hotter_room = mode1_frame()
        hotter_room["temp_ambient"] = 99.0
        self.assertEqual(parse_raw_metrics(hotter_room).temp_ir_surface, 38.1)

        nested = mode1_frame()
        nested["temp_points"] = {"contact": [34.1, 36.8, 35.2], "ir": [38.1, 35.9], "ambient": 24.5}
        with self.assertRaisesRegex(ContractError, "unknown fields: ambient"):
            parse_raw_metrics(nested)

        wrong_type = mode1_frame()
        wrong_type["temp_ambient"] = "24.5"
        with self.assertRaises(ContractError):
            parse_raw_metrics(wrong_type)

    def test_rejects_unknown_fields_and_non_utc_timestamps(self) -> None:
        unknown = mode1_frame()
        unknown["battery_id"] = "must-not-cross-wire"
        with self.assertRaisesRegex(ContractError, "unknown fields: battery_id"):
            parse_raw_metrics(unknown)

        non_utc = mode1_frame()
        non_utc["timestamp"] = "2026-09-15T00:00:00.100+09:00"
        with self.assertRaisesRegex(ContractError, "Z suffix"):
            parse_raw_metrics(non_utc)

    def test_anomaly_payload_is_v1_and_contains_only_device_identity(self) -> None:
        frame = parse_raw_metrics(mode1_frame())
        output = InferenceOutput(
            evaluated_at="2026-09-15T00:00:00.200Z",
            score=0.82,
            ae_score=0.79,
            informer_score=0.86,
            contributions=(("dT_dt", 0.41), ("V_drop", 0.18)),
            model_version="ae-1+informer-1",
            temp_kalman=None,
            temp_cell_estimated=None,
        )
        payload = build_anomaly_alert(frame, output, expected_model_version="ae-1+informer-1")
        validate_anomaly_alert(payload)
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["device_id"], "rpi5-01")
        self.assertEqual(payload["evaluated_at"], mode1_frame()["timestamp"])
        self.assertNotIn("battery_id", payload)
        self.assertNotIn("session_id", payload)

    def test_missing_dual_model_score_and_negative_contribution_are_rejected(self) -> None:
        frame = parse_raw_metrics(mode1_frame())
        output = InferenceOutput(
            evaluated_at="2026-09-15T00:00:00.200Z",
            score=0.82,
            ae_score=None,
            informer_score=0.86,
            contributions=None,
            model_version="ae-1+informer-1",
            temp_kalman=None,
            temp_cell_estimated=None,
        )
        with self.assertRaisesRegex(ContractError, "both ae_score"):
            build_anomaly_alert(frame, output, expected_model_version="ae-1+informer-1")

        invalid_output = {
            "evaluated_at": "2026-09-15T00:00:00.200Z",
            "score": 0.82,
            "ae_score": 0.79,
            "informer_score": 0.86,
            "contributions": [{"feature": "dT_dt", "contribution": -0.1}],
            "model_version": "ae-1+informer-1",
            "temp_kalman": None,
            "temp_cell_estimated": None,
        }
        with self.assertRaisesRegex(ContractError, "non-negative"):
            parse_inference_output(invalid_output)

        invalid = mode1_frame()
        invalid["acoustic_raw"] = 3
        with self.assertRaisesRegex(ContractError, "acoustic_raw"):
            parse_raw_metrics(invalid)

        invalid_adapter_timestamp = InferenceOutput(
            evaluated_at="not-a-timestamp",
            score=0.82,
            ae_score=0.79,
            informer_score=0.86,
            contributions=None,
            model_version="ae-1+informer-1",
            temp_kalman=None,
            temp_cell_estimated=None,
        )
        with self.assertRaisesRegex(ContractError, "AI_INFERENCE_OUTPUT_INVALID"):
            build_anomaly_alert(
                parse_raw_metrics(mode1_frame()),
                invalid_adapter_timestamp,
                expected_model_version="ae-1+informer-1",
            )


if __name__ == "__main__":
    unittest.main()
