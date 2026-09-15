"""Strict version-1 contract for backend commands on ``battery-events``.

The TypeScript schema in ``backend/src/kafka.ts`` is the wire source of truth.
This module mirrors only the four currently defined backend-to-edge commands;
it intentionally does not invent the rest of the shared topic's event space.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Literal, TypeAlias


CONTRACT_VERSION: Literal[1] = 1
COMMAND_TOPIC = "battery-events"
EVENT_ID_HEADER = "x-cellguard-event-id"
CommandCode: TypeAlias = Literal[
    "SESSION_STARTED",
    "SESSION_ENDED",
    "RELAY_CUT",
    "RELAY_RESTORE",
]


class CommandContractError(ValueError):
    """A malformed or unsupported command that must not be acknowledged."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def _object(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CommandContractError("EDGE_COMMAND_INVALID", f"{field} must be an object")
    return value


def _strict_keys(value: Mapping[str, Any], required: set[str], field: str) -> None:
    keys = set(value.keys())
    missing = sorted(required - keys)
    # JSON object keys are strings, but keeping this validator total for an
    # injected Mapping avoids leaking a TypeError while formatting an error.
    unknown = sorted(keys - required, key=lambda item: repr(item))
    if missing:
        raise CommandContractError("EDGE_COMMAND_INVALID", f"{field} missing fields: {', '.join(missing)}")
    if unknown:
        raise CommandContractError(
            "EDGE_COMMAND_INVALID",
            f"{field} has unknown fields: {', '.join(map(str, unknown))}",
        )


def _non_empty_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CommandContractError("EDGE_COMMAND_INVALID", f"{field} must be a non-empty string")
    # IDs and codes are opaque; do not silently rewrite them.  Rejecting
    # surrounding whitespace prevents two Kafka keys/identities for one value.
    if value != value.strip():
        raise CommandContractError("EDGE_COMMAND_INVALID", f"{field} must not have surrounding whitespace")
    return value


def _mode(value: object, field: str) -> Literal[1, 2]:
    if isinstance(value, bool) or not isinstance(value, int) or value not in (1, 2):
        raise CommandContractError("EDGE_COMMAND_INVALID", f"{field} must be 1 or 2")
    return value  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class BackendCommand:
    """A validated backend-to-edge command with no derived/fake fields."""

    version: Literal[1]
    code: CommandCode
    params: Mapping[str, Any]

    @property
    def battery_id(self) -> str:
        return str(self.params["batteryId"])

    def to_payload(self) -> dict[str, Any]:
        """Return a detached JSON-compatible payload for hashing/logging."""

        return {"version": self.version, "code": self.code, "params": dict(self.params)}


def parse_command(value: object) -> BackendCommand:
    """Parse exactly one of the four version-1 command payloads.

    No event ID is accepted in JSON.  The durable ID belongs in Kafka record
    metadata and is required separately by :func:`event_id_from_headers`.
    """

    payload = _object(value, "command")
    _strict_keys(payload, {"version", "code", "params"}, "command")
    if (
        isinstance(payload["version"], bool)
        or not isinstance(payload["version"], int)
        or payload["version"] != CONTRACT_VERSION
    ):
        raise CommandContractError("EDGE_COMMAND_VERSION_UNSUPPORTED", "only version 1 is accepted")
    code = payload["code"]
    if not isinstance(code, str) or code not in {"SESSION_STARTED", "SESSION_ENDED", "RELAY_CUT", "RELAY_RESTORE"}:
        raise CommandContractError("EDGE_COMMAND_CODE_UNSUPPORTED", f"unsupported code: {code!r}")
    params = _object(payload["params"], "params")

    if code == "RELAY_CUT":
        _strict_keys(params, {"batteryId", "reasonCode"}, "RELAY_CUT.params")
        battery_id = _non_empty_string(params["batteryId"], "RELAY_CUT.params.batteryId")
        reason = params["reasonCode"]
        if reason is not None:
            reason = _non_empty_string(reason, "RELAY_CUT.params.reasonCode")
        return BackendCommand(1, code, {"batteryId": battery_id, "reasonCode": reason})  # type: ignore[arg-type]

    if code == "RELAY_RESTORE":
        _strict_keys(params, {"batteryId"}, "RELAY_RESTORE.params")
        battery_id = _non_empty_string(params["batteryId"], "RELAY_RESTORE.params.batteryId")
        return BackendCommand(1, code, {"batteryId": battery_id})  # type: ignore[arg-type]

    if code == "SESSION_STARTED":
        _strict_keys(params, {"sessionId", "batteryId", "targetMode"}, "SESSION_STARTED.params")
        session_id = _non_empty_string(params["sessionId"], "SESSION_STARTED.params.sessionId")
        battery_id = _non_empty_string(params["batteryId"], "SESSION_STARTED.params.batteryId")
        target_mode = _mode(params["targetMode"], "SESSION_STARTED.params.targetMode")
        return BackendCommand(1, code, {"sessionId": session_id, "batteryId": battery_id, "targetMode": target_mode})  # type: ignore[arg-type]

    _strict_keys(params, {"sessionId", "batteryId", "endReason"}, "SESSION_ENDED.params")
    session_id = _non_empty_string(params["sessionId"], "SESSION_ENDED.params.sessionId")
    battery_id = _non_empty_string(params["batteryId"], "SESSION_ENDED.params.batteryId")
    end_reason = _non_empty_string(params["endReason"], "SESSION_ENDED.params.endReason")
    return BackendCommand(1, code, {"sessionId": session_id, "batteryId": battery_id, "endReason": end_reason})  # type: ignore[arg-type]


