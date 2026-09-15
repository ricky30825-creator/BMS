from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from edge.commands.config import EdgeConfig
from edge.commands.consumer import CommandConsumerService, EdgeProcessingError
from edge.commands.idempotency import SQLiteIdempotencyStore
from edge.commands.kafka import KafkaCommandRecord
from edge.commands.testing import FakeRelayAdapter


def config(path: Path) -> EdgeConfig:
    return EdgeConfig(
        environment="test",
        brokers=("localhost:9092",),
        client_id="test-edge",
        group_id="test-edge",
        topic="battery-events",
        idempotency_db=path,
        hardware_profile="MODE1_EXTERNAL_CELL_V1",
        source_gate_file=None,
        poll_timeout_ms=10,
        retry_delay_ms=1,
    )


def record(
    event_id: str | None,
    offset: int,
    payload: dict[str, object] | None = None,
    *,
    key: str = "PACK-001",
) -> KafkaCommandRecord:
    value = payload or {
        "version": 1,
        "code": "RELAY_CUT",
        "params": {"batteryId": "PACK-001", "reasonCode": "USER"},
    }
    headers = [] if event_id is None else [("x-cellguard-event-id", event_id.encode("utf-8"))]
    return KafkaCommandRecord("battery-events", 0, offset, key, json.dumps(value), headers)


class FakeConsumer:
    def __init__(self, *, fail_commit_once: bool = False) -> None:
        self.commits: list[tuple[str, int, int]] = []
        self.fail_commit_once = fail_commit_once
        self.connected = False
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def subscribe(self, topic: str) -> None:
        self.topic = topic

    async def receive(self, timeout_ms: int) -> KafkaCommandRecord | None:
        return None

    async def commit(self, topic: str, partition: int, offset: int) -> None:
        if self.fail_commit_once:
            self.fail_commit_once = False
            raise RuntimeError("broker unavailable")
        self.commits.append((topic, partition, offset))

    async def close(self) -> None:
        self.closed = True


class CommandConsumerTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_is_durable_before_offset_commit_and_duplicate_cut_is_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            consumer = FakeConsumer()
            relay = FakeRelayAdapter()
            service = CommandConsumerService(config(store.path), consumer, relay, store)
            first = await service.process_message(record("evt-1", 0))
            duplicate = await service.process_message(record("evt-1", 1))
            self.assertFalse(first.duplicate)
            self.assertTrue(duplicate.duplicate)
            self.assertEqual([call[0] for call in relay.calls], ["RELAY_CUT"])
            self.assertEqual(consumer.commits, [("battery-events", 0, 1), ("battery-events", 0, 2)])
            self.assertEqual(store.successful_event_count(), 1)
            store.close()

    async def test_failed_execution_is_never_successful_or_committed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            consumer = FakeConsumer()
            relay = FakeRelayAdapter(fail_code="RELAY_CUT")
            service = CommandConsumerService(config(store.path), consumer, relay, store)
            with self.assertRaisesRegex(EdgeProcessingError, "EDGE_COMMAND_EXECUTION_FAILED"):
                await service.process_message(record("evt-fail", 0))
            self.assertEqual(consumer.commits, [])
            self.assertEqual(store.successful_event_count(), 0)
            with self.assertRaisesRegex(EdgeProcessingError, "EDGE_EVENT_IN_FLIGHT"):
                await service.process_message(record("evt-fail", 0))
            store.close()

    async def test_commit_failure_leaves_durable_success_and_retry_does_not_touch_relay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            consumer = FakeConsumer(fail_commit_once=True)
            relay = FakeRelayAdapter()
            service = CommandConsumerService(config(store.path), consumer, relay, store)
            with self.assertRaisesRegex(EdgeProcessingError, "EDGE_KAFKA_COMMIT_FAILED"):
                await service.process_message(record("evt-commit", 0))
            self.assertEqual(store.successful_event_count(), 1)
            retry = await service.process_message(record("evt-commit", 0))
            self.assertTrue(retry.duplicate)
            self.assertEqual([call[0] for call in relay.calls], ["RELAY_CUT"])
            self.assertEqual(consumer.commits, [("battery-events", 0, 1)])
            store.close()

    async def test_invalid_or_out_of_order_records_are_not_acknowledged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            consumer = FakeConsumer()
            relay = FakeRelayAdapter()
            service = CommandConsumerService(config(store.path), consumer, relay, store)
            with self.assertRaisesRegex(EdgeProcessingError, "EDGE_EVENT_ID_REQUIRED"):
                await service.process_message(record(None, 0))
            await service.process_message(record("evt-order", 5))
            with self.assertRaisesRegex(EdgeProcessingError, "EDGE_COMMAND_ORDER_INVALID"):
                await service.process_message(record("evt-old", 4))
            self.assertEqual(consumer.commits, [("battery-events", 0, 6)])
            store.close()

    async def test_successful_identity_is_recovered_after_process_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.sqlite"
            first_store = SQLiteIdempotencyStore(path)
            first_consumer = FakeConsumer()
            first_relay = FakeRelayAdapter()
            first = CommandConsumerService(config(path), first_consumer, first_relay, first_store)
            await first.process_message(record("evt-restart", 0))
            first_store.close()

            restarted_store = SQLiteIdempotencyStore(path)
            restarted_consumer = FakeConsumer()
            restarted_relay = FakeRelayAdapter()
            restarted = CommandConsumerService(config(path), restarted_consumer, restarted_relay, restarted_store)
            result = await restarted.process_message(record("evt-restart", 1))
            self.assertTrue(result.duplicate)
            self.assertEqual(restarted_relay.calls, [])
            self.assertEqual(restarted_consumer.commits, [("battery-events", 0, 2)])
            restarted_store.close()


if __name__ == "__main__":
    unittest.main()
