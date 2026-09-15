// 도메인 타입과 상수. 저장소 구현체(memory/postgres)와 무관하므로 여기 둔다.

import type { PhaseWindow } from "../diagnosis/metrics.js";

export type DemoRole = "USER" | "ADMIN";
export type DemoStatus = "ACTIVE" | "SUSPENDED";
export type OpsStatus = "NORMAL" | "WATCH" | "BLOCKED";
export type RelayState = "CLOSED" | "OPEN";

export type AnomalyContribution = {
  feature: string;
  contribution: number;
};

/** A persisted inference result. `grade` remains a server-derived value. */
export type AnomalyScoreRecord = {
  deviceId: string;
  batteryId: string | null;
  sessionId: string | null;
  evaluatedAt: string;
  score: number;
  aeScore: number | null;
  informerScore: number | null;
  contributions: AnomalyContribution[] | null;
  modelVersion: string | null;
  tempKalman: number | null;
  tempCellEstimated: number | null;
};

export type DomainEventType = "ANOMALY_GRADE_CHANGED" | "RELAY_AUTO_CUT" | (string & {});
export type DomainEventSeverity = "NORMAL" | "CAUTION" | "WARNING" | "DANGER" | "CUT";
export type DomainEventSource = "SYSTEM" | "AI" | "INGEST" | "USER";

/** A durable domain event.  Human-readable copy is kept out of this type. */
export type DomainEvent = {
  id: string;
  eventType: DomainEventType;
  severity: DomainEventSeverity;
  source: DomainEventSource;
  deviceId: string | null;
  batteryId: string | null;
  sessionId: string | null;
  occurredAt: string;
  score: number | null;
  params: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  dedupeKey: string;
  createdAt: string;
};

export type RecordDomainEventInput = {
  /** Optional only for callers that need a stable externally visible id. */
  id?: string;
  eventType: DomainEventType;
  severity: DomainEventSeverity;
  source: DomainEventSource;
  deviceId?: string | null;
  batteryId?: string | null;
  sessionId?: string | null;
  occurredAt: string;
  score?: number | null;
  params?: Record<string, unknown>;
  dedupeKey: string;
};

export type DomainEventQuery = {
  ownerId?: string;
  batteryId?: string;
  deviceId?: string;
  eventType?: DomainEventType | DomainEventType[];
  severity?: DomainEventSeverity | DomainEventSeverity[];
  from?: string;
  to?: string;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
};

export type EventTrendPeriod = "24h" | "7d" | "30d";
export type AdminEventTrendBucket = {
  at: string;
  caution: number;
  warning: number;
  danger: number;
};

export type AdminEventTrend = {
  period: EventTrendPeriod;
  buckets: AdminEventTrendBucket[];
  summary: {
    total: number;
    dangerTotal: number;
    peakAt: string | null;
    peakTotal: number;
  };
};

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
    // No battery_latest row means the asset has not produced a sensor frame.
    // Keep every measurement field nullable so callers cannot mistake a
    // missing frame for a synthetic zero-valued reading.
    voltageV: number | null;
    currentA: number | null;
    powerW: number | null;
    tempContact: number | null;
    tempIrSurface: number | null;
    socPct: number | null;
    score: number | null;
    measuredAt: string | null;
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
  // 안전 판정 전용 최근 온도 창(시간으로 트리밍, 단계 무관) — QUICK·CAPACITY
  // 둘 다 매 tick 채운다. 등급용 P3 창(windows)과는 다른 목적이라 별도로
  // 둔다 — P3 창은 40초 구간에서만 차고, CAPACITY는 애초에 windows를 갱신
  // 하지 않는다(2026-09-02, 안전 계층이 CAPACITY에서 죽어 있던 결함 수정).
  tempTrail: { atMs: number; tempIrSurfaceC: number }[];
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
    battery.latest.measuredAt ?? "",
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
