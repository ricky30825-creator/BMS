"""Test-only relay fake.

This module is intentionally named and imported only by unit tests.  The
production entry point constructs :class:`edge.commands.relay.RpiGpioPort`
directly and has no fake/success fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FakeRelayAdapter:
    initialized: bool = False
    calls: list[tuple[object, ...]] = field(default_factory=list)
    fail_code: str | None = None
    shutdown_calls: int = 0

    async def initialize(self) -> None:
        self.initialized = True
        self.calls.append(("initialize",))

    def _maybe_fail(self, code: str) -> None:
        if self.fail_code == code:
            raise RuntimeError(f"fake relay failure: {code}")

    async def relay_cut(self, battery_id: str, reason_code: str | None) -> None:
        self._maybe_fail("RELAY_CUT")
        self.calls.append(("RELAY_CUT", battery_id, reason_code))

    async def relay_restore(self, battery_id: str) -> None:
        self._maybe_fail("RELAY_RESTORE")
        self.calls.append(("RELAY_RESTORE", battery_id))

    async def session_started(self, session_id: str, battery_id: str, target_mode: int) -> None:
        self._maybe_fail("SESSION_STARTED")
        self.calls.append(("SESSION_STARTED", session_id, battery_id, target_mode))

    async def session_ended(self, session_id: str, battery_id: str, end_reason: str) -> None:
        self._maybe_fail("SESSION_ENDED")
        self.calls.append(("SESSION_ENDED", session_id, battery_id, end_reason))

    async def shutdown(self) -> None:
        self.shutdown_calls += 1
        self.calls.append(("shutdown",))
