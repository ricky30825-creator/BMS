import { createHash, randomUUID } from "node:crypto";

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

export const F21_THRESHOLDS = Object.freeze({
  configured: false,
  thermalSlopeCPerMin: 0,
  surfaceCutoffC: 0,
  efficiency: 0,
  minimumLoadA: 0,
  autoCutSeconds: 0
});

export const INPUT_LIMITS = Object.freeze({ reasonChars: 500, memoChars: 2000 });

function normalizeReason(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error("REASON_REQUIRED");
  if (normalized.length > INPUT_LIMITS.reasonChars) throw new Error("INPUT_TOO_LONG");
  return normalized;
}

function normalizeMemo(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > INPUT_LIMITS.memoChars) throw new Error("INPUT_TOO_LONG");
  return normalized;
}

function isoNow(): string {
  return new Date().toISOString();
}

function makeBattery(input: Omit<DemoBattery, "version" | "adminMemo" | "memo"> & { memo?: string }): DemoBattery {
  return { ...input, memo: input.memo ?? "", version: 0, adminMemo: "" };
}

export const demoUsers: DemoUser[] = [
  { id: "hong", email: "hong@cellguard.io", name: "홍길동", role: "USER", status: "ACTIVE", phone: "010-1234-5678", joinedAt: "2025-03-12T00:00:00.000Z" },
  { id: "kimeng", email: "kim@lab.io", name: "김엔지", role: "USER", status: "ACTIVE", phone: "010-2345-6789", joinedAt: "2024-11-02T00:00:00.000Z" },
  { id: "leelab", email: "lee@lab.io", name: "이연구", role: "ADMIN", status: "ACTIVE", phone: "010-3456-7890", joinedAt: "2024-08-19T00:00:00.000Z" },
  { id: "parktest", email: "park@test.io", name: "박테스트", role: "USER", status: "SUSPENDED", phone: "010-4567-8901", joinedAt: "2025-06-10T00:00:00.000Z" }
];

