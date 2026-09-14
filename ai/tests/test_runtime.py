from __future__ import annotations

import asyncio
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ai.bundle import load_model_bundle
from ai.config import ConfigError, RuntimeConfig
from ai.contracts import BrokerMessage, InferenceOutput, validate_anomaly_alert
from ai.inference import InferenceAdapterError, create_production_adapter
from ai.runtime import InferenceProcessingError, InferenceService, main

from ai.tests.test_bundle import make_bundle
from ai.tests.test_contracts import mode1_frame


class FakeAdapter:
    def __init__(self, model_version: str, evaluated_at: str = "2026-09-15T00:00:00.200Z") -> None:
        self.model_version = model_version
        self.evaluated_at = evaluated_at
        self.calls = 0

    async def infer(self, frame):
        self.calls += 1
        return InferenceOutput(
            evaluated_at=self.evaluated_at,
            score=0.82,
            ae_score=0.79,
            informer_score=0.86,
            contributions=(("dT_dt", 0.41), ("V_drop", 0.18)),
            model_version=self.model_version,
            temp_kalman=None,
            temp_cell_estimated=None,
        )


class FakeConsumer:
    def __init__(self, *, fail_commit_once: bool = False) -> None:
        self.connected = False
        self.subscribed: list[str] = []
        self.commits: list[tuple[str, int, str]] = []
        self.fail_commit_once = fail_commit_once
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def subscribe(self, topic: str) -> None:
        self.subscribed.append(topic)

    async def receive(self, timeout_ms: int):
        return None

    async def commit(self, topic: str, partition: int, offset: str) -> None:
        if self.fail_commit_once:
            self.fail_commit_once = False
            raise RuntimeError("commit unavailable")
        self.commits.append((topic, partition, offset))

    async def close(self) -> None:
        self.closed = True
        self.connected = False


class FakeProducer:
    def __init__(self, *, fail_publish_once: bool = False) -> None:
        self.connected = False
        self.publishes: list[tuple[str, str, bytes]] = []
        self.fail_publish_once = fail_publish_once
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        if self.fail_publish_once:
            self.fail_publish_once = False
            raise RuntimeError("broker unavailable")
        self.publishes.append((topic, key, value))

    async def close(self) -> None:
        self.closed = True
        self.connected = False


def service_fixture(*, fail_publish_once: bool = False, fail_commit_once: bool = False):
    directory = tempfile.TemporaryDirectory()
    root = Path(directory.name)
    make_bundle(root)
    bundle = load_model_bundle(root)
    config = RuntimeConfig.from_env({"AI_ENV": "test"})
    adapter = FakeAdapter(bundle.model_version)
    consumer = FakeConsumer(fail_commit_once=fail_commit_once)
    producer = FakeProducer(fail_publish_once=fail_publish_once)
    service = InferenceService(config, bundle, adapter, consumer, producer)
    return directory, service, adapter, consumer, producer


def raw_message(offset: str = "7") -> BrokerMessage:
    return BrokerMessage(
        topic="battery-raw-metrics",
        partition=2,
        offset=offset,
        value=json.dumps(mode1_frame()).encode("utf-8"),
    )


