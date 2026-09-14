"""Optional kafka-python transport for the inference runtime.

The service depends on the small broker protocols in ``contracts.py``.  The
Kafka client is imported only when production transport is requested, so all
contract and fail-closed tests run without third-party packages or a broker.
"""

from __future__ import annotations

import asyncio
from typing import Any

from .config import RuntimeConfig
from .contracts import BrokerConsumer, BrokerMessage, BrokerProducer


class KafkaTransportError(RuntimeError):
    """Kafka client dependency or lifecycle failure."""


def _load_kafka() -> tuple[Any, Any, Any, Any]:
    try:
        from kafka import KafkaConsumer, KafkaProducer, TopicPartition  # type: ignore[import-not-found]
        from kafka.structs import OffsetAndMetadata  # type: ignore[import-not-found]
    except ImportError as exc:
        raise KafkaTransportError(
            "AI_KAFKA_CLIENT_UNAVAILABLE: install ai/requirements.txt before production startup",
        ) from exc
    return KafkaConsumer, KafkaProducer, TopicPartition, OffsetAndMetadata


class KafkaPythonConsumer(BrokerConsumer):
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._client: Any | None = None
        self._consumer_type: Any | None = None
        self._topic_partition_type: Any | None = None
        self._offset_type: Any | None = None

    async def connect(self) -> None:
        if self._client is not None:
            return
        consumer_type, _producer_type, topic_partition_type, offset_type = _load_kafka()
        self._consumer_type = consumer_type
        self._topic_partition_type = topic_partition_type
        self._offset_type = offset_type
        try:
            self._client = await asyncio.to_thread(
                consumer_type,
                bootstrap_servers=list(self._config.brokers),
                client_id=self._config.client_id,
                group_id=self._config.group_id,
                enable_auto_commit=False,
                auto_offset_reset="latest",
            )
        except Exception as exc:
            raise KafkaTransportError(f"AI_KAFKA_CONNECT_FAILED: {exc}") from exc

    async def subscribe(self, topic: str) -> None:
        if self._client is None:
            raise KafkaTransportError("AI_KAFKA_NOT_CONNECTED: consumer")
        if not topic.strip():
            raise KafkaTransportError("AI_KAFKA_TOPIC_INVALID: raw topic is empty")
        await asyncio.to_thread(self._client.subscribe, [topic])

    async def receive(self, timeout_ms: int) -> BrokerMessage | None:
        if self._client is None:
            raise KafkaTransportError("AI_KAFKA_NOT_CONNECTED: consumer")
        records = await asyncio.to_thread(self._client.poll, timeout_ms=timeout_ms, max_records=1)
        for record_batch in records.values():
            for record in record_batch:
                return BrokerMessage(
                    topic=str(record.topic),
                    partition=int(record.partition),
                    offset=str(record.offset),
                    value=record.value,
                )
        return None

    async def commit(self, topic: str, partition: int, offset: str) -> None:
        if self._client is None or self._topic_partition_type is None or self._offset_type is None:
            raise KafkaTransportError("AI_KAFKA_NOT_CONNECTED: consumer")
        if not offset.isdigit() or int(offset) < 0:
            raise KafkaTransportError("AI_KAFKA_OFFSET_INVALID: offset must be a non-negative integer")
        topic_partition = self._topic_partition_type(topic, partition)
        metadata = self._offset_type(int(offset), None)
        await asyncio.to_thread(self._client.commit, {topic_partition: metadata})

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await asyncio.to_thread(client.close)


class KafkaPythonProducer(BrokerProducer):
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._client: Any | None = None
        self._producer_type: Any | None = None

    async def connect(self) -> None:
        if self._client is not None:
            return
        _consumer_type, producer_type, _topic_partition_type, _offset_type = _load_kafka()
        self._producer_type = producer_type
        try:
            self._client = await asyncio.to_thread(
                producer_type,
                bootstrap_servers=list(self._config.brokers),
                client_id=f"{self._config.client_id}-producer",
                acks="all",
                retries=0,
            )
        except Exception as exc:
            raise KafkaTransportError(f"AI_KAFKA_PRODUCER_CONNECT_FAILED: {exc}") from exc

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        if self._client is None:
            raise KafkaTransportError("AI_KAFKA_NOT_CONNECTED: producer")
        if not topic.strip() or not key.strip():
            raise KafkaTransportError("AI_KAFKA_PUBLISH_INVALID: topic and device_id key are required")
        if not isinstance(value, bytes):
            raise KafkaTransportError("AI_KAFKA_PUBLISH_INVALID: anomaly payload must be bytes")

        def send_and_wait() -> None:
            future = self._client.send(topic, key=key.encode("utf-8"), value=value)
            future.get(timeout=self._config.publish_timeout_ms / 1000)

        await asyncio.to_thread(send_and_wait)

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await asyncio.to_thread(client.close)


def create_kafka_ports(config: RuntimeConfig) -> tuple[BrokerConsumer, BrokerProducer]:
    """Construct lazy Kafka ports; no network connection is made here."""

    return KafkaPythonConsumer(config), KafkaPythonProducer(config)
