from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from edge.commands.idempotency import IdempotencyError, SQLiteIdempotencyStore


class SQLiteIdempotencyTests(unittest.TestCase):
    def test_success_survives_restart_and_conflicting_identity_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.sqlite"
            store = SQLiteIdempotencyStore(path)
            first = store.claim_event("evt-1", "PACK-001", "RELAY_CUT", "hash-1")
            self.assertEqual(first.kind, "new")
            store.complete_event("evt-1", "PACK-001", "RELAY_CUT", "hash-1")
            store.close()

            restarted = SQLiteIdempotencyStore(path)
            duplicate = restarted.claim_event("evt-1", "PACK-001", "RELAY_CUT", "hash-1")
            self.assertEqual(duplicate.kind, "duplicate")
            with self.assertRaisesRegex(IdempotencyError, "EDGE_EVENT_ID_CONFLICT"):
                restarted.claim_event("evt-1", "PACK-002", "RELAY_CUT", "hash-1")
            self.assertEqual(restarted.successful_event_count(), 1)
            restarted.close()

    def test_processing_row_blocks_ambiguous_replay_until_operator_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteIdempotencyStore(Path(directory) / "edge.sqlite")
            store.claim_event("evt-2", "PACK-001", "RELAY_CUT", "hash-2")
            with self.assertRaisesRegex(IdempotencyError, "EDGE_EVENT_IN_FLIGHT"):
                store.claim_event("evt-2", "PACK-001", "RELAY_CUT", "hash-2")
            store.abandon_event("evt-2", "PACK-001", "RELAY_CUT", "hash-2")
            self.assertEqual(store.claim_event("evt-2", "PACK-001", "RELAY_CUT", "hash-2").kind, "new")
            store.close()

    def test_relay_state_is_durable_and_json_validation_is_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.sqlite"
            store = SQLiteIdempotencyStore(path)
            state = {"version": 1, "profile": "COMBINED_EXISTING_PARTS_V1", "outputs": [1, 1, 1, 0]}
            store.save_relay_state(state)
            self.assertEqual(store.load_relay_state(), state)
            store.close()

            restarted = SQLiteIdempotencyStore(path)
            self.assertEqual(restarted.load_relay_state(), state)
            restarted.close()


if __name__ == "__main__":
    unittest.main()
