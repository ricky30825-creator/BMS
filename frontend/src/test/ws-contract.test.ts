import { describe, expect, it } from "vitest";
import { buildPingMessage, buildResumeMessage, buildSubscribeMessage, sequenceIsNew } from "../realtime/useRealtime";

describe("WebSocket client contract", () => {
  it("wraps subscribe and resume fields inside the v1 payload envelope", () => {
    expect(buildSubscribeMessage("cursor-1042", "initial-1")).toEqual({
      v: 1,
      type: "subscribe",
      payload: { requestId: "initial-1", topics: ["metrics", "anomaly", "relay", "alert", "event", "session"], afterCursor: "cursor-1042" },
    });
    expect(buildResumeMessage("cursor-1042", "evt-1042", "resume-1")).toEqual({
      v: 1,
      type: "resume",
      payload: { requestId: "resume-1", topics: ["metrics", "anomaly", "relay", "alert", "event", "session"], afterCursor: "cursor-1042", lastEventId: "evt-1042" },
    });
  });

  it("keeps ping payload empty and does not move reconnect cursor fields to the top level", () => {
    const ping = buildPingMessage();
    expect(ping).toEqual({ v: 1, type: "ping", payload: {} });
    expect(Object.keys(ping)).toEqual(["v", "type", "payload"]);
    expect(sequenceIsNew("1043", "1042")).toBe(true);
    expect(sequenceIsNew("1041", "1042")).toBe(false);
  });
});
