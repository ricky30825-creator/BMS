import type { QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Diagnosis } from "../types";

export type DiagnosisCompletionNotice = {
  diagnosisId: string;
  source: "websocket" | "poll";
  status: Exclude<Diagnosis["status"], "RUNNING"> | "UNAVAILABLE";
};

export function diagnosisCompletionIdsFromPoll(previousRunningId: string | null, current: Diagnosis | null | undefined): string[] {
  const endingIds = new Set<string>();
  if (previousRunningId && (current?.id !== previousRunningId || current.status !== "RUNNING")) endingIds.add(previousRunningId);
  if (current?.id && current.status !== "RUNNING") endingIds.add(current.id);
  return [...endingIds];
}

export function announceDiagnosisCompletion(queryClient: QueryClient, diagnosisId: string, source: DiagnosisCompletionNotice["source"]): boolean {
  const requestedKey = ["diagnosis-completion-requested", diagnosisId] as const;
  if (!diagnosisId || queryClient.getQueryData<boolean>(requestedKey)) return false;
  queryClient.setQueryData(requestedKey, true);

  void queryClient.fetchQuery({
    queryKey: ["diagnosis-detail", diagnosisId],
    queryFn: () => api.get<Diagnosis>(`/api/diagnoses/${diagnosisId}`),
    staleTime: 30_000,
  }).then((diagnosis) => {
    queryClient.setQueryData(["diagnosis-detail", diagnosisId], diagnosis);
    void queryClient.invalidateQueries({ queryKey: ["diagnosis-history"] });
    if (diagnosis.status === "RUNNING") return;
    const notice: DiagnosisCompletionNotice = { diagnosisId, source, status: diagnosis.status };
    queryClient.setQueryData<DiagnosisCompletionNotice>(["diagnosis-completion"] as const, () => notice);
  }).catch(() => {
    const notice: DiagnosisCompletionNotice = { diagnosisId, source, status: "UNAVAILABLE" };
    queryClient.setQueryData<DiagnosisCompletionNotice>(["diagnosis-completion"] as const, () => notice);
  });

  return true;
}

export type SocHintLevel = 1 | 2 | 3 | 4;

export function buildQuickDiagnosisBody(socHintLevel: SocHintLevel | null): { socHintLevel: SocHintLevel | null; acknowledged: true } {
  return { socHintLevel, acknowledged: true };
}

export function buildCapacityDiagnosisBody(dischargeCurrentA: number, fullyChargedConfirmed: boolean): { dischargeCurrentA: number; fullyChargedConfirmed: boolean; acknowledged: true } {
  return { dischargeCurrentA, fullyChargedConfirmed, acknowledged: true };
}

export function diagnosisSummary(diagnosis: Diagnosis): string {
  if (diagnosis.kind === "QUICK") {
    const grade = diagnosis.quick?.grade ?? "결과 대기";
    return `빠른 진단 · ${grade}`;
  }
  const soh = diagnosis.capacity?.sohRelPct;
  return `정밀 용량 · ${soh == null ? "결과 대기" : `${soh.toFixed(1)}%`}`;
}
