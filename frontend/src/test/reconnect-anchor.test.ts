import { describe, expect, it } from "vitest";
import { requiresSnapshotAnchor } from "../realtime/useRealtime";
import { pageMeta } from "../components/Shell";

describe("WebSocket reconnect anchoring", () => {
  // A subscribe/resume whose afterCursor is not a real server cursor makes the
  // server replay its whole ring buffer (up to 10k events) instead of the gap
  // between the snapshot and the socket opening.
  it("re-anchors on a fresh snapshot when a resume has no cursor to resume from", () => {
    expect(requiresSnapshotAnchor("resume", null)).toBe(true);
  });

  it("resumes straight from a real cursor without refetching the snapshot", () => {
    expect(requiresSnapshotAnchor("resume", "306")).toBe(false);
  });

  it("always anchors the initial connect, cursor or not", () => {
    expect(requiresSnapshotAnchor("initial", null)).toBe(true);
    expect(requiresSnapshotAnchor("initial", "306")).toBe(true);
  });

  it("leaves resync alone because it refetches the snapshot itself", () => {
    expect(requiresSnapshotAnchor("resync", null)).toBe(false);
    expect(requiresSnapshotAnchor("resync", "306")).toBe(false);
  });
});

describe("settings page heading", () => {
  it("lists every settings tab in the shell subtitle", () => {
    const subtitle = pageMeta["/settings"][1];
    for (const tab of ["알림 수신", "계정 정보", "테마", "음성 안내"]) {
      expect(subtitle).toContain(tab);
    }
  });
});
