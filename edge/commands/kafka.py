"""Optional ``kafka-python`` transport for the edge command consumer."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .config import EdgeConfig
from .contracts import COMMAND_TOPIC


class KafkaTransportError(RuntimeError):
    """Kafka dependency or lifecycle failure."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class KafkaCommandRecord:
    topic: str
    partition: int
    offset: int
    key: bytes | str | None
    value: bytes | str | None
    headers: object


class CommandConsumerPort(Protocol):
    async def connect(self) -> None: ...

    async def subscribe(self, topic: str) -> None: ...

    async def receive(self, timeout_ms: int) -> KafkaCommandRecord | None: ...

    async def commit(self, topic: str, partition: int, offset: int) -> None: ...

    async def close(self) -> None: ...


def _load_kafka() -> tuple[Any, Any, Any, Any]:
    try:
        from kafka import KafkaConsumer, TopicPartition  # type: ignore[import-not-found]
        from kafka.structs import OffsetAndMetadata  # type: ignore[import-not-found]
    except ImportError as exc:
        raise KafkaTransportError(
            "EDGE_KAFKA_CLIENT_UNAVAILABLE",
            "install kafka-python before production edge startup",
        ) from exc
    return KafkaConsumer, TopicPartition, OffsetAndMetadata, None


class KafkaPythonCommandConsumer(CommandConsumerPort):
    """Manual-commit Kafka consumer; construction performs no network I/O."""

    def __init__(self, config: EdgeConfig) -> None:
        self._config = config
        self._client: Any | None = None
        self._topic_partition_type: Any | None = None
        self._offset_type: Any | None = None

    async def connect(self) -> None:
        if self._client is not None:
            return
        consumer_type, topic_partition_type, offset_type, _unused = _load_kafka()
        self._topic_partition_type = topic_partition_type
        self._offset_type = offset_type
        try:
            self._client = await asyncio.to_thread(
                consumer_type,
                bootstrap_servers=list(self._config.brokers),
                client_id=self._config.client_id,
                group_id=self._config.group_id,
                enable_auto_commit=False,
                auto_offset_reset="earliest",
                key_deserializer=None,
                value_deserializer=None,
            )
        except Exception as exc:
            raise KafkaTransportError("EDGE_KAFKA_CONNECT_FAILED", str(exc)) from exc

    async def subscribe(self, topic: str) -> None:
        if self._client is None:
            raise KafkaTransportError("EDGE_KAFKA_NOT_CONNECTED", "consumer")
        if topic != COMMAND_TOPIC:
            raise KafkaTransportError("EDGE_KAFKA_TOPIC_INVALID", "edge consumer must subscribe to battery-events")
        try:
            await asyncio.to_thread(self._client.subscribe, [topic])
        except Exception as exc:
            raise KafkaTransportError("EDGE_KAFKA_SUBSCRIBE_FAILED", str(exc)) from exc

    async def receive(self, timeout_ms: int) -> KafkaCommandRecord | None:
        if self._client is None:
            raise KafkaTransportError("EDGE_KAFKA_NOT_CONNECTED", "consumer")
        try:
            records = await asyncio.to_thread(self._client.poll, timeout_ms=timeout_ms, max_records=1)
        except Exception as exc:
            raise KafkaTransportError("EDGE_KAFKA_POLL_FAILED", str(exc)) from exc
        for batch in records.values():
            for record in batch:
                return KafkaCommandRecord(
                    topic=str(record.topic),
                    partition=int(record.partition),
                    offset=int(record.offset),
                    key=record.key,
                    value=record.value,
                    headers=list(record.headers or []),
                )
        return None

    async def commit(self, topic: str, partition: int, offset: int) -> None:
        if self._client is None or self._topic_partition_type is None or self._offset_type is None:
            raise KafkaTransportError("EDGE_KAFKA_NOT_CONNECTED", "consumer")
        if topic != COMMAND_TOPIC or partition < 0 or offset < 0:
            raise KafkaTransportError("EDGE_KAFKA_OFFSET_INVALID", "topic, partition, and offset are invalid")
        try:
            topic_partition = self._topic_partition_type(topic, partition)
            metadata = self._offset_type(offset, None)
            # Kafka commits the next offset, and the service calls this only
            # after physical success + durable idempotency completion.
            await asyncio.to_thread(self._client.commit, {topic_partition: metadata})
        except KafkaTransportError:
            raise
        except Exception as exc:
            raise KafkaTransportError("EDGE_KAFKA_COMMIT_FAILED", str(exc)) from exc

    async def close(self) -> None:
        if self._client is None:
            return
        client, self._client = self._client, None
        try:
            await asyncio.to_thread(client.close)
        except Exception as exc:
            raise KafkaTransportError("EDGE_KAFKA_CLOSE_FAILED", str(exc)) from exc


def create_kafka_command_consumer(config: EdgeConfig) -> CommandConsumerPort:
    """Construct the real transport without connecting to a broker."""

    return KafkaPythonCommandConsumer(config)
