import { describe, expect, it } from "vitest";
import { applyDiagnosisEvent, buildPingMessage, buildResumeMessage, buildSubscribeMessage, sequenceIsNew } from "../realtime/useRealtime";
import type { Diagnosis } from "../types";

describe("WebSocket client contract", () => {
  it("wraps subscribe and resume fields inside the v1 payload envelope", () => {
    expect(buildSubscribeMessage("cursor-1042", "initial-1")).toEqual({
      v: 1,
      type: "subscribe",
      payload: { requestId: "initial-1", topics: ["metrics", "anomaly", "relay", "alert", "event", "session", "diagnosis"], afterCursor: "cursor-1042" },
    });
    expect(buildResumeMessage("cursor-1042", "evt-1042", "resume-1")).toEqual({
      v: 1,
      type: "resume",
      payload: { requestId: "resume-1", topics: ["metrics", "anomaly", "relay", "alert", "event", "session", "diagnosis"], afterCursor: "cursor-1042", lastEventId: "evt-1042" },
    });
  });

  it("applies diagnosis progress, completion, and abort payloads", () => {
    const running = { id: "dg-1", batteryId: "b-1", sessionId: "s-1", kind: "QUICK", status: "RUNNING", phase: "P0", startedAt: "2026-08-06T00:00:00Z" } satisfies Diagnosis;
    expect(applyDiagnosisEvent(running, "diagnosis.progress", { id: "dg-1", phase: "P3", loadActualA: 1.47 })).toMatchObject({ status: "RUNNING", phase: "P3", loadActualA: 1.47 });
    expect(applyDiagnosisEvent(running, "diagnosis.aborted", { id: "dg-1", abortReason: "TEMP_ABSOLUTE" })).toMatchObject({ status: "ABORTED", abortReason: "TEMP_ABSOLUTE" });
    const completed = { ...running, status: "COMPLETED", measuredAt: "2026-08-06T00:02:00Z" } satisfies Diagnosis;
    expect(applyDiagnosisEvent(running, "diagnosis.done", completed)).toEqual(completed);
  });

  it("keeps ping payload empty and does not move reconnect cursor fields to the top level", () => {
    const ping = buildPingMessage();
    expect(ping).toEqual({ v: 1, type: "ping", payload: {} });
    expect(Object.keys(ping)).toEqual(["v", "type", "payload"]);
    expect(sequenceIsNew("1043", "1042")).toBe(true);
    expect(sequenceIsNew("1041", "1042")).toBe(false);
  });
});