const demoBatteries: DemoBattery[] = [
  makeBattery({ id: "PACK-001", ownerId: "hong", label: "PACK-001", model: "18650 Li-ion · 3S", maker: "Samsung SDI", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "BLOCKED", latest: { voltageV: 11.9, currentA: -2.4, powerW: -28.56, tempContact: 58, tempIrSurface: 56.4, socPct: 78, score: 0.82, measuredAt: "2026-08-06T01:32:10.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2760, cycleCount: 312, rulCycles: 480, internalResistanceMohm: 18.4, calculatedAt: "2026-08-06T00:00:00.000Z" } }),
  makeBattery({ id: "PACK-002", ownerId: "leelab", label: "PACK-002", model: "18650 Li-ion · 3S", maker: "Samsung SDI", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: { voltageV: 11.4, currentA: -1.6, powerW: -18.24, tempContact: 29, tempIrSurface: 30.2, socPct: 91, score: 0.18, measuredAt: "2026-08-06T01:30:00.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2820, cycleCount: 88, rulCycles: 560, internalResistanceMohm: 16.2, calculatedAt: "2026-08-06T00:00:00.000Z" } }),
  makeBattery({ id: "PACK-003", ownerId: "leelab", label: "PACK-003", model: "USB 보조배터리 · 37Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "WATCH", latest: { voltageV: 5.1, currentA: -1.2, powerW: -6.12, tempContact: null, tempIrSurface: 34, socPct: 64, score: 0.33, measuredAt: "2026-08-06T01:29:00.000Z" } }),
  makeBattery({ id: "PACK-004", ownerId: "kimeng", label: "PACK-004", model: "USB 보조배터리 · 37Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "WATCH", latest: { voltageV: 5, currentA: -1.9, powerW: -9.5, tempContact: null, tempIrSurface: 47, socPct: 47, score: 0.58, measuredAt: "2026-08-06T01:28:00.000Z" } }),
  makeBattery({ id: "PACK-005", ownerId: "parktest", label: "PACK-005", model: "USB 보조배터리 · 10Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 10, ratedOutputCurrentA: 1, opsStatus: "NORMAL", latest: { voltageV: 5.1, currentA: 0.8, powerW: 4.08, tempContact: null, tempIrSurface: 31, socPct: 82, score: 0.24, measuredAt: "2026-08-06T01:27:00.000Z" } }),
  makeBattery({ id: "DEMO-PACK-001", ownerId: "hong", label: "DEMO-PACK-001", model: "Demo bench pack · safe fixture", maker: "CellGuard Lab", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: { voltageV: 11.9, currentA: -2.4, powerW: -28.56, tempContact: 31.2, tempIrSurface: 30.4, socPct: 78, score: 0.18, measuredAt: "2026-08-06T01:31:00.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2760, cycleCount: 12, rulCycles: 900, internalResistanceMohm: 18.4, calculatedAt: "2026-08-06T01:30:00.000Z" } })
];

const demoSessions = new Map<string, DemoSession>();
const demoRelays = new Map<string, DemoRelay>();
const demoDiagnoses = new Map<string, DemoDiagnosis>();
const demoAudits: DemoAudit[] = [];
const idempotency = new Map<string, { hash: string; status: number; body: unknown }>();

for (const battery of demoBatteries) {
  demoRelays.set(battery.id, {
    batteryId: battery.id,
    state: battery.opsStatus === "BLOCKED" ? "OPEN" : "CLOSED",
    interlockEngaged: battery.opsStatus === "BLOCKED",
    interlockCondition: battery.opsStatus === "BLOCKED" ? "TEMP_OVER_CAP" : null,
    reasonCode: battery.opsStatus === "BLOCKED" ? "FAILSAFE_TEMP_IR_OVER_CAP" : null,
    reason: null,
    changedAt: battery.latest.measuredAt,
    changedBy: "SYSTEM"
  });
}

export function userById(id: string): DemoUser | undefined { return demoUsers.find((user) => user.id === id); }
export function batteryById(id: string): DemoBattery | undefined { return demoBatteries.find((battery) => battery.id === id); }
export function users(): DemoUser[] { return demoUsers.map((user) => ({ ...user })); }
export function batteries(ownerId?: string): DemoBattery[] { return demoBatteries.filter((battery) => !ownerId || battery.ownerId === ownerId).map((battery) => ({ ...battery })); }
export function activeSession(ownerId?: string): DemoSession | null { return [...demoSessions.values()].find((session) => session.status === "ACTIVE" && (!ownerId || session.ownerId === ownerId)) ?? null; }
export function sessionsForBattery(batteryId: string): DemoSession[] { return [...demoSessions.values()].filter((session) => session.batteryId === batteryId).map((session) => ({ ...session })); }
export function sessionById(id: string): DemoSession | undefined { const session = demoSessions.get(id); return session ? { ...session } : undefined; }
export function activeDiagnosis(batteryId?: string): DemoDiagnosis | null { return [...demoDiagnoses.values()].find((diagnosis) => diagnosis.status === "RUNNING" && (!batteryId || diagnosis.batteryId === batteryId)) ?? null; }
export function diagnosesForBattery(batteryId: string): DemoDiagnosis[] { return [...demoDiagnoses.values()].filter((diagnosis) => diagnosis.batteryId === batteryId).map((diagnosis) => ({ ...diagnosis })); }
export function diagnosisById(id: string): DemoDiagnosis | undefined { const diagnosis = demoDiagnoses.get(id); return diagnosis ? { ...diagnosis } : undefined; }
export function relayByBattery(id: string): DemoRelay { return { ...(demoRelays.get(id) ?? { batteryId: id, state: "CLOSED", interlockEngaged: false, interlockCondition: null, reasonCode: null, reason: null, changedAt: isoNow(), changedBy: "SYSTEM" }) }; }
export function audits(): DemoAudit[] { return demoAudits.map((audit) => ({ ...audit })); }

export function createBattery(ownerId: string, input: { label: string; maker?: string | null; model?: string | null; targetMode: 1 | 2; chemistry: "LI_ION" | "LI_PO"; seriesCount?: number | null; capacityWh?: number | null; ratedOutputCurrentA?: number | null }): DemoBattery {
  const label = input.label.normalize("NFKC").trim();
  if (!label) throw new Error("BATTERY_NAME_REQUIRED");
  if (label.length > 120) throw new Error("INPUT_TOO_LONG");
  if (input.targetMode === 2 && !(Number(input.capacityWh) > 0)) throw new Error("CAPACITY_REQUIRED");
  if (input.targetMode === 2 && !(Number(input.ratedOutputCurrentA) > 0)) throw new Error("RATED_CURRENT_REQUIRED");
  const battery = makeBattery({
    id: `bat_${randomUUID()}`,
    ownerId,
    label,
    model: input.model?.normalize("NFKC").trim() || "",
    maker: input.maker?.normalize("NFKC").trim() || null,
    chemistry: input.chemistry,
    targetMode: input.targetMode,
    seriesCount: input.targetMode === 1 ? input.seriesCount ?? null : null,
    capacityWh: input.capacityWh ?? null,
    ratedOutputCurrentA: input.ratedOutputCurrentA ?? null,
    opsStatus: "NORMAL",
    memo: "",
    latest: { voltageV: 0, currentA: 0, powerW: 0, tempContact: null, tempIrSurface: null, socPct: null, score: 0, measuredAt: isoNow() }
  });
  demoBatteries.push(battery);
  demoRelays.set(battery.id, { batteryId: battery.id, state: "CLOSED", interlockEngaged: false, interlockCondition: null, reasonCode: null, reason: null, changedAt: battery.latest.measuredAt, changedBy: "SYSTEM" });
  return { ...battery };
}

export function updateBattery(ownerId: string, batteryId: string, input: { label?: string; maker?: string | null; model?: string | null; seriesCount?: number | null; memo?: string }): DemoBattery {
  const battery = demoBatteries.find((item) => item.id === batteryId && item.ownerId === ownerId);
  if (!battery) throw new Error("NOT_FOUND");
  if (input.label !== undefined) {
    const label = input.label.normalize("NFKC").trim();
    if (!label) throw new Error("BATTERY_NAME_REQUIRED");
    if (label.length > 120) throw new Error("INPUT_TOO_LONG");
    battery.label = label;
  }
  if (input.maker !== undefined) battery.maker = input.maker?.normalize("NFKC").trim() || null;
  if (input.model !== undefined) battery.model = input.model?.normalize("NFKC").trim() || "";
  if (input.seriesCount !== undefined) battery.seriesCount = input.seriesCount;
  if (input.memo !== undefined) battery.memo = normalizeMemo(input.memo);
  return { ...battery };
}

export function recordAudit(input: Omit<DemoAudit, "id" | "at">): DemoAudit {
  const audit = { ...input, id: `audit_${randomUUID()}`, at: isoNow() };
  demoAudits.unshift(audit);
  return audit;
}

export function idempotent(actorId: string, key: string, body: unknown): { kind: "new" | "replay" | "conflict"; status?: number; body?: unknown } {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const mapKey = `${actorId}:${key}`;
  const previous = idempotency.get(mapKey);
  if (!previous) return { kind: "new" };
  if (previous.hash !== hash) return { kind: "conflict" };
  return { kind: "replay", status: previous.status, body: previous.body };
}

export function rememberIdempotency(actorId: string, key: string, body: unknown, status: number, response: unknown): void {
  idempotency.set(`${actorId}:${key}`, { hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"), status, body: response });
}

export function startSession(ownerId: string, batteryId: string): DemoSession {
  const battery = batteryById(batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  if (battery.opsStatus === "BLOCKED") throw new Error("BATTERY_BLOCKED");
  // The physical interlock permits one active battery and one active session
  // for the whole installation, not one session per user.
  const current = activeSession();
  if (current) {
    current.status = "ENDED";
    current.endReason = "SUPERSEDED";
    current.endedAt = isoNow();
    recordAudit({ actorId: ownerId, action: "SESSION_AUTO_END", resource: current.id, result: "SUCCESS", reason: "SUPERSEDED" });
  }
  const session: DemoSession = { id: `ses_${randomUUID()}`, batteryId, ownerId, deviceId: "demo-device-01", targetMode: battery.targetMode, status: "ACTIVE", endReason: null, startedAt: isoNow(), endedAt: null };
  demoSessions.set(session.id, session);
  return { ...session };
}

export function changeOpsStatus(actorId: string, batteryId: string, next: OpsStatus, reason: string, expectedVersion?: number): DemoBattery {
  const battery = demoBatteries.find((item) => item.id === batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  if (battery.opsStatus === next) throw new Error("NO_STATUS_CHANGE");
  const normalizedReason = normalizeReason(reason);
  if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
  battery.opsStatus = next;
  battery.version += 1;
  recordAudit({ actorId, action: "BATTERY_OPS_STATUS_CHANGE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
  if (next === "BLOCKED") {
    const session = activeSession(battery.ownerId);
    if (session && session.batteryId === batteryId) {
      session.status = "ENDED";
      session.endReason = "BLOCKED";
      session.endedAt = isoNow();
      recordAudit({ actorId: "SYSTEM", action: "SESSION_AUTO_END", resource: session.id, result: "SUCCESS", reason: "BLOCKED" });
    }
  }
  return { ...battery };
}

export function saveMemo(actorId: string, batteryId: string, memo: string, expectedVersion?: number): DemoBattery {
  const battery = demoBatteries.find((item) => item.id === batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
  battery.adminMemo = normalizeMemo(memo);
  battery.version += 1;
  recordAudit({ actorId, action: "BATTERY_MEMO_UPDATE", resource: batteryId, result: "SUCCESS", reason: null });
  return { ...battery };
}

export function changeUserStatus(actorId: string, userId: string, status: DemoStatus, reason: string): DemoUser {
  const user = userById(userId);
  if (!user) throw new Error("NOT_FOUND");
  const normalizedReason = normalizeReason(reason);
  if (actorId === userId && status === "SUSPENDED") throw new Error("SELF_SUSPEND_FORBIDDEN");
  if (user.status === status) throw new Error("NO_STATUS_CHANGE");
  user.status = status;
  recordAudit({ actorId, action: status === "SUSPENDED" ? "USER_SUSPEND" : "USER_RESTORE", resource: userId, result: "SUCCESS", reason: normalizedReason });
  return { ...user };
}

export function changeRelay(actorId: string, batteryId: string, action: "cut" | "restore", reason: string): DemoRelay {
  const battery = batteryById(batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  const normalizedReason = normalizeReason(reason);
  const current = relayByBattery(batteryId);
  if (action === "restore" && current.interlockEngaged) throw new Error("INTERLOCK_LOCKED");
  const next: DemoRelay = {
    ...current,
    state: action === "cut" ? "OPEN" : "CLOSED",
    changedAt: isoNow(),
    changedBy: actorId,
    reason: normalizedReason,
    interlockEngaged: action === "cut" ? current.interlockEngaged : false,
    interlockCondition: action === "cut" ? current.interlockCondition : null,
    reasonCode: action === "cut" ? current.reasonCode : null
  };
  demoRelays.set(batteryId, next);
  recordAudit({ actorId, action: action === "cut" ? "RELAY_CUT" : "RELAY_RESTORE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
  return { ...next };
}

export function startDiagnosis(ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): DemoDiagnosis {
  const battery = batteryById(batteryId);
  const session = activeSession(ownerId);
  if (!battery || !session || session.batteryId !== batteryId) throw new Error("NO_ACTIVE_SESSION");
  if (battery.targetMode !== 2) throw new Error("MODE_NOT_SUPPORTED");
  if (!F21_THRESHOLDS.configured) throw new Error("SAFETY_PROFILE_NOT_READY");
  if (activeDiagnosis(batteryId)) throw new Error("DIAGNOSIS_IN_PROGRESS");
  const diagnosis: DemoDiagnosis = { id: `dg_${randomUUID()}`, batteryId, sessionId: session.id, kind, status: "RUNNING", phase: kind === "QUICK" ? "P0" : "CAPACITY", input, result: null, startedAt: isoNow(), estimatedEndAt: new Date(Date.now() + 10_000).toISOString() };
  demoDiagnoses.set(diagnosis.id, diagnosis);
  return { ...diagnosis };
}

export function abortDiagnosis(ownerId: string, batteryId: string): DemoDiagnosis {
  const diagnosis = activeDiagnosis(batteryId);
  const session = activeSession(ownerId);
  if (!diagnosis || !session || session.batteryId !== batteryId) throw new Error("NO_DIAGNOSIS_IN_PROGRESS");
  diagnosis.status = "ABORTED";
  diagnosis.result = { abortReason: "USER" };
  return { ...diagnosis };
}

export function mode1Health(battery: DemoBattery): Record<string, unknown> | null {
  if (battery.targetMode !== 1 || !battery.mode1Health) return null;
  const sample = battery.mode1Health;
  return {
    source: "BACKEND_BQ27441_AGGREGATE",
    sohPct: Number(((sample.fullChargeCapacityMah / sample.designCapacityMah) * 100).toFixed(1)),
    rulCycles: sample.rulCycles,
    cycleCount: sample.cycleCount,
    internalResistanceMohm: sample.internalResistanceMohm,
    calculatedAt: sample.calculatedAt
  };
}

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

export function csvForBattery(batteryId: string, sessionId: string | null): string {
  const battery = batteryById(batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  return `${CSV_HEADER}\n${csvRow(battery, sessionId)}\n`;
}
