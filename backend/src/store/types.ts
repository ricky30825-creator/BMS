// 도메인 타입과 상수. 저장소 구현체(memory/postgres)와 무관하므로 여기 둔다.

import type { PhaseWindow } from "../diagnosis/metrics.js";

export type DemoRole = "USER" | "ADMIN";
export type DemoStatus = "ACTIVE" | "SUSPENDED";
export type OpsStatus = "NORMAL" | "WATCH" | "BLOCKED";
export type RelayState = "CLOSED" | "OPEN";

export type DemoUser = {
  id: string;
  email: string;
  name: string;
  role: DemoRole;
  status: DemoStatus;
  phone: string;
  joinedAt: string;
};

export type DemoBattery = {
  id: string;
  ownerId: string;
  label: string;
  model: string;
  maker: string | null;
  chemistry: "LI_ION" | "LI_PO";
  targetMode: 1 | 2;
  seriesCount: number | null;
  capacityWh: number | null;
  ratedOutputCurrentA: number | null;
  opsStatus: OpsStatus;
  memo: string;
  adminMemo: string;
  version: number;
  latest: {
    voltageV: number;
    currentA: number;
    powerW: number;
    tempContact: number | null;
    tempIrSurface: number | null;
    socPct: number | null;
    score: number;
    measuredAt: string;
  };
  mode1Health?: {
    designCapacityMah: number;
    fullChargeCapacityMah: number;
    cycleCount: number;
    rulCycles: number;
    internalResistanceMohm: number;
    calculatedAt: string;
  };
};

export type DemoSession = {
  id: string;
  batteryId: string;
  ownerId: string;
  deviceId: string;
  targetMode: 1 | 2;
  status: "ACTIVE" | "ENDED";
  endReason: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type DiagnosisProgress = {
  loadTargetA: number | null;
  loadActualA: number | null;
  partialMetrics: Record<string, number | boolean | null> | null;
  windows: PhaseWindow[];
  deliveredWh: number;
  vLightLoadV: number | null;
  // CAPACITY 브랜치가 실제 경과시간 델타로 Wh를 적산하는 데 쓴다 — 직전
  // tick의 elapsedMs. tickMs 고정폭을 매번 크레딧하면 타이머 드리프트·
  // 누락 tick이 여러 시간짜리 테스트에서 체계적으로 어긋난다(2026-09-01).
  lastElapsedMs: number | null;
};

export type DemoDiagnosis = {
  id: string;
  batteryId: string;
  sessionId: string;
  kind: "QUICK" | "CAPACITY";
  status: "RUNNING" | "COMPLETED" | "ABORTED" | "FAILED";
  phase: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  startedAt: string;
  estimatedEndAt: string | null;
  completedAt: string | null;           // 실제 완료 시각. measuredAt의 근거다
  progress: DiagnosisProgress | null;   // RUNNING 동안만 채워진다
};

export type DemoAudit = {
  id: string;
  actorId: string | null;
  action: string;
  resource: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  reason: string | null;
  at: string;
};

export type DemoRelay = {
  batteryId: string;
  state: RelayState;
  interlockEngaged: boolean;
  interlockCondition: string | null;
  reasonCode: string | null;
  reason: string | null;
  changedAt: string;
  changedBy: string;
};

export const INPUT_LIMITS = Object.freeze({ reasonChars: 500, memoChars: 2000 });

export const CSV_HEADER = "measured_at,device_id,battery_id,session_id,mode,voltage_v,current_a,power_w,temp_contact,temp_ir_surface,soc_pct,soc_basis,gas_raw,pressure_raw,acoustic_raw,age_ms";

export function csvRow(battery: DemoBattery, sessionId: string | null): string {
  return [
    battery.latest.measuredAt,
    "demo-device-01",
    battery.id,
    sessionId ?? "",
    battery.targetMode,
    battery.latest.voltageV,
    battery.latest.currentA,
    battery.latest.powerW,
    battery.latest.tempContact ?? "",
    battery.latest.tempIrSurface ?? "",
    battery.targetMode === 2 ? "" : battery.latest.socPct,
    battery.targetMode === 2 ? "" : "ABSOLUTE_GAUGE",
    "",
    "",
    "",
    ""
  ].join(",");
}
