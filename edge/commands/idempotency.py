"""Durable command identity and relay runtime state.

SQLite is intentionally local to the Raspberry Pi.  A successful physical
command is recorded only after the relay adapter returns successfully; Kafka
offset acknowledgement is performed by the command service after that durable
record is committed.  ``PROCESSING`` rows prevent a crash/retry window from
executing the same physical command twice, at the cost of requiring explicit
operator recovery if a process dies while hardware execution is ambiguous.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, Protocol


EventClaimKind = Literal["new", "duplicate"]


class IdempotencyError(RuntimeError):
    """A durable identity conflict or an unavailable local store."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class EventClaim:
    kind: EventClaimKind
    event_id: str


class CommandIdempotencyStore(Protocol):
    """The small persistence boundary consumed by ``CommandConsumerService``."""

    def claim_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> EventClaim: ...

    def complete_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> None: ...

    def abandon_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> None: ...

    def load_relay_state(self) -> Mapping[str, Any] | None: ...

    def save_relay_state(self, state: Mapping[str, Any]) -> None: ...

    def close(self) -> None: ...


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _validate_identity(event_id: str, battery_id: str, code: str, payload_hash: str) -> None:
    if not all(isinstance(value, str) for value in (event_id, battery_id, code, payload_hash)):
        raise IdempotencyError("EDGE_IDEMPOTENCY_INVALID", "command identity fields must be strings")
    if not event_id.strip() or event_id != event_id.strip():
        raise IdempotencyError("EDGE_EVENT_ID_INVALID", "event ID must be a non-empty opaque value")
    if not battery_id.strip() or battery_id != battery_id.strip():
        raise IdempotencyError("EDGE_COMMAND_INVALID", "battery ID must be a non-empty value")
    if not code.strip() or not payload_hash.strip():
        raise IdempotencyError("EDGE_IDEMPOTENCY_INVALID", "command code and payload hash are required")


