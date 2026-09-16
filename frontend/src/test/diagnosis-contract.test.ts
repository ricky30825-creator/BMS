import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { buildCapacityDiagnosisBody, buildQuickDiagnosisBody, diagnosisCompletionIdsFromPoll } from "../api/diagnosis";
import { applyDiagnosisRealtimeEvent } from "../realtime/useRealtime";
import type { Diagnosis } from "../types";

describe("F21 diagnosis request contracts", () => {
  it("uses a nullable 1..4 SOC hint for quick diagnosis", () => {
    expect(buildQuickDiagnosisBody(3)).toEqual({ socHintLevel: 3, acknowledged: true });
    expect(buildQuickDiagnosisBody(null)).toEqual({ socHintLevel: null, acknowledged: true });
  });

  it("uses fullyChargedConfirmed for capacity diagnosis", () => {
    expect(buildCapacityDiagnosisBody(1, true)).toEqual({ dischargeCurrentA: 1, fullyChargedConfirmed: true, acknowledged: true });
    expect(buildCapacityDiagnosisBody(0.5, false)).toEqual({ dischargeCurrentA: 0.5, fullyChargedConfirmed: false, acknowledged: true });
    expect(buildCapacityDiagnosisBody(1, true)).not.toHaveProperty("fullyCharged");
  });

  it("detects a RUNNING diagnosis disappearing without treating it as a new id", () => {
    const running = { id: "dg-1", status: "RUNNING" } as Diagnosis;
    expect(diagnosisCompletionIdsFromPoll(null, running)).toEqual([]);
    expect(diagnosisCompletionIdsFromPoll("dg-1", null)).toEqual(["dg-1"]);
    expect(diagnosisCompletionIdsFromPoll("dg-1", { ...running, status: "ABORTED" })).toEqual(["dg-1"]);
  });

  it("deduplicates repeated websocket terminal events by diagnosis id", async () => {
    const queryClient = new QueryClient();
    const completed = { id: "dg-1", batteryId: "b-1", sessionId: "s-1", kind: "QUICK", status: "COMPLETED", startedAt: "2026-09-16T00:00:00Z", measuredAt: "2026-09-16T00:02:00Z", quick: { grade: "HEALTHY" } } satisfies Diagnosis;
    queryClient.setQueryData(["diagnosis"], { ...completed, status: "RUNNING" });
    queryClient.setQueryData(["diagnosis-detail", completed.id], completed);

    applyDiagnosisRealtimeEvent(queryClient, "diagnosis.done", completed);
    applyDiagnosisRealtimeEvent(queryClient, "diagnosis.done", completed);
    await vi.waitFor(() => expect(queryClient.getQueryData(["diagnosis-completion"])).toMatchObject({ diagnosisId: "dg-1", status: "COMPLETED" }));
    expect(queryClient.getQueryData(["diagnosis-completion-requested", "dg-1"])).toBe(true);
  });
});