def parse_json_payload(value: bytes | str | bytearray | None) -> BackendCommand:
    """Decode UTF-8 JSON and validate the command contract."""

    if value is None:
        raise CommandContractError("EDGE_INPUT_INVALID", "Kafka record has no value")
    try:
        text = bytes(value).decode("utf-8") if not isinstance(value, str) else value
        decoded = json.loads(text)
    except (UnicodeDecodeError, TypeError, json.JSONDecodeError) as exc:
        raise CommandContractError("EDGE_INPUT_INVALID", "command is not valid UTF-8 JSON") from exc
    return parse_command(decoded)


def canonical_payload(command: BackendCommand) -> bytes:
    """Canonical JSON used as the durable idempotency fingerprint."""

    return json.dumps(
        command.to_payload(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def payload_fingerprint(command: BackendCommand) -> str:
    return sha256(canonical_payload(command)).hexdigest()


def _header_values(headers: object) -> list[object]:
    if headers is None:
        return []
    if isinstance(headers, Mapping):
        values: list[object] = []
        for name, value in headers.items():
            if isinstance(name, bytes):
                try:
                    name = name.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise CommandContractError("EDGE_EVENT_ID_REQUIRED", "Kafka headers are malformed") from exc
            if name == EVENT_ID_HEADER:
                values.append(value)
        return values
    if isinstance(headers, Sequence) and not isinstance(headers, (str, bytes, bytearray)):
        values: list[object] = []
        for pair in headers:
            if not isinstance(pair, Sequence) or isinstance(pair, (str, bytes, bytearray)) or len(pair) != 2:
                raise CommandContractError("EDGE_EVENT_ID_REQUIRED", "Kafka headers are malformed")
            name = pair[0]
            if isinstance(name, bytes):
                try:
                    name = name.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise CommandContractError("EDGE_EVENT_ID_REQUIRED", "Kafka headers are malformed") from exc
            if name == EVENT_ID_HEADER:
                values.append(pair[1])
        return values
    raise CommandContractError("EDGE_EVENT_ID_REQUIRED", "Kafka headers are malformed")


def event_id_from_headers(headers: object) -> str:
    """Require exactly one non-empty durable event ID header.

    ``kafka-python`` exposes headers as ``list[(name, bytes | None)]`` while
    tests and alternate transports commonly use a mapping; both are accepted.
    Duplicate headers are rejected rather than choosing an arbitrary identity.
    """

    values = _header_values(headers)
    if len(values) != 1:
        raise CommandContractError("EDGE_EVENT_ID_REQUIRED", "exactly one x-cellguard-event-id header is required")
    value = values[0]
    if isinstance(value, bytes):
        try:
            decoded = value.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CommandContractError("EDGE_EVENT_ID_INVALID", "event ID header is not valid UTF-8") from exc
    elif isinstance(value, str):
        decoded = value
    else:
        raise CommandContractError("EDGE_EVENT_ID_INVALID", "event ID header must be bytes or string")
    if not decoded.strip() or decoded != decoded.strip():
        raise CommandContractError("EDGE_EVENT_ID_INVALID", "event ID must be a non-empty opaque value")
    return decoded


def decode_record_key(key: object) -> str:
    if isinstance(key, bytes):
        try:
            key = key.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CommandContractError("EDGE_PARTITION_KEY_INVALID", "Kafka key is not valid UTF-8") from exc
    if not isinstance(key, str) or not key.strip() or key != key.strip():
        raise CommandContractError("EDGE_PARTITION_KEY_INVALID", "batteryId partition key is required")
    return key


def ensure_partition_key(command: BackendCommand, key: object) -> None:
    if decode_record_key(key) != command.battery_id:
        raise CommandContractError(
            "EDGE_PARTITION_KEY_MISMATCH",
            f"Kafka key does not match params.batteryId for {command.code}",
        )
