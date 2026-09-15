"""Fail-closed ``battery-events`` command consumer and relay boundary.

The package deliberately keeps the Kafka transport, command validation,
durable idempotency store, and GPIO implementation separate.  Importing this
package never opens Kafka or touches GPIO.
"""

from .contracts import (
    COMMAND_TOPIC,
    EVENT_ID_HEADER,
    CONTRACT_VERSION,
    BackendCommand,
    CommandContractError,
    parse_command,
)
from .relay import (
    BREAK_BEFORE_MAKE_MS,
    HIGH,
    LOW,
    FileCurrentGate,
    FileOvfGate,
    FileSourceChangeGate,
)

__all__ = [
    "COMMAND_TOPIC",
    "EVENT_ID_HEADER",
    "CONTRACT_VERSION",
    "BackendCommand",
    "CommandContractError",
    "parse_command",
    "BREAK_BEFORE_MAKE_MS",
    "HIGH",
    "LOW",
    "FileCurrentGate",
    "FileOvfGate",
    "FileSourceChangeGate",
]
