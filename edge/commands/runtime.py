"""Production entry point for the Raspberry Pi command consumer."""

from __future__ import annotations

import asyncio
import sys

from .config import EdgeConfig, EdgeConfigError
from .consumer import CommandConsumerService, install_signal_handlers
from .idempotency import IdempotencyError, SQLiteIdempotencyStore
from .kafka import KafkaTransportError, create_kafka_command_consumer
from .relay import (
    DenySafetyGate,
    DenySourceChangeGate,
    FileCurrentGate,
    FileOvfGate,
    FileSourceChangeGate,
    GpioRelayAdapter,
    GpioToolUnavailable,
    RpiGpioPort,
)


def create_production_service(config: EdgeConfig | None = None) -> CommandConsumerService:
    """Build the real edge service without connecting to Kafka yet.

    There is no fake adapter fallback here.  Missing ``RPi.GPIO``, an unknown
    profile, or a non-durable SQLite path is surfaced to the caller before the
    service starts consuming commands.
    """

    resolved = config or EdgeConfig.from_env()
    store = SQLiteIdempotencyStore(resolved.idempotency_db)
    try:
        gpio = RpiGpioPort()
        gate = FileSourceChangeGate(resolved.source_gate_file) if resolved.source_gate_file else DenySourceChangeGate()
        current_gate = FileCurrentGate(resolved.current_gate_file) if resolved.current_gate_file else DenySafetyGate()
        ovf_gate = FileOvfGate(resolved.ovf_gate_file) if resolved.ovf_gate_file else DenySafetyGate()
        relay = GpioRelayAdapter(
            resolved.hardware_profile,
            gpio,
            store,
            source_gate=gate,
            current_gate=current_gate,
            ovf_gate=ovf_gate,
        )
        consumer = create_kafka_command_consumer(resolved)
        return CommandConsumerService(resolved, consumer, relay, store)
    except Exception:
        store.close()
        raise


async def _run(service: CommandConsumerService) -> None:
    install_signal_handlers(service)
    await service.run_forever()


def main() -> int:
    try:
        service = create_production_service()
        asyncio.run(_run(service))
    except (EdgeConfigError, IdempotencyError, KafkaTransportError, GpioToolUnavailable) as exc:
        print(f"EDGE_STARTUP_FAILED: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(f"EDGE_RUNTIME_FAILED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
