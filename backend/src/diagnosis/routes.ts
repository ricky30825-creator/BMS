// 진단 응답 직렬화. 계약서 §4.13의 Diagnosis 객체 형태를 만든다.
// server.ts가 1200줄을 넘어 이 헬퍼만 분리했다 — 라우트 등록은 server.ts에 남는다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

export function diagnosisJson(diagnosis: DemoDiagnosis, battery: DemoBattery | undefined) {
  const result = diagnosis.result ?? {};
  const progress = diagnosis.progress;
  return {
    id: diagnosis.id,
    batteryId: diagnosis.batteryId,
    batteryLabel: battery?.label,
    sessionId: diagnosis.sessionId,
    kind: diagnosis.kind,
    status: diagnosis.status,
    phase: diagnosis.phase,
    confidence: diagnosis.kind === "QUICK" ? "LOW" : diagnosis.status === "COMPLETED" ? "HIGH" : undefined,
    startedAt: diagnosis.startedAt,
    estimatedEndAt: diagnosis.estimatedEndAt,
    measuredAt: diagnosis.completedAt ?? undefined,
    loadTargetA: progress?.loadTargetA ?? null,
    loadActualA: progress?.loadActualA ?? null,
    socHintLevel: typeof diagnosis.input.socHintLevel === "number" ? diagnosis.input.socHintLevel : null,
    abortReason: typeof result.abortReason === "string" ? result.abortReason : null,
    partialMetrics: progress?.partialMetrics ?? null,
    dataSource: typeof result.dataSource === "string" ? result.dataSource : null,
    result: diagnosis.result,
    quick: (result.quick as Record<string, unknown> | null | undefined) ?? null,
    capacity: (result.capacity as Record<string, unknown> | null | undefined) ?? null,
  };
}
