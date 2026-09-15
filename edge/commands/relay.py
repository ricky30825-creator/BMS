"""Fail-closed relay adapter for the two documented hardware profiles.

Only this module knows GPIO BCM numbers and active-LOW semantics.  The Kafka
consumer depends on the small ``RelayCommandPort`` protocol, so tests can use
an explicit fake without ever selecting a fake production GPIO backend.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TypeAlias

from .config import HardwareProfile, SUPPORTED_PROFILES
from .idempotency import CommandIdempotencyStore, IdempotencyError


HIGH = 1  # active-LOW relay: HIGH means contact open / path cut
LOW = 0   # active-LOW relay: LOW means contact closed / conducting
BREAK_BEFORE_MAKE_MS = 50
PINS: Mapping[str, int] = {"CH1": 5, "CH2": 6, "CH3": 13, "CH4": 19}
PIN_NAMES: Mapping[int, str] = {pin: name for name, pin in PINS.items()}
SAFE_OUTPUTS = (HIGH, HIGH, HIGH, HIGH)
HardwareOutputs: TypeAlias = tuple[int, int, int, int]


class RelayError(RuntimeError):
    """A relay command was rejected or could not be completed safely."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class GpioToolUnavailable(RelayError):
    """The actual Raspberry Pi GPIO implementation cannot be loaded."""


class RelayCommandPort(Protocol):
    async def initialize(self) -> None: ...

    async def relay_cut(self, battery_id: str, reason_code: str | None) -> Any: ...

    async def relay_restore(self, battery_id: str) -> Any: ...

    async def session_started(self, session_id: str, battery_id: str, target_mode: int) -> Any: ...

    async def session_ended(self, session_id: str, battery_id: str, end_reason: str) -> Any: ...

    async def shutdown(self) -> None: ...


class GpioPort(Protocol):
    """Lowest-level GPIO boundary; implementations are deliberately tiny."""

    def setup_output(self, pin: int, initial: int) -> None: ...

    def write_many(self, values: Mapping[int, int]) -> None: ...

    def close(self) -> None: ...


class SourceChangeGate(Protocol):
    """Explicit operator gate for SOURCE_P and CH4 mode changes."""

    def confirm(self, battery_id: str, target_mode: int) -> bool | Awaitable[bool]: ...


class SafetyGate(Protocol):
    """Manual precondition gate for a physical mode/restore operation."""

    def confirm(self, battery_id: str, target_mode: int) -> bool | Awaitable[bool]: ...


class DenySourceChangeGate:
    """Default gate: no software path may guess a physical source change."""

    def confirm(self, battery_id: str, target_mode: int) -> bool:
        return False


class DenySafetyGate:
    """Default for current/OVF gates: absence is always a denial."""

    def confirm(self, battery_id: str, target_mode: int) -> bool:
        return False


