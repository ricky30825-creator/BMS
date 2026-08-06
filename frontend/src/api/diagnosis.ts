import type { Diagnosis } from "../types";

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
