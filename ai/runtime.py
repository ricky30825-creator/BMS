"""Executable local raw-to-anomaly inference service.

Startup is ordered as configuration -> bundle validation -> adapter creation ->
Kafka connection.  Thus missing artifacts or a missing external model
implementation fail before the process can consume or publish anything.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from .bundle import BundleLoadError, ModelBundle, load_model_bundle
from .config import ConfigError, RuntimeConfig
from .contracts import (
    BrokerConsumer,
    BrokerMessage,
    BrokerProducer,
    ContractError,
    InferenceAdapter,
    InferenceOutput,
    build_anomaly_alert,
    parse_raw_metrics,
    parse_inference_output,
    validate_anomaly_alert,
)
from .inference import InferenceAdapterError, create_production_adapter
from .kafka import KafkaTransportError, create_kafka_ports


class InferenceProcessingError(RuntimeError):
    """A message could not be processed and therefore remains uncommitted."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class ProcessResult:
    device_id: str
    input_topic: str
    input_partition: int
    input_offset: str
    output_topic: str
    output_key: str
    output_payload: bytes
    committed_offset: str


Logger = Callable[[str, Mapping[str, object]], None]


def _default_logger(message: str, details: Mapping[str, object]) -> None:
    print(f"[ai-inference] {message} {dict(details)}", file=sys.stderr)


def _next_offset(offset: str) -> str:
    if not offset.isdigit() or int(offset) < 0:
        raise InferenceProcessingError("AI_KAFKA_OFFSET_INVALID", "offset must be a non-negative integer")
    return str(int(offset) + 1)


def _json_payload(value: bytes | str | None) -> object:
    if value is None:
        raise InferenceProcessingError("AI_INPUT_INVALID", "Kafka message has no value")
    try:
        text = value.decode("utf-8") if isinstance(value, bytes) else value
        return json.loads(text)
    except (UnicodeDecodeError, TypeError, json.JSONDecodeError) as exc:
        raise InferenceProcessingError("AI_INPUT_INVALID", "raw Kafka message is not valid UTF-8 JSON") from exc