class FileSourceChangeGate:
    """Operator acknowledgement gate backed by an explicitly named file.

    An operator must write the exact token ``<battery_id>:<target_mode>`` to
    the configured file after physically disconnecting the old source,
    insulating it, and attaching exactly one new source lead.  The file is
    never created or deleted by the service; a missing or mismatched token is
    always a denial.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def confirm(self, battery_id: str, target_mode: int) -> bool:
        try:
            token = self.path.read_text(encoding="utf-8").strip()
        except (FileNotFoundError, OSError, UnicodeError):
            return False
        return token == f"{battery_id}:{target_mode}"


class FileCurrentGate(FileSourceChangeGate):
    """Manual acknowledgement that ``|current_a| <= 0.02 A`` was observed.

    The edge command process does not own INA226 readings.  The operator (or
    a separately verified sensor supervisor) must therefore place the exact
    battery/mode token in this file after checking the current gate and
    leaving OVF clear.  A missing file or stale token denies the operation.
    """


class FileOvfGate(FileSourceChangeGate):
    """Manual acknowledgement that INA226 ``OVF == 0`` was observed."""


def _deny_gate_for(name: str) -> RelayError:
    return RelayError(
        f"EDGE_{name.upper()}_GATE_REQUIRED",
        f"the manual {name} gate must be confirmed before changing the physical path",
    )


class RpiGpioPort:
    """Actual Raspberry Pi GPIO implementation using the RPi.GPIO package.

    Import and GPIO setup are intentionally lazy relative to module import but
    eager relative to service startup.  If the tool is unavailable, startup
    fails before Kafka is connected and no fake fallback is attempted.
    """

    def __init__(self) -> None:
        try:
            import RPi.GPIO as gpio  # type: ignore[import-not-found]
        except Exception as exc:
            raise GpioToolUnavailable(
                "EDGE_GPIO_UNAVAILABLE",
                "RPi.GPIO is not available; install and verify the real Pi GPIO backend",
            ) from exc
        self._gpio = gpio
        try:
            gpio.setwarnings(False)
            gpio.setmode(gpio.BCM)
        except Exception as exc:
            raise GpioToolUnavailable("EDGE_GPIO_INIT_FAILED", str(exc)) from exc

    def setup_output(self, pin: int, initial: int) -> None:
        if isinstance(pin, bool) or not isinstance(pin, int) or pin not in PIN_NAMES:
            raise ValueError("GPIO pin is not part of the documented relay channels")
        if isinstance(initial, bool) or initial not in (LOW, HIGH):
            raise ValueError("GPIO value must be LOW or HIGH")
        self._gpio.setup(pin, self._gpio.OUT, initial=self._gpio.HIGH if initial == HIGH else self._gpio.LOW)

    def write_many(self, values: Mapping[int, int]) -> None:
        for pin, value in values.items():
            if isinstance(pin, bool) or not isinstance(pin, int) or pin not in PIN_NAMES:
                raise ValueError("GPIO pin is not part of the documented relay channels")
            if isinstance(value, bool) or value not in (LOW, HIGH):
                raise ValueError("GPIO value must be LOW or HIGH")
            self._gpio.output(pin, self._gpio.HIGH if value == HIGH else self._gpio.LOW)

    def close(self) -> None:
        try:
            self._gpio.cleanup(list(PINS.values()))
        except Exception as exc:
            raise GpioToolUnavailable("EDGE_GPIO_CLOSE_FAILED", str(exc)) from exc


@dataclass(frozen=True, slots=True)
class RelayAction:
    battery_id: str
    code: str
    changed: bool
    duplicate_physical_state: bool
    outputs: HardwareOutputs


def _outputs_from(value: object, *, field: str = "outputs") -> HardwareOutputs:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise RelayError("EDGE_RELAY_STATE_CORRUPT", f"{field} must contain four GPIO values")
    outputs = tuple(value)
    if any(isinstance(item, bool) or item not in (LOW, HIGH) for item in outputs):
        raise RelayError("EDGE_RELAY_STATE_CORRUPT", f"{field} contains an invalid GPIO value")
    return outputs  # type: ignore[return-value]


def _is_safe_interlock_reason(reason_code: str | None) -> bool:
    if reason_code is None:
        return False
    normalized = reason_code.strip().upper()
    # Backend Fail-Safe trigger codes are all prefixed this way.  MODE_SWITCH
    # and SESSION_SUPERSEDED must not accidentally latch a safety interlock.
    return normalized.startswith("FAILSAFE_") or normalized == "RELAY_AUTO_CUT"


def _allowed_outputs(profile: HardwareProfile) -> frozenset[HardwareOutputs]:
    if profile == "MODE1_EXTERNAL_CELL_V1":
        # The canonical mode-1 document fixes the active-LOW pins and mutual
        # exclusion.  Master-only idle is safe and is used when a backend
        # restore carries no charge/discharge branch selection.
        return frozenset({
            SAFE_OUTPUTS,
            (HIGH, HIGH, LOW, HIGH),
            (LOW, HIGH, LOW, HIGH),
            (HIGH, LOW, LOW, HIGH),
        })
    if profile == "COMBINED_EXISTING_PARTS_V1":
        # Exact table from mode1_backend_spec.md §8-4-1 and the combined
        # assembly guide.  In particular, mode 2 never closes CH1 or CH2.
        return frozenset({
            SAFE_OUTPUTS,
            (LOW, HIGH, LOW, HIGH),
            (HIGH, LOW, LOW, HIGH),
            (HIGH, HIGH, HIGH, LOW),
            (HIGH, HIGH, LOW, LOW),
        })
    raise RelayError("EDGE_HARDWARE_PROFILE_INVALID", f"unsupported profile: {profile!r}")


class GpioRelayAdapter:
    """Stateful, fail-closed relay adapter implementing the four commands."""

    def __init__(
        self,
        profile: HardwareProfile,
        gpio: GpioPort,
        state_store: CommandIdempotencyStore | None = None,
        *,
        source_gate: SourceChangeGate | None = None,
        current_gate: SafetyGate | None = None,
        ovf_gate: SafetyGate | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        break_before_make_ms: int = BREAK_BEFORE_MAKE_MS,
    ) -> None:
        if not isinstance(profile, str) or profile not in SUPPORTED_PROFILES:
            raise RelayError("EDGE_HARDWARE_PROFILE_INVALID", f"unsupported profile: {profile!r}")
        if (
            isinstance(break_before_make_ms, bool)
            or not isinstance(break_before_make_ms, int)
            or break_before_make_ms < BREAK_BEFORE_MAKE_MS
        ):
            raise RelayError("EDGE_BREAK_BEFORE_MAKE_INVALID", "break-before-make delay must be at least 50ms")
        self.profile = profile
        self._gpio = gpio
        self._state_store = state_store
        self._source_gate = source_gate or DenySourceChangeGate()
        self._current_gate = current_gate or DenySafetyGate()
        self._ovf_gate = ovf_gate or DenySafetyGate()
        self._sleep_fn = sleep_fn
        self._break_seconds = break_before_make_ms / 1000.0
        self._allowed = _allowed_outputs(profile)
        self._lock = asyncio.Lock()
        self._initialized = False
        self._gpio_started = False
        self._outputs: HardwareOutputs = SAFE_OUTPUTS
        self._active_session_id: str | None = None
        self._active_battery_id: str | None = None
        self._target_mode: int | None = None
        self._restore_outputs: HardwareOutputs | None = None
        self._interlocked_batteries: set[str] = set()
        self._selector_ready = False
        # Current/OVF acknowledgements are scoped to one safe transition.  A
        # restart or a new master restore must obtain them again.
        self._electrical_gate_verified = False

    @property
    def outputs(self) -> HardwareOutputs:
        return self._outputs

    @property
    def initialized(self) -> bool:
        return self._initialized

    @property
    def interlocked_batteries(self) -> frozenset[str]:
        return frozenset(self._interlocked_batteries)

    def _state_payload(self) -> dict[str, Any]:
        return {
            "version": 1,
            "profile": self.profile,
            "outputs": list(self._outputs),
            "active_session_id": self._active_session_id,
            "active_battery_id": self._active_battery_id,
            "target_mode": self._target_mode,
            "restore_outputs": None if self._restore_outputs is None else list(self._restore_outputs),
            "interlocked_batteries": sorted(self._interlocked_batteries),
        }

    def _persist_state(self) -> None:
        if self._state_store is None:
            return
        try:
            self._state_store.save_relay_state(self._state_payload())
        except IdempotencyError as exc:
            raise RelayError(exc.code, str(exc)) from exc

    def _load_state(self) -> None:
        if self._state_store is None:
            return
        try:
            state = self._state_store.load_relay_state()
        except IdempotencyError as exc:
            raise RelayError(exc.code, str(exc)) from exc
        if state is None:
            return
        if state.get("version") != 1 or state.get("profile") != self.profile:
            raise RelayError("EDGE_RELAY_STATE_PROFILE_MISMATCH", "stored relay state does not match the configured hardware profile")
        # Actual GPIO is deliberately reset HIGH on every process start.  The
        # stored stable outputs are retained as evidence for the restore plan,
        # but malformed/forbidden state must fail closed before Kafka starts.
        try:
            stored_outputs = _outputs_from(state.get("outputs"), field="outputs")
            self._validate_outputs(stored_outputs)
        except RelayError as exc:
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", str(exc)) from exc
        stored_restore = state.get("restore_outputs")
        if stored_restore is None:
            self._restore_outputs = None
        else:
            try:
                self._restore_outputs = _outputs_from(stored_restore, field="restore_outputs")
                self._validate_outputs(self._restore_outputs)
            except RelayError as exc:
                raise RelayError("EDGE_RELAY_STATE_CORRUPT", str(exc)) from exc
        active_session = state.get("active_session_id")
        active_battery = state.get("active_battery_id")
        if active_session is not None and (
            not isinstance(active_session, str) or not active_session or active_session != active_session.strip()
        ):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored active session ID is invalid")
        if active_battery is not None and (
            not isinstance(active_battery, str) or not active_battery or active_battery != active_battery.strip()
        ):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored active battery ID is invalid")
        self._active_session_id = active_session
        self._active_battery_id = active_battery
        if (self._active_session_id is None) != (self._active_battery_id is None):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored active session and battery must be present together")
        target_mode = state.get("target_mode")
        if target_mode is not None and (
            isinstance(target_mode, bool) or not isinstance(target_mode, int) or target_mode not in (1, 2)
        ):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored target mode is invalid")
        if (self._active_session_id is None) != (target_mode is None):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored target mode does not match active session state")
        self._target_mode = target_mode
        if self.profile == "COMBINED_EXISTING_PARTS_V1" and self._restore_outputs is not None and target_mode is not None:
            restore_mode = 1 if self._restore_outputs[3] == HIGH else 2
            if restore_mode != target_mode:
                raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored restore path does not match active target mode")
        interlocks = state.get("interlocked_batteries", [])
        if (
            not isinstance(interlocks, list)
            or any(
                not isinstance(value, str) or not value.strip() or value != value.strip()
                for value in interlocks
            )
            or len(set(interlocks)) != len(interlocks)
        ):
            raise RelayError("EDGE_RELAY_STATE_CORRUPT", "stored interlock list is invalid")
        self._interlocked_batteries = set(interlocks)

    async def _run_gpio(self, operation: Callable[[], None]) -> None:
        try:
            await asyncio.to_thread(operation)
        except RelayError:
            raise
        except Exception as exc:
            raise RelayError("EDGE_GPIO_WRITE_FAILED", str(exc)) from exc

    async def _delay(self) -> None:
        await asyncio.to_thread(self._sleep_fn, self._break_seconds)

    async def initialize(self) -> None:
        async with self._lock:
            if self._initialized:
                return
            # Remember that the real GPIO object may need cleanup even when a
            # setup call or durable-state validation fails midway through
            # startup.  ``shutdown`` uses this flag independently of the
            # command-ready flag below.
            self._gpio_started = True
            try:
                # Each setup uses HIGH as its electrical initial value.  The
                # second write covers GPIO libraries that ignore `initial`.
                for pin in PINS.values():
                    await self._run_gpio(lambda pin=pin: self._gpio.setup_output(pin, HIGH))
                await self._run_gpio(lambda: self._gpio.write_many({pin: HIGH for pin in PINS.values()}))
            except Exception:
                # Best effort all-HIGH is safe if a partial setup failed.  Do
                # not hide the original startup failure or continue to Kafka.
                try:
                    await self._run_gpio(lambda: self._gpio.write_many({pin: HIGH for pin in PINS.values()}))
                except Exception:
                    pass
                raise
            self._outputs = SAFE_OUTPUTS
            self._load_state()
            self._selector_ready = False
            self._electrical_gate_verified = False
            # Actual pins are known to be safe; persist that fact while keeping
            # the prior mode/session/restore plan for an explicit later retry.
            self._persist_state()
            self._initialized = True

    def _require_initialized(self) -> None:
        if not self._initialized:
            raise RelayError("EDGE_RELAY_NOT_INITIALIZED", "initialize the GPIO adapter before commands")

    def _validate_outputs(self, outputs: HardwareOutputs) -> None:
        if outputs[0] == LOW and outputs[1] == LOW:
            raise RelayError("EDGE_RELAY_INTERLOCK", "CH1 and CH2 cannot conduct simultaneously")
        if outputs not in self._allowed:
            raise RelayError("EDGE_RELAY_STATE_FORBIDDEN", f"GPIO state {outputs!r} is not allowed for {self.profile}")

    async def _write(
        self,
        values: Mapping[str, int],
        *,
        allow_safe_transient: bool = False,
        force: bool = False,
    ) -> bool:
        by_pin: dict[int, int] = {}
        next_outputs = list(self._outputs)
        for name, value in values.items():
            if name not in PINS or isinstance(value, bool) or value not in (LOW, HIGH):
                raise RelayError("EDGE_RELAY_STATE_INVALID", f"invalid relay output {name}={value!r}")
            index = tuple(PINS.keys()).index(name)
            next_outputs[index] = value
            by_pin[PINS[name]] = value
        candidate = _outputs_from(next_outputs)
        try:
            self._validate_outputs(candidate)
        except RelayError:
            # The documented combined table describes stable states.  During
            # a break-before-make transition, CH1/CH2 both HIGH is
            # electrically safe even when it is not one of those stable rows.
            # Such a transient is allowed only by the two internal sequencers
            # below; arbitrary forbidden states remain rejected.
            # The only tolerated non-table transient is one with both branch
            # relays open.  CH3=HIGH alone is not enough: allowing that would
            # bypass the hard CH1/CH2 mutual-exclusion invariant.
            safe_transient = candidate[0] == HIGH and candidate[1] == HIGH
            if not allow_safe_transient or not safe_transient:
                raise
        if not by_pin:
            return False
        if candidate == self._outputs and not force:
            return False
        await self._run_gpio(lambda: self._gpio.write_many(by_pin))
        self._outputs = candidate
        return True

    async def _cut_locked(self, battery_id: str, *, check_electrical_gates: bool = False) -> bool:
        # CH4=LOW with CH3=HIGH is the combined profile's selected/master-OFF
        # state; it carries no load and must not become a guessed restore path.
        was_conducting = self._outputs[0] == LOW or self._outputs[1] == LOW
        if was_conducting and self._restore_outputs is None:
            self._restore_outputs = self._outputs
        # Canonical break sequence: CH1 + CH2 HIGH together, then wait >=50ms,
        # then CH3 HIGH.  A duplicate cut on an already-safe state performs no
        # GPIO call, preventing physical re-execution.
        if self._outputs[0] != HIGH or self._outputs[1] != HIGH or self._outputs[2] != HIGH:
            await self._write({"CH1": HIGH, "CH2": HIGH}, allow_safe_transient=True, force=True)
            await self._delay()
            gate_error: RelayError | None = None
            if check_electrical_gates and self.profile == "COMBINED_EXISTING_PARTS_V1":
                try:
                    await self._confirm_operational_gates(battery_id, self._target_mode or 1)
                except RelayError as exc:
                    # A failed manual check must not prevent the independent
                    # fail-safe CH3 cut below.  Re-raise after the hardware is
                    # in its safe state so the command remains uncommitted.
                    gate_error = exc
            await self._write({"CH3": HIGH})
            self._electrical_gate_verified = False
            # The master contact must also be fully open before CH4/source
            # selector work begins.  This is the second 50 ms boundary in the
            # documented combined-profile mode-switch sequence.
            await self._delay()
            self._electrical_gate_verified = check_electrical_gates and gate_error is None
            if gate_error is not None:
                raise gate_error
            return True
        if check_electrical_gates and self.profile == "COMBINED_EXISTING_PARTS_V1" and not self._electrical_gate_verified:
            await self._confirm_operational_gates(battery_id, self._target_mode or 1)
        elif not check_electrical_gates:
            self._electrical_gate_verified = False
        return False

    async def _confirm_gate(
        self,
        gate: SafetyGate | SourceChangeGate,
        battery_id: str,
        target_mode: int,
        *,
        name: str,
    ) -> None:
        try:
            decision = gate.confirm(battery_id, target_mode)
            if inspect.isawaitable(decision):
                decision = await decision
        except Exception as exc:
            raise RelayError(f"EDGE_{name.upper()}_GATE_FAILED", str(exc)) from exc
        if decision is not True:
            if name == "source":
                raise RelayError(
                    "EDGE_SOURCE_CHANGE_REQUIRED",
                    "physical source removal/isolation/attachment must be confirmed before selector or restore",
                )
            raise _deny_gate_for(name)

    async def _confirm_path_gates(self, battery_id: str, target_mode: int) -> None:
        """Require every manual gate before a combined profile path change.

        The source, INA226 current, and INA226 OVF checks are separate
        acknowledgements by design.  Keeping them separate prevents a caller
        from accidentally treating one broad "safe" flag as evidence for all
        physical conditions.
        """

        if self.profile != "COMBINED_EXISTING_PARTS_V1":
            return
        await self._confirm_gate(self._source_gate, battery_id, target_mode, name="source")
        await self._confirm_operational_gates(battery_id, target_mode)

    async def _confirm_operational_gates(self, battery_id: str, target_mode: int) -> None:
        """Require live electrical checks immediately before closing CH3."""

        if self.profile != "COMBINED_EXISTING_PARTS_V1":
            return
        await self._confirm_gate(self._current_gate, battery_id, target_mode, name="current")
        await self._confirm_gate(self._ovf_gate, battery_id, target_mode, name="ovf")
        self._electrical_gate_verified = True

    async def _select_mode_locked(self, battery_id: str, target_mode: int, *, require_gate: bool) -> bool:
        if target_mode not in (1, 2):
            raise RelayError("EDGE_MODE_INVALID", "target mode must be 1 or 2")
        if self.profile == "MODE1_EXTERNAL_CELL_V1" and target_mode != 1:
            raise RelayError("EDGE_MODE_NOT_SUPPORTED", "MODE1_EXTERNAL_CELL_V1 cannot select mode 2")
        desired_ch4 = HIGH if target_mode == 1 else LOW
        needs_selector = self._outputs[3] != desired_ch4 or not self._selector_ready
        if not needs_selector and not require_gate:
            return False
        if self._outputs[:3] != SAFE_OUTPUTS[:3]:
            raise RelayError("EDGE_SELECTOR_INTERLOCK", "CH1/CH2/CH3 must be HIGH before changing CH4")
        await self._confirm_path_gates(battery_id, target_mode)
        changed = await self._write({"CH4": desired_ch4})
        # The combined guide requires >=50ms after CH4 before master restore.
        await self._delay()
        self._selector_ready = True
        return changed

    def _restore_plan(self) -> HardwareOutputs:
        if self._restore_outputs is not None:
            return self._restore_outputs
        if self.profile == "MODE1_EXTERNAL_CELL_V1":
            return (HIGH, HIGH, LOW, HIGH)
        if self._target_mode == 2:
            return (HIGH, HIGH, LOW, LOW)
        raise RelayError(
            "EDGE_RESTORE_PATH_UNDEFINED",
            "combined mode 1 restore needs a previously observed charge/discharge path; no branch may be guessed",
        )

    async def _restore_locked(self, battery_id: str) -> bool:
        desired = self._restore_plan()
        self._validate_outputs(desired)
        changed = False
        if self.profile == "COMBINED_EXISTING_PARTS_V1":
            target_mode = self._target_mode
            if target_mode not in (1, 2):
                raise RelayError("EDGE_MODE_REQUIRED", "SESSION_STARTED must establish target mode before restore")
            desired_mode = 1 if desired[3] == HIGH else 2
            if desired_mode != target_mode:
                raise RelayError("EDGE_RESTORE_MODE_MISMATCH", "stored relay path does not match active target mode")
            changed = await self._select_mode_locked(
                battery_id,
                target_mode,
                require_gate=not self._selector_ready,
            ) or changed
            # CH3 is the common master.  Never close it without a fresh manual
            # current/OVF acknowledgement, even when CH4 is already selected.
            await self._confirm_operational_gates(battery_id, target_mode)
        # Keep branches open while enabling the master, then close at most one
        # branch.  CH1/CH2 are never written LOW together.
        changed = await self._write({"CH1": HIGH, "CH2": HIGH, "CH3": HIGH}) or changed
        # Apply the complete operational state in one low-level batch.  This
        # keeps the final state in the canonical table even though the GPIO
        # library writes its pins in order; master/branch ordering is safe in
        # either direction because the other side is open during the batch.
        desired_values = {"CH3": desired[2], "CH1": desired[0], "CH2": desired[1]}
        changed = await self._write(desired_values) or changed
        # Persist only after all physical writes succeed.  A combined-profile
        # mode-1 branch is never guessed: it must have been observed in
        # ``restore_outputs`` or restore fails closed above.
        self._outputs = _outputs_from(desired)
        self._persist_state()
        return changed

    async def relay_cut(self, battery_id: str, reason_code: str | None) -> RelayAction:
        async with self._lock:
            self._require_initialized()
            if self._active_battery_id not in (None, battery_id):
                # A late command for an old battery must not cut a new active
                # battery.  Backend/outbox ordering normally avoids this; the
                # guard is still required across Kafka partitions.
                self._interlocked_batteries.add(battery_id) if _is_safe_interlock_reason(reason_code) else None
                self._persist_state()
                return RelayAction(battery_id, "RELAY_CUT", False, True, self._outputs)
            changed = await self._cut_locked(battery_id)
            if _is_safe_interlock_reason(reason_code):
                self._interlocked_batteries.add(battery_id)
            self._persist_state()
            return RelayAction(battery_id, "RELAY_CUT", changed, not changed, self._outputs)

    async def relay_restore(self, battery_id: str) -> RelayAction:
        async with self._lock:
            self._require_initialized()
            if battery_id in self._interlocked_batteries:
                raise RelayError("EDGE_INTERLOCK_LOCKED", "automatic or safety cut is latched; restore cannot bypass the interlock")
            if self._active_battery_id != battery_id or self._active_session_id is None:
                raise RelayError("EDGE_RESTORE_NO_ACTIVE_SESSION", "restore requires the current active session for this battery")
            # ``CH4=LOW, CH3=HIGH`` is the documented combined mode-2
            # selected/master-OFF state, not an already-restored path.  Only
            # an active master (CH3=LOW) is a duplicate restore.
            if self._outputs[2] == LOW:
                return RelayAction(battery_id, "RELAY_RESTORE", False, True, self._outputs)
            changed = await self._restore_locked(battery_id)
            return RelayAction(battery_id, "RELAY_RESTORE", changed, not changed, self._outputs)

    async def session_started(self, session_id: str, battery_id: str, target_mode: int) -> RelayAction:
        async with self._lock:
            self._require_initialized()
            if target_mode not in (1, 2):
                raise RelayError("EDGE_MODE_INVALID", "target mode must be 1 or 2")
            if self.profile == "MODE1_EXTERNAL_CELL_V1" and target_mode != 1:
                raise RelayError("EDGE_MODE_NOT_SUPPORTED", "MODE1_EXTERNAL_CELL_V1 cannot select mode 2")
            if battery_id in self._interlocked_batteries:
                raise RelayError("EDGE_INTERLOCK_LOCKED", "session cannot start on an interlocked battery")
            previous_battery = self._active_battery_id
            previous_session = self._active_session_id
            previous_mode = self._target_mode
            changed = False
            if self._outputs != SAFE_OUTPUTS:
                changed = await self._cut_locked(
                    previous_battery or battery_id,
                    check_electrical_gates=self.profile == "COMBINED_EXISTING_PARTS_V1",
                ) or changed
            same_physical_source = previous_battery == battery_id and previous_mode == target_mode
            if self.profile == "COMBINED_EXISTING_PARTS_V1":
                changed = await self._select_mode_locked(
                    battery_id,
                    target_mode,
                    require_gate=not same_physical_source,
                ) or changed
            else:
                self._selector_ready = True
            self._active_session_id = session_id
            self._active_battery_id = battery_id
            self._target_mode = target_mode
            # A previous active path can be restored only for the same battery
            # and mode.  A new physical source starts closed until RESTORE.
            if not same_physical_source:
                self._restore_outputs = None
            self._outputs = _outputs_from(self._outputs)
            self._persist_state()
            return RelayAction(battery_id, "SESSION_STARTED", changed, False, self._outputs)

    async def session_ended(self, session_id: str, battery_id: str, end_reason: str) -> RelayAction:
        async with self._lock:
            self._require_initialized()
            if self._active_session_id != session_id or self._active_battery_id != battery_id:
                # A stale end event must never cut the current session's other
                # battery.  It is still a successful no-op at the command
                # boundary and gets its own durable identity.
                return RelayAction(battery_id, "SESSION_ENDED", False, True, self._outputs)
            changed = await self._cut_locked(battery_id)
            self._active_session_id = None
            self._active_battery_id = None
            self._restore_outputs = None
            self._selector_ready = False
            self._persist_state()
            return RelayAction(battery_id, "SESSION_ENDED", changed, not changed, self._outputs)

    async def clear_interlock(self, battery_id: str) -> None:
        """Explicit local operator action; no Kafka command calls this."""

        async with self._lock:
            self._require_initialized()
            self._interlocked_batteries.discard(battery_id)
            self._persist_state()

    async def shutdown(self) -> None:
        async with self._lock:
            if not self._initialized and not self._gpio_started:
                return
            first_error: BaseException | None = None
            try:
                await self._cut_locked(self._active_battery_id or "shutdown")
            except BaseException as exc:
                first_error = exc
            try:
                # Keep shutdown fail-closed even if the normal sequence threw.
                await self._run_gpio(lambda: self._gpio.write_many({pin: HIGH for pin in PINS.values()}))
                self._outputs = SAFE_OUTPUTS
                self._selector_ready = False
                # A failed startup must not overwrite the corrupt state that
                # caused it.  Normal shutdown persists the safe output and
                # the existing restore/session evidence.
                if self._initialized:
                    self._persist_state()
            except BaseException as exc:
                if first_error is None:
                    first_error = exc
            try:
                await self._run_gpio(self._gpio.close)
            except BaseException as exc:
                if first_error is None:
                    first_error = exc
            self._initialized = False
            self._gpio_started = False
            if first_error is not None:
                raise first_error
