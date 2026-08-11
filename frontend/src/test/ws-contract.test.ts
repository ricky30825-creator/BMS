import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { applyDiagnosisEvent, buildPingMessage, buildResumeMessage, buildSubscribeMessage, sequenceIsNew, socketUrlFor } from "../realtime/useRealtime";
import { applyAlertCreated, applyAnomalyGradeChanged, applyEventCreated } from "../realtime/useRealtime";
import type { Alert, BatteryEvent, Dashboard, Diagnosis, MeResponse } from "../types";

describe("WebSocket client contract", () => {
  it("URL-encodes the demo token only in the explicit demo transport", () => {
    const demoUrl = socketUrlFor("http://127.0.0.1:5173", "demo/token?one", true);
    expect(new URL(demoUrl).protocol).toBe("ws:");
    expect(new URL(demoUrl).searchParams.get("access_token")).toBe("demo/token?one");

    const productionUrl = socketUrlFor("https://cellguard.example", "demo/token?one", false);
    expect(new URL(productionUrl).protocol).toBe("wss:");
    expect(new URL(productionUrl).searchParams.has("access_token")).toBe(false);
  });

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

  it("updates alert caches and the unread me counter for alert.created", () => {
    const queryClient = new QueryClient();
    const me: MeResponse = { user: null, activeSession: null, unreadAlertCount: 2, activeAnomalyCount: 1, preferences: { theme: "light", lang: "ko" } };
    const alert: Alert = { id: "a1", severity: "DANGER", titleCode: "TEMP_THRESHOLD_EXCEEDED", batteryId: "b1", batteryLabel: "PACK-002", subjectType: "BATTERY", occurredAt: "2026-08-11T00:00:00Z", acknowledgedAt: null, channels: ["IN_APP"] };
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["alert-summary"], { unacknowledgedCount: 2, today: { DANGER: 1, WARNING: 0, NORMAL_OR_CHECK: 0 } });
    queryClient.setQueryData(["alerts", ""], { items: [], page: { number: 1, size: 20, total: 0, totalPages: 0 } });
    applyAlertCreated(queryClient, alert);
    expect(queryClient.getQueryData<{ items: Alert[] }>(["alerts", ""])?.items[0]).toEqual(alert);
    expect(queryClient.getQueryData<MeResponse>(["me"])?.unreadAlertCount).toBe(3);
    expect(queryClient.getQueryData<{ unacknowledgedCount: number; today: { DANGER: number } }>(["alert-summary"])?.today.DANGER).toBe(2);
  });

  it("invalidates event consumers and the me counter for event.created", () => {
    const queryClient = new QueryClient();
    const event: BatteryEvent = { id: "e1", occurredAt: "2026-08-11T00:00:00Z", type: "TEMP_THRESHOLD_EXCEEDED", batteryId: "b1", batteryLabel: "PACK-002", score: 0.8, grade: "DANGER", severity: "DANGER", source: "AI" };
    queryClient.setQueryData(["me"], { user: null, activeSession: null, unreadAlertCount: 0, activeAnomalyCount: 1, preferences: { theme: "light", lang: "ko" } } satisfies MeResponse);
    queryClient.setQueryData(["events", ""], { items: [event], page: { number: 1, size: 20, total: 1, totalPages: 1 } });
    applyEventCreated(queryClient, event);
    expect(queryClient.getQueryState(["events", ""])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["me"])?.isInvalidated).toBe(true);
  });

  it("updates the dashboard anomaly and active anomaly counter for anomaly.gradeChanged", () => {
    const queryClient = new QueryClient();
    const dashboard = { battery: { id: "b1" }, anomaly: { score: 0.2, grade: "NORMAL" } } as Dashboard;
    const me: MeResponse = { user: null, activeSession: null, unreadAlertCount: 0, activeAnomalyCount: 1, preferences: { theme: "light", lang: "ko" } };
    queryClient.setQueryData(["dashboard"], dashboard);
    queryClient.setQueryData(["me"], me);
    applyAnomalyGradeChanged(queryClient, { from: "NORMAL", to: "WARNING", score: 0.7, batteryId: "b1", batteryLabel: "PACK-002" });
    expect(queryClient.getQueryData<Dashboard>(["dashboard"])?.anomaly).toMatchObject({ score: 0.7, grade: "WARNING" });
    expect(queryClient.getQueryData<MeResponse>(["me"])?.activeAnomalyCount).toBe(2);
  });
});
