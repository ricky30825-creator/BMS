from __future__ import annotations

import json
import unittest

from edge.commands.contracts import (
    CommandContractError,
    event_id_from_headers,
    ensure_partition_key,
    parse_command,
    parse_json_payload,
    payload_fingerprint,
)


def command(code: str = "RELAY_CUT", params: dict[str, object] | None = None) -> dict[str, object]:
    if params is None:
        params = {"batteryId": "PACK-001", "reasonCode": "USER"}
    return {"version": 1, "code": code, "params": params}


class CommandContractTests(unittest.TestCase):
    def test_accepts_exact_v1_payloads_and_partition_key(self) -> None:
        payloads = [
            command(),
            command("RELAY_RESTORE", {"batteryId": "PACK-001"}),
            command("SESSION_STARTED", {"sessionId": "ses-1", "batteryId": "PACK-001", "targetMode": 2}),
            command("SESSION_ENDED", {"sessionId": "ses-1", "batteryId": "PACK-001", "endReason": "BLOCKED"}),
        ]
        for payload in payloads:
            parsed = parse_command(payload)
            self.assertEqual(parsed.version, 1)
            self.assertEqual(parsed.battery_id, "PACK-001")
            ensure_partition_key(parsed, b"PACK-001")
            self.assertEqual(payload_fingerprint(parsed), payload_fingerprint(parse_json_payload(json.dumps(payload))))

    def test_requires_durable_event_id_header_and_rejects_duplicates(self) -> None:
        self.assertEqual(event_id_from_headers([(b"x-cellguard-event-id", b"evt-1")]), "evt-1")
        self.assertEqual(event_id_from_headers({b"x-cellguard-event-id": b"evt-2"}), "evt-2")
        for headers in (None, [], [("x-cellguard-event-id", b"a"), ("x-cellguard-event-id", b"b")], {"other": b"x"}):
            with self.assertRaisesRegex(CommandContractError, "EDGE_EVENT_ID_REQUIRED"):
                event_id_from_headers(headers)
        for value in (b"", b" id", b"id ", b"\xff"):
            with self.assertRaises(CommandContractError):
                event_id_from_headers({"x-cellguard-event-id": value})

    def test_rejects_version_code_fields_and_key_mismatch(self) -> None:
        invalid_version = command()
        invalid_version["version"] = 2
        with self.assertRaisesRegex(CommandContractError, "EDGE_COMMAND_VERSION_UNSUPPORTED"):
            parse_command(invalid_version)

        invalid_code = command()
        invalid_code["code"] = ["RELAY_CUT"]
        with self.assertRaisesRegex(CommandContractError, "EDGE_COMMAND_CODE_UNSUPPORTED"):
            parse_command(invalid_code)

        unknown = command()
        unknown["event_id"] = "must-stay-in-header"
        with self.assertRaisesRegex(CommandContractError, "unknown fields: event_id"):
            parse_command(unknown)

        parsed = parse_command(command())
        with self.assertRaisesRegex(CommandContractError, "EDGE_PARTITION_KEY_MISMATCH"):
            ensure_partition_key(parsed, "PACK-002")

    def test_rejects_bad_json_and_command_values(self) -> None:
        with self.assertRaisesRegex(CommandContractError, "EDGE_INPUT_INVALID"):
            parse_json_payload(b"not-json")
        missing_reason = command(params={"batteryId": "PACK-001"})
        with self.assertRaisesRegex(CommandContractError, "missing fields: reasonCode"):
            parse_command(missing_reason)
        bad_mode = command("SESSION_STARTED", {"sessionId": "s", "batteryId": "b", "targetMode": True})
        with self.assertRaisesRegex(CommandContractError, "targetMode must be 1 or 2"):
            parse_command(bad_mode)


if __name__ == "__main__":
    unittest.main()