class InferenceService:
    """Manage one consumer, one adapter, and one anomaly producer."""

    def __init__(
        self,
        config: RuntimeConfig,
        bundle: ModelBundle,
        adapter: InferenceAdapter,
        consumer: BrokerConsumer,
        producer: BrokerProducer,
        *,
        logger: Logger | None = None,
        max_pending_retries: int = 1024,
    ) -> None:
        if max_pending_retries <= 0:
            raise ValueError("max_pending_retries must be positive")
        self.config = config
        self.bundle = bundle
        self.adapter = adapter
        self.consumer = consumer
        self.producer = producer
        self.logger = logger or _default_logger
        self.max_pending_retries = max_pending_retries
        self._pending: dict[str, bytes] = {}
        self._consumer_connected = False
        self._producer_connected = False
        self._started = False
        self._stopping = False

    async def start(self) -> None:
        if self._started:
            return
        try:
            await self.consumer.connect()
            self._consumer_connected = True
            await self.producer.connect()
            self._producer_connected = True
            await self.consumer.subscribe(self.config.raw_topic)
            self._started = True
            self._stopping = False
        except Exception:
            await self.stop()
            raise

    async def stop(self) -> None:
        self._stopping = True
        close_errors: list[BaseException] = []
        if self._consumer_connected:
            try:
                await self.consumer.close()
            except BaseException as exc:  # preserve the first lifecycle failure below
                close_errors.append(exc)
            finally:
                self._consumer_connected = False
        if self._producer_connected:
            try:
                await self.producer.close()
            except BaseException as exc:
                close_errors.append(exc)
            finally:
                self._producer_connected = False
        self._started = False
        if close_errors:
            raise close_errors[0]

    async def _adapter_output(self, frame: Any) -> InferenceOutput:
        result = self.adapter.infer(frame)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, InferenceOutput):
            return result
        try:
            return parse_inference_output(result)
        except ContractError as exc:
            raise InferenceProcessingError(exc.code, str(exc)) from exc

    async def process_message(self, message: BrokerMessage) -> ProcessResult:
        """Publish and then commit one raw message.

        No path calls ``commit`` before the validated raw frame has gone through
        the adapter and the producer has acknowledged the anomaly record.  A
        failed publish or commit retains the serialized result by input
        partition/offset so a retry does not run a wall-clock adapter twice.
        """

        if message.topic != self.config.raw_topic:
            raise InferenceProcessingError("AI_INPUT_TOPIC_INVALID", f"expected {self.config.raw_topic!r}, got {message.topic!r}")
        pending_key = f"{message.topic}:{message.partition}:{message.offset}"
        next_offset = _next_offset(message.offset)

        cached_payload = self._pending.get(pending_key)
        if cached_payload is None:
            frame = parse_raw_metrics(_json_payload(message.value))
            output = await self._adapter_output(frame)
            try:
                anomaly = build_anomaly_alert(
                    frame,
                    output,
                    expected_model_version=self.bundle.model_version,
                )
                validate_anomaly_alert(anomaly)
            except ContractError as exc:
                raise InferenceProcessingError(exc.code, str(exc)) from exc
            cached_payload = json.dumps(
                anomaly,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            if len(self._pending) >= self.max_pending_retries:
                raise InferenceProcessingError("AI_PENDING_RETRY_BUFFER_FULL", "publish or commit retries must be resolved")
            self._pending[pending_key] = cached_payload
            device_id = frame.device_id
        else:
            # A cached payload was already validated before the first publish.
            # The key is not decoded again, so retry cannot accidentally change
            # the device key or model output.
            try:
                cached_object = json.loads(cached_payload.decode("utf-8"))
                device_id = str(cached_object["device_id"])
            except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
                raise InferenceProcessingError("AI_PENDING_RETRY_CORRUPT", "cached anomaly payload is invalid") from exc

        await self.producer.publish(self.config.anomaly_topic, device_id, cached_payload)
        await self.consumer.commit(message.topic, message.partition, next_offset)
        self._pending.pop(pending_key, None)
        return ProcessResult(
            device_id=device_id,
            input_topic=message.topic,
            input_partition=message.partition,
            input_offset=message.offset,
            output_topic=self.config.anomaly_topic,
            output_key=device_id,
            output_payload=cached_payload,
            committed_offset=next_offset,
        )

    async def run_forever(self) -> None:
        await self.start()
        try:
            while not self._stopping:
                message = await self.consumer.receive(self.config.poll_timeout_ms)
                if message is None:
                    continue
                try:
                    await self.process_message(message)
                except Exception as exc:
                    self.logger("message processing failed; offset remains uncommitted", {
                        "topic": message.topic,
                        "partition": message.partition,
                        "offset": message.offset,
                        "error": str(exc),
                    })
                    raise
        finally:
            await self.stop()


def build_service(
    config: RuntimeConfig,
    bundle: ModelBundle,
    adapter: InferenceAdapter,
    consumer: BrokerConsumer,
    producer: BrokerProducer,
) -> InferenceService:
    """Dependency-injection entry point used by tests and future adapters."""

    return InferenceService(config, bundle, adapter, consumer, producer)


def create_production_service(config: RuntimeConfig | None = None) -> InferenceService:
    """Build the production service; no fake adapter path exists."""

    resolved_config = config or RuntimeConfig.from_env()
    bundle = load_model_bundle(resolved_config.model_bundle_dir)
    adapter = create_production_adapter(bundle)
    consumer, producer = create_kafka_ports(resolved_config)
    return InferenceService(resolved_config, bundle, adapter, consumer, producer)


def main() -> int:
    try:
        service = create_production_service()
        asyncio.run(service.run_forever())
    except (ConfigError, BundleLoadError, InferenceAdapterError, KafkaTransportError) as exc:
        print(f"AI_STARTUP_FAILED: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(f"AI_RUNTIME_FAILED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