class SQLiteIdempotencyStore:
    """Crash-persistent event identity store backed by a single SQLite file."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            parent = Path(self.path).parent
            parent.mkdir(parents=True, exist_ok=True)
        try:
            self._connection = sqlite3.connect(
                self.path,
                timeout=30.0,
                isolation_level=None,
                check_same_thread=False,
            )
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute("PRAGMA synchronous = FULL")
            if self.path != ":memory:":
                self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS command_idempotency (
                    event_id TEXT PRIMARY KEY,
                    battery_id TEXT NOT NULL,
                    code TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED')),
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_command_idempotency_battery
                    ON command_idempotency (battery_id, created_at);
                CREATE TABLE IF NOT EXISTS relay_runtime_state (
                    state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """,
            )
        except sqlite3.Error as exc:
            raise IdempotencyError("EDGE_IDEMPOTENCY_STORE_UNAVAILABLE", str(exc)) from exc
        self._lock = threading.RLock()
        self._closed = False

    def _ensure_open(self) -> sqlite3.Connection:
        if self._closed:
            raise IdempotencyError("EDGE_IDEMPOTENCY_STORE_CLOSED", "local idempotency store is closed")
        return self._connection

    def claim_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> EventClaim:
        _validate_identity(event_id, battery_id, code, payload_hash)
        with self._lock:
            connection = self._ensure_open()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT battery_id, code, payload_hash, status FROM command_idempotency WHERE event_id = ?",
                    (event_id,),
                ).fetchone()
                if row is not None:
                    if tuple(row[:3]) != (battery_id, code, payload_hash):
                        connection.execute("ROLLBACK")
                        raise IdempotencyError(
                            "EDGE_EVENT_ID_CONFLICT",
                            "event ID was previously used for a different command",
                        )
                    status = str(row[3])
                    if status == "SUCCEEDED":
                        connection.execute("COMMIT")
                        return EventClaim("duplicate", event_id)
                    connection.execute("ROLLBACK")
                    raise IdempotencyError(
                        "EDGE_EVENT_IN_FLIGHT",
                        "event ID has an unfinished physical execution; operator reconciliation is required",
                    )
                connection.execute(
                    """
                    INSERT INTO command_idempotency
                        (event_id, battery_id, code, payload_hash, status, created_at, completed_at)
                    VALUES (?, ?, ?, ?, 'PROCESSING', ?, NULL)
                    """,
                    (event_id, battery_id, code, payload_hash, _utc_now()),
                )
                connection.execute("COMMIT")
                return EventClaim("new", event_id)
            except IdempotencyError:
                raise
            except sqlite3.Error as exc:
                try:
                    connection.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise IdempotencyError("EDGE_IDEMPOTENCY_WRITE_FAILED", str(exc)) from exc

    def complete_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> None:
        _validate_identity(event_id, battery_id, code, payload_hash)
        with self._lock:
            connection = self._ensure_open()
            try:
                connection.execute("BEGIN IMMEDIATE")
                result = connection.execute(
                    """
                    UPDATE command_idempotency
                    SET status = 'SUCCEEDED', completed_at = ?
                    WHERE event_id = ? AND battery_id = ? AND code = ?
                      AND payload_hash = ? AND status = 'PROCESSING'
                    """,
                    (_utc_now(), event_id, battery_id, code, payload_hash),
                )
                if result.rowcount != 1:
                    row = connection.execute(
                        "SELECT battery_id, code, payload_hash, status FROM command_idempotency WHERE event_id = ?",
                        (event_id,),
                    ).fetchone()
                    connection.execute("ROLLBACK")
                    if row is not None and tuple(row[:3]) == (battery_id, code, payload_hash) and row[3] == "SUCCEEDED":
                        return
                    raise IdempotencyError("EDGE_IDEMPOTENCY_COMPLETE_FAILED", "processing identity was not found")
                connection.execute("COMMIT")
            except IdempotencyError:
                raise
            except sqlite3.Error as exc:
                try:
                    connection.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise IdempotencyError("EDGE_IDEMPOTENCY_COMPLETE_FAILED", str(exc)) from exc

    def abandon_event(self, event_id: str, battery_id: str, code: str, payload_hash: str) -> None:
        """Release a failed attempt, never recording it as successful."""

        _validate_identity(event_id, battery_id, code, payload_hash)
        with self._lock:
            connection = self._ensure_open()
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    DELETE FROM command_idempotency
                    WHERE event_id = ? AND battery_id = ? AND code = ?
                      AND payload_hash = ? AND status = 'PROCESSING'
                    """,
                    (event_id, battery_id, code, payload_hash),
                )
                connection.execute("COMMIT")
            except sqlite3.Error as exc:
                try:
                    connection.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise IdempotencyError("EDGE_IDEMPOTENCY_RELEASE_FAILED", str(exc)) from exc

    def load_relay_state(self) -> Mapping[str, Any] | None:
        with self._lock:
            connection = self._ensure_open()
            try:
                row = connection.execute(
                    "SELECT state_json FROM relay_runtime_state WHERE state_id = 1",
                ).fetchone()
            except sqlite3.Error as exc:
                raise IdempotencyError("EDGE_RELAY_STATE_READ_FAILED", str(exc)) from exc
            if row is None:
                return None
            try:
                value = json.loads(str(row[0]))
            except json.JSONDecodeError as exc:
                raise IdempotencyError("EDGE_RELAY_STATE_CORRUPT", "relay runtime state is not valid JSON") from exc
            if not isinstance(value, Mapping):
                raise IdempotencyError("EDGE_RELAY_STATE_CORRUPT", "relay runtime state must be an object")
            return dict(value)

    def save_relay_state(self, state: Mapping[str, Any]) -> None:
        try:
            encoded = json.dumps(dict(state), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise IdempotencyError("EDGE_RELAY_STATE_INVALID", "relay runtime state is not JSON serializable") from exc
        with self._lock:
            connection = self._ensure_open()
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    INSERT INTO relay_runtime_state (state_id, state_json, updated_at)
                    VALUES (1, ?, ?)
                    ON CONFLICT(state_id) DO UPDATE SET
                        state_json = excluded.state_json,
                        updated_at = excluded.updated_at
                    """,
                    (encoded, _utc_now()),
                )
                connection.execute("COMMIT")
            except sqlite3.Error as exc:
                try:
                    connection.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise IdempotencyError("EDGE_RELAY_STATE_WRITE_FAILED", str(exc)) from exc

    def successful_event_count(self) -> int:
        """Small diagnostic helper used by tests and local operator checks."""

        with self._lock:
            connection = self._ensure_open()
            row = connection.execute(
                "SELECT count(*) FROM command_idempotency WHERE status = 'SUCCEEDED'",
            ).fetchone()
            return int(row[0]) if row else 0

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            try:
                self._connection.close()
            finally:
                self._closed = True
