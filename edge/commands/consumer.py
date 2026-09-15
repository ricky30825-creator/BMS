"""Manual-commit command consumer for the Raspberry Pi edge process."""

from __future__ import annotations

import asyncio
import inspect
import json
import signal
import sys
from collections import defaultdict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from .config import EdgeConfig
from .contracts import (
    COMMAND_TOPIC,
    BackendCommand,
    CommandContractError,
    ensure_partition_key,
    event_id_from_headers,
    parse_json_payload,
    payload_fingerprint,
)
from .idempotency import CommandIdempotencyStore, EventClaim, IdempotencyError
from .kafka import CommandConsumerPort, KafkaCommandRecord
from .relay import RelayCommandPort


class EdgeProcessingError(RuntimeError):
    """A command failed and therefore must remain uncommitted."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class CommandProcessResult:
    event_id: str
    code: str
    battery_id: str
    duplicate: bool
    input_topic: str
    input_partition: int
    input_offset: int
    committed_offset: int


Logger = Callable[[str, Mapping[str, object]], None]


def _default_logger(message: str, details: Mapping[str, object]) -> None:
    print(f"[edge-command] {message} {dict(details)}", file=sys.stderr)


def _record_offset(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise EdgeProcessingError("EDGE_KAFKA_OFFSET_INVALID", "record offset must be a non-negative integer")
    return value


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


class CommandConsumerService:
    """Own one Kafka consumer, one relay adapter, and one durable store."""

    def __init__(
        self,
        config: EdgeConfig,
        consumer: CommandConsumerPort,
        relay: RelayCommandPort,
        idempotency: CommandIdempotencyStore,
        *,
        logger: Logger | None = None,
        retry_delay_ms: int | None = None,
    ) -> None:
        self.config = config
        self.consumer = consumer
        self.relay = relay
        self.idempotency = idempotency
        self.logger = logger or _default_logger
        self.retry_delay_ms = config.retry_delay_ms if retry_delay_ms is None else retry_delay_ms
        if self.retry_delay_ms <= 0:
            raise ValueError("retry_delay_ms must be positive")
        self._battery_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._last_offsets: dict[str, int] = {}
        self._started = False
        self._stopping = False
        self._consumer_connected = False
        self._closed_store = False

    async def start(self) -> None:
        if self._started:
            return
        try:
            # GPIO is initialized first.  No Kafka command is accepted until
            # every physical relay channel is HIGH (open/fail-safe).
            await self.relay.initialize()
            await self.consumer.connect()
            self._consumer_connected = True
            await self.consumer.subscribe(COMMAND_TOPIC)
            self._stopping = False
            self._started = True
        except Exception:
            await self.stop()
            raise

    async def stop(self) -> None:
        self._stopping = True
        errors: list[BaseException] = []
        if self._consumer_connected:
            try:
                await self.consumer.close()
            except BaseException as exc:
                errors.append(exc)
            finally:
                self._consumer_connected = False
        try:
            await self.relay.shutdown()
        except BaseException as exc:
            errors.append(exc)
        if not self._closed_store:
            try:
                self.idempotency.close()
            except BaseException as exc:
                errors.append(exc)
            finally:
                self._closed_store = True
        self._started = False
        if errors:
            raise errors[0]

    async def _dispatch(self, command: BackendCommand) -> None:
        params = command.params
        if command.code == "RELAY_CUT":
            await _maybe_await(self.relay.relay_cut(command.battery_id, params["reasonCode"]))
        elif command.code == "RELAY_RESTORE":
            await _maybe_await(self.relay.relay_restore(command.battery_id))
        elif command.code == "SESSION_STARTED":
            await _maybe_await(self.relay.session_started(
                params["sessionId"], command.battery_id, params["targetMode"],
            ))
        elif command.code == "SESSION_ENDED":
            await _maybe_await(self.relay.session_ended(
                params["sessionId"], command.battery_id, params["endReason"],
            ))
        else:  # pragma: no cover - parse_command closes this union
            raise EdgeProcessingError("EDGE_COMMAND_CODE_UNSUPPORTED", command.code)

    def _claim(self, event_id: str, command: BackendCommand, fingerprint: str) -> EventClaim:
        try:
            return self.idempotency.claim_event(event_id, command.battery_id, command.code, fingerprint)
        except IdempotencyError as exc:
            raise EdgeProcessingError(exc.code, str(exc)) from exc

    def _complete(self, event_id: str, command: BackendCommand, fingerprint: str) -> None:
        try:
            self.idempotency.complete_event(event_id, command.battery_id, command.code, fingerprint)
        except IdempotencyError as exc:
            # Do not call abandon_event here: a physical command has already
            # succeeded and the processing row must block a duplicate retry.
            raise EdgeProcessingError(exc.code, str(exc)) from exc

    def _abandon(self, event_id: str, command: BackendCommand, fingerprint: str) -> None:
        try:
            self.idempotency.abandon_event(event_id, command.battery_id, command.code, fingerprint)
        except IdempotencyError as exc:
            # A failed release leaves PROCESSING as a safety reservation.  It
            # is safer to block a duplicate than to risk another GPIO action.
            raise EdgeProcessingError(exc.code, str(exc)) from exc

    async def process_message(self, message: KafkaCommandRecord) -> CommandProcessResult:
        """Validate, execute, durably record, and finally commit one record."""

        if message.topic != COMMAND_TOPIC:
            raise EdgeProcessingError("EDGE_INPUT_TOPIC_INVALID", f"expected {COMMAND_TOPIC!r}, got {message.topic!r}")
        partition = message.partition
        offset = _record_offset(message.offset)
        if isinstance(partition, bool) or not isinstance(partition, int) or partition < 0:
            raise EdgeProcessingError("EDGE_KAFKA_PARTITION_INVALID", "partition must be a non-negative integer")
        try:
            event_id = event_id_from_headers(message.headers)
            command = parse_json_payload(message.value)
            ensure_partition_key(command, message.key)
        except CommandContractError as exc:
            raise EdgeProcessingError(exc.code, str(exc)) from exc

        # Kafka guarantees key ordering per partition.  This lock also keeps
        # injected/test callers and future parallel pollers from executing two
        # commands for one battery concurrently.
        lock = self._battery_locks[command.battery_id]
        async with lock:
            prior_offset = self._last_offsets.get(command.battery_id)
            if prior_offset is not None and offset < prior_offset:
                raise EdgeProcessingError(
                    "EDGE_COMMAND_ORDER_INVALID",
                    f"offset {offset} arrived after {prior_offset} for {command.battery_id}",
                )
            fingerprint = payload_fingerprint(command)
            claim = self._claim(event_id, command, fingerprint)
            if claim.kind == "duplicate":
                # A previously successful event is safe to acknowledge; no
                # adapter method is called, including duplicate RELAY_CUT.
                duplicate = True
            else:
                duplicate = False
                try:
                    await self._dispatch(command)
                except Exception as exc:
                    # GPIO has no transaction/rollback boundary: an adapter
                    # can fail after a relay contact has already moved (or
                    # after durable relay-state persistence has failed). Keep
                    # PROCESSING as a safety reservation so this partition
                    # cannot re-run physical hardware automatically. An
                    # operator may explicitly reconcile the hardware and call
                    # ``abandon_event`` before retrying; never turn ambiguity
                    # into a second physical cut/restore.
                    raise EdgeProcessingError("EDGE_COMMAND_EXECUTION_FAILED", str(exc)) from exc
                self._complete(event_id, command, fingerprint)

            next_offset = offset + 1
            try:
                await self.consumer.commit(COMMAND_TOPIC, partition, next_offset)
            except Exception as exc:
                # The durable success row remains.  A replay after a commit
                # failure takes the duplicate branch and cannot re-run GPIO.
                raise EdgeProcessingError("EDGE_KAFKA_COMMIT_FAILED", str(exc)) from exc
            self._last_offsets[command.battery_id] = offset
            return CommandProcessResult(
                event_id=event_id,
                code=command.code,
                battery_id=command.battery_id,
                duplicate=duplicate,
                input_topic=message.topic,
                input_partition=partition,
                input_offset=offset,
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
                    self.logger("command failed; offset remains uncommitted", {
                        "topic": message.topic,
                        "partition": message.partition,
                        "offset": message.offset,
                        "error": str(exc),
                    })
                    # Keep retrying the same record, but leave enough time for
                    # an operator to correct a physical gate/tool failure.
                    try:
                        await asyncio.sleep(self.retry_delay_ms / 1000.0)
                    except asyncio.CancelledError:
                        raise
        finally:
            await self.stop()


def install_signal_handlers(service: CommandConsumerService) -> None:
    """Arrange graceful SIGINT/SIGTERM shutdown where the loop permits it."""

    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, lambda: setattr(service, "_stopping", True))
        except (NotImplementedError, RuntimeError):
            pass
