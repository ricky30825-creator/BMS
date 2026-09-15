from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from edge.commands.idempotency import SQLiteIdempotencyStore
from edge.commands.relay import HIGH, LOW, GpioRelayAdapter, RelayError, SAFE_OUTPUTS


class RecordingGpio:
    def __init__(self) -> None:
        self.setup_calls: list[tuple[int, int]] = []
        self.writes: list[dict[int, int]] = []
        self.closed = False

    def setup_output(self, pin: int, initial: int) -> None:
        self.setup_calls.append((pin, initial))

    def write_many(self, values: dict[int, int]) -> None:
        self.writes.append(dict(values))

    def close(self) -> None:
        self.closed = True


class Gate:
    def __init__(self, decision: bool = True) -> None:
        self.decision = decision
        self.calls: list[tuple[str, int]] = []

    def confirm(self, battery_id: str, target_mode: int) -> bool:
        self.calls.append((battery_id, target_mode))
        return self.decision


class RelayAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_startup_is_all_high_and_cut_is_not_physically_repeated(self) -> None:
        gpio = RecordingGpio()
        delays: list[float] = []
        adapter = GpioRelayAdapter(
            "MODE1_EXTERNAL_CELL_V1",
            gpio,
            sleep_fn=delays.append,
        )
        await adapter.initialize()
        self.assertEqual(adapter.outputs, SAFE_OUTPUTS)
        self.assertEqual(gpio.setup_calls, [(5, HIGH), (6, HIGH), (13, HIGH), (19, HIGH)])
        self.assertEqual(gpio.writes[0], {5: HIGH, 6: HIGH, 13: HIGH, 19: HIGH})

        await adapter.session_started("ses-1", "PACK-001", 1)
        await adapter.relay_restore("PACK-001")
        self.assertEqual(adapter.outputs, (HIGH, HIGH, LOW, HIGH))
        before_cut = len(gpio.writes)
        first = await adapter.relay_cut("PACK-001", "USER")
        after_first = len(gpio.writes)
        second = await adapter.relay_cut("PACK-001", "USER")
        self.assertTrue(first.changed)
        self.assertFalse(second.changed)
        self.assertEqual(len(gpio.writes), after_first)
        self.assertEqual(adapter.outputs, SAFE_OUTPUTS)
        self.assertGreaterEqual(len(delays), 1)
        self.assertTrue(all(delay >= 0.05 for delay in delays))
        self.assertGreater(after_first, before_cut)
        await adapter.shutdown()
        self.assertTrue(gpio.closed)

    async def test_combined_profile_enforces_allowed_states_and_three_manual_gates(self) -> None:
        gpio = RecordingGpio()
        source = Gate()
        current = Gate()
        ovf = Gate()
        adapter = GpioRelayAdapter(
            "COMBINED_EXISTING_PARTS_V1",
            gpio,
            source_gate=source,
            current_gate=current,
            ovf_gate=ovf,
            sleep_fn=lambda _seconds: None,
        )
        await adapter.initialize()
        await adapter.session_started("ses-1", "PACK-001", 2)
        self.assertEqual(adapter.outputs, (HIGH, HIGH, HIGH, LOW))
        self.assertEqual(len(source.calls), 1)
        self.assertEqual(len(current.calls), 1)
        self.assertEqual(len(ovf.calls), 1)

        await adapter.relay_restore("PACK-001")
        self.assertEqual(adapter.outputs, (HIGH, HIGH, LOW, LOW))
        self.assertGreaterEqual(len(current.calls), 2)
        self.assertGreaterEqual(len(ovf.calls), 2)
        with self.assertRaisesRegex(RelayError, "EDGE_RELAY_INTERLOCK"):
            adapter._validate_outputs((LOW, LOW, LOW, LOW))
        with self.assertRaisesRegex(RelayError, "EDGE_RELAY_INTERLOCK"):
            await adapter._write({"CH1": LOW, "CH2": LOW}, allow_safe_transient=True)
        await adapter.relay_cut("PACK-001", "FAILSAFE_GAS")
        with self.assertRaisesRegex(RelayError, "EDGE_INTERLOCK_LOCKED"):
            await adapter.relay_restore("PACK-001")
        await adapter.shutdown()

    async def test_missing_current_or_ovf_gate_denies_before_selector_write(self) -> None:
        for missing in ("current", "ovf"):
            gpio = RecordingGpio()
            source = Gate()
            current = Gate(decision=missing != "current")
            ovf = Gate(decision=missing != "ovf")
            adapter = GpioRelayAdapter(
                "COMBINED_EXISTING_PARTS_V1",
                gpio,
                source_gate=source,
                current_gate=current,
                ovf_gate=ovf,
                sleep_fn=lambda _seconds: None,
            )
            await adapter.initialize()
            with self.assertRaisesRegex(RelayError, f"EDGE_{missing.upper()}_GATE_REQUIRED"):
                await adapter.session_started("ses-1", "PACK-001", 2)
            self.assertEqual(adapter.outputs, SAFE_OUTPUTS)
            # setup's all-HIGH write is the only write; CH4 was not selected.
            self.assertEqual(len(gpio.writes), 1)
            await adapter.shutdown()

    async def test_mode_switch_cuts_branches_before_master_and_selector(self) -> None:
        gpio = RecordingGpio()
        source = Gate()
        current = Gate()
        ovf = Gate()
        adapter = GpioRelayAdapter(
            "COMBINED_EXISTING_PARTS_V1",
            gpio,
            source_gate=source,
            current_gate=current,
            ovf_gate=ovf,
            sleep_fn=lambda _seconds: None,
        )
        await adapter.initialize()
        await adapter.session_started("ses-1", "PACK-001", 2)
        await adapter.relay_restore("PACK-001")
        before = len(gpio.writes)
        await adapter.session_started("ses-2", "PACK-001", 1)
        transition = gpio.writes[before:]
        # The first transition write raises CH1/CH2 together, followed by the
        # master cut, then CH4 selection. No stable state has CH1+CH2 LOW.
        self.assertEqual(transition[0], {5: HIGH, 6: HIGH})
        self.assertIn(13, transition[1])
        self.assertIn(19, transition[-1])
        self.assertEqual(adapter.outputs, (HIGH, HIGH, HIGH, HIGH))
        await adapter.shutdown()

    async def test_relay_state_survives_restart_without_claiming_physical_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            first = GpioRelayAdapter(
                "COMBINED_EXISTING_PARTS_V1",
                RecordingGpio(),
                store,
                source_gate=Gate(),
                current_gate=Gate(),
                ovf_gate=Gate(),
                sleep_fn=lambda _seconds: None,
            )
            await first.initialize()
            await first.session_started("ses-1", "PACK-001", 2)
            await first.relay_restore("PACK-001")
            await first.shutdown()

            gpio = RecordingGpio()
            restarted = GpioRelayAdapter(
                "COMBINED_EXISTING_PARTS_V1",
                gpio,
                store,
                source_gate=Gate(),
                current_gate=Gate(),
                ovf_gate=Gate(),
                sleep_fn=lambda _seconds: None,
            )
            await restarted.initialize()
            self.assertEqual(restarted.outputs, SAFE_OUTPUTS)
            self.assertEqual(restarted.interlocked_batteries, frozenset())
            await restarted.relay_restore("PACK-001")
            self.assertEqual(restarted.outputs, (HIGH, HIGH, LOW, LOW))
            await restarted.shutdown()
            store.close()


if __name__ == "__main__":
    unittest.main()
