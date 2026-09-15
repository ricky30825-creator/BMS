from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from edge.commands.config import EdgeConfig, EdgeConfigError


def values(path: Path, **overrides: str) -> dict[str, str]:
    result = {
        "EDGE_ENV": "production",
        "EDGE_KAFKA_BROKERS": "localhost:9092",
        "EDGE_HARDWARE_PROFILE": "COMBINED_EXISTING_PARTS_V1",
        "EDGE_IDEMPOTENCY_DB": str(path),
    }
    result.update(overrides)
    return result


class EdgeConfigTests(unittest.TestCase):
    def test_parses_explicit_profile_and_all_manual_gate_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parsed = EdgeConfig.from_env(values(
                root / "edge.sqlite",
                EDGE_SOURCE_GATE_FILE=str(root / "source.ok"),
                EDGE_CURRENT_GATE_FILE=str(root / "current.ok"),
                EDGE_OVF_GATE_FILE=str(root / "ovf.ok"),
            ))
            self.assertEqual(parsed.hardware_profile, "COMBINED_EXISTING_PARTS_V1")
            self.assertEqual(parsed.source_gate_file, root / "source.ok")
            self.assertEqual(parsed.current_gate_file, root / "current.ok")
            self.assertEqual(parsed.ovf_gate_file, root / "ovf.ok")

    def test_unknown_profile_fake_gpio_and_memory_store_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.sqlite"
            for key, value, error in (
                ("EDGE_HARDWARE_PROFILE", "UNKNOWN", "EDGE_HARDWARE_PROFILE_INVALID"),
                ("EDGE_GPIO_BACKEND", "fake", "EDGE_FAKE_GPIO_FORBIDDEN"),
            ):
                with self.assertRaisesRegex(EdgeConfigError, error):
                    EdgeConfig.from_env(values(path, **{key: value}))
            with self.assertRaisesRegex(EdgeConfigError, "EDGE_IDEMPOTENCY_DB_INVALID"):
                EdgeConfig.from_env(values(Path(":memory:")))

    def test_topic_broker_and_delay_settings_are_strict(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.sqlite"
            with self.assertRaisesRegex(EdgeConfigError, "EDGE_TOPIC_INVALID"):
                EdgeConfig.from_env(values(path, EDGE_KAFKA_TOPIC="other"))
            with self.assertRaisesRegex(EdgeConfigError, "EDGE_CONFIG_INVALID"):
                EdgeConfig.from_env(values(path, EDGE_KAFKA_BROKERS=""))
            with self.assertRaisesRegex(EdgeConfigError, "EDGE_CONFIG_INVALID"):
                EdgeConfig.from_env(values(path, EDGE_RETRY_DELAY_MS="0"))


if __name__ == "__main__":
    unittest.main()