class RuntimeTests(unittest.TestCase):
    def test_raw_to_injected_adapter_to_anomaly_roundtrip(self) -> None:
        directory, service, adapter, consumer, producer = service_fixture()
        with directory:
            result = asyncio.run(service.process_message(raw_message()))
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(consumer.commits, [("battery-raw-metrics", 2, "8")])
        self.assertEqual(len(producer.publishes), 1)
        topic, key, payload = producer.publishes[0]
        self.assertEqual((topic, key), ("battery-anomaly-alerts", "rpi5-01"))
        anomaly = json.loads(payload.decode("utf-8"))
        validate_anomaly_alert(anomaly)
        self.assertEqual(anomaly["score"], 0.82)
        self.assertEqual(result.committed_offset, "8")
        self.assertNotIn("battery_id", anomaly)
        self.assertNotIn("session_id", anomaly)

    def test_publish_failure_does_not_commit_and_retry_reuses_result(self) -> None:
        directory, service, adapter, consumer, producer = service_fixture(fail_publish_once=True)
        with directory:
            with self.assertRaisesRegex(RuntimeError, "broker unavailable"):
                asyncio.run(service.process_message(raw_message()))
            asyncio.run(service.process_message(raw_message()))
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(consumer.commits, [("battery-raw-metrics", 2, "8")])
        self.assertEqual(len(producer.publishes), 1)

    def test_commit_failure_does_not_ack_and_retry_reuses_serialized_payload(self) -> None:
        directory, service, adapter, consumer, producer = service_fixture(fail_commit_once=True)
        with directory:
            with self.assertRaisesRegex(RuntimeError, "commit unavailable"):
                asyncio.run(service.process_message(raw_message()))
            asyncio.run(service.process_message(raw_message()))
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(consumer.commits, [("battery-raw-metrics", 2, "8")])
        self.assertEqual(len(producer.publishes), 2)
        self.assertEqual(producer.publishes[0][2], producer.publishes[1][2])

    def test_restart_replay_uses_raw_timestamp_with_a_new_adapter(self) -> None:
        directory = tempfile.TemporaryDirectory()
        with directory:
            root = Path(directory.name)
            make_bundle(root)
            bundle = load_model_bundle(root)
            config = RuntimeConfig.from_env({"AI_ENV": "test"})

            first_adapter = FakeAdapter(bundle.model_version, "2026-09-15T00:00:00.200Z")
            first_consumer = FakeConsumer(fail_commit_once=True)
            first_producer = FakeProducer()
            first_service = InferenceService(config, bundle, first_adapter, first_consumer, first_producer)
            with self.assertRaisesRegex(RuntimeError, "commit unavailable"):
                asyncio.run(first_service.process_message(raw_message()))

            # A restart creates a new service and adapter, so no in-memory
            # pending payload is available.  The adapter's wall-clock result
            # intentionally differs to model the original replay defect.
            second_adapter = FakeAdapter(bundle.model_version, "2026-09-15T00:00:00.999Z")
            second_consumer = FakeConsumer()
            second_producer = FakeProducer()
            second_service = InferenceService(config, bundle, second_adapter, second_consumer, second_producer)
            asyncio.run(second_service.process_message(raw_message()))

        first_topic, first_key, first_payload = first_producer.publishes[0]
        second_topic, second_key, second_payload = second_producer.publishes[0]
        self.assertEqual((first_topic, first_key), (second_topic, second_key))
        self.assertEqual(first_payload, second_payload)
        anomaly = json.loads(second_payload.decode("utf-8"))
        self.assertEqual(anomaly["evaluated_at"], mode1_frame()["timestamp"])
        self.assertEqual(first_adapter.calls, 1)
        self.assertEqual(second_adapter.calls, 1)

    def test_invalid_input_has_no_publish_or_commit(self) -> None:
        directory, service, adapter, consumer, producer = service_fixture()
        invalid = BrokerMessage("battery-raw-metrics", 0, "1", b"not-json")
        with directory:
            with self.assertRaisesRegex(InferenceProcessingError, "AI_INPUT_INVALID"):
                asyncio.run(service.process_message(invalid))
        self.assertEqual(adapter.calls, 0)
        self.assertEqual(producer.publishes, [])
        self.assertEqual(consumer.commits, [])

    def test_lifecycle_connects_subscribes_and_closes_both_ports(self) -> None:
        directory, service, _adapter, consumer, producer = service_fixture()
        with directory:
            asyncio.run(service.start())
            asyncio.run(service.start())
            asyncio.run(service.stop())
            asyncio.run(service.stop())
        self.assertEqual(consumer.subscribed, ["battery-raw-metrics"])
        self.assertTrue(consumer.closed)
        self.assertTrue(producer.closed)

    def test_production_entrypoint_without_bundle_exits_before_kafka(self) -> None:
        stderr = io.StringIO()
        with patch.dict(os.environ, {
            "AI_ENV": "production",
            "AI_KAFKA_BROKERS": "127.0.0.1:9092",
        }, clear=True), contextlib.redirect_stderr(stderr):
            exit_code = main()
        self.assertEqual(exit_code, 1)
        self.assertIn("AI_MODEL_BUNDLE_NOT_CONFIGURED", stderr.getvalue())

    def test_bundle_without_installed_external_adapter_still_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_bundle(root)
            bundle = load_model_bundle(root)
            with self.assertRaisesRegex(InferenceAdapterError, "AI_INFERENCE_ADAPTER_UNAVAILABLE"):
                create_production_adapter(bundle)


class ConfigTests(unittest.TestCase):
    def test_fake_selection_is_rejected_even_in_test_environment(self) -> None:
        with self.assertRaisesRegex(ConfigError, "AI_FAKE_ADAPTER_FORBIDDEN"):
            RuntimeConfig.from_env({"AI_ENV": "test", "AI_MODEL_BACKEND": "fake"})

    def test_production_requires_bundle_directory(self) -> None:
        with self.assertRaisesRegex(ConfigError, "AI_MODEL_BUNDLE_NOT_CONFIGURED"):
            RuntimeConfig.from_env({"AI_ENV": "production"})


if __name__ == "__main__":
    unittest.main()
