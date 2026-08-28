import { createHash, randomUUID } from "node:crypto";

import type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./contract.js";
import { CSV_HEADER, F21_THRESHOLDS, INPUT_LIMITS, csvRow } from "./types.js";
import type { DemoAudit, DemoBattery, DemoDiagnosis, DemoRelay, DemoSession, DemoStatus, DemoUser, OpsStatus } from "./types.js";

export function createMemoryStore(): CellGuardStore & { demoUsers: DemoUser[] } {
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

  const demoUsers: DemoUser[] = [
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

  // Internal logic stays synchronous so functions can call each other directly
  // without `await`/`this`. The returned object's methods are thin `async`
  // wrappers around these.
  const findUser = (id: string): DemoUser | undefined => { const user = demoUsers.find((item) => item.id === id); return user ? { ...user } : undefined; };
  const findBattery = (id: string): DemoBattery | undefined => { const battery = demoBatteries.find((item) => item.id === id); return battery ? { ...battery } : undefined; };
  const listUsers = (): DemoUser[] => demoUsers.map((user) => ({ ...user }));
  const listBatteries = (ownerId?: string): DemoBattery[] => demoBatteries.filter((battery) => !ownerId || battery.ownerId === ownerId).map((battery) => ({ ...battery }));
  const findActiveSession = (ownerId?: string): DemoSession | null => [...demoSessions.values()].find((session) => session.status === "ACTIVE" && (!ownerId || session.ownerId === ownerId)) ?? null;
  const listSessionsForBattery = (batteryId: string): DemoSession[] => [...demoSessions.values()].filter((session) => session.batteryId === batteryId).map((session) => ({ ...session }));
  const findSessionById = (id: string): DemoSession | undefined => { const session = demoSessions.get(id); return session ? { ...session } : undefined; };
  const findActiveDiagnosis = (batteryId?: string): DemoDiagnosis | null => [...demoDiagnoses.values()].find((diagnosis) => diagnosis.status === "RUNNING" && (!batteryId || diagnosis.batteryId === batteryId)) ?? null;
  const listDiagnosesForBattery = (batteryId: string): DemoDiagnosis[] => [...demoDiagnoses.values()].filter((diagnosis) => diagnosis.batteryId === batteryId).map((diagnosis) => ({ ...diagnosis }));
  const findDiagnosisById = (id: string): DemoDiagnosis | undefined => { const diagnosis = demoDiagnoses.get(id); return diagnosis ? { ...diagnosis } : undefined; };
  const readRelay = (id: string): DemoRelay => ({ ...(demoRelays.get(id) ?? { batteryId: id, state: "CLOSED", interlockEngaged: false, interlockCondition: null, reasonCode: null, reason: null, changedAt: isoNow(), changedBy: "SYSTEM" }) });
  const listAudits = (): DemoAudit[] => demoAudits.map((audit) => ({ ...audit }));

  const audit = (input: Omit<DemoAudit, "id" | "at">): DemoAudit => {
    const entry = { ...input, id: `audit_${randomUUID()}`, at: isoNow() };
    demoAudits.unshift(entry);
    return entry;
  };

  const addBattery = (ownerId: string, input: CreateBatteryInput): DemoBattery => {
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
  };

  const editBattery = (ownerId: string, batteryId: string, input: UpdateBatteryInput): DemoBattery => {
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
  };

  const checkIdempotent = (actorId: string, key: string, body: unknown): IdempotencyResult => {
    const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const mapKey = `${actorId}:${key}`;
    const previous = idempotency.get(mapKey);
    if (!previous) return { kind: "new" };
    if (previous.hash !== hash) return { kind: "conflict" };
    return { kind: "replay", status: previous.status, body: previous.body };
  };

  const storeIdempotency = (actorId: string, key: string, body: unknown, status: number, response: unknown): void => {
    idempotency.set(`${actorId}:${key}`, { hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"), status, body: response });
  };

  const beginSession = (ownerId: string, batteryId: string): DemoSession => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (battery.opsStatus === "BLOCKED") throw new Error("BATTERY_BLOCKED");
    // The physical interlock permits one active battery and one active session
    // for the whole installation, not one session per user.
    const current = findActiveSession();
    if (current) {
      current.status = "ENDED";
      current.endReason = "SUPERSEDED";
      current.endedAt = isoNow();
      audit({ actorId: ownerId, action: "SESSION_AUTO_END", resource: current.id, result: "SUCCESS", reason: "SUPERSEDED" });
    }
    const session: DemoSession = { id: `ses_${randomUUID()}`, batteryId, ownerId, deviceId: "demo-device-01", targetMode: battery.targetMode, status: "ACTIVE", endReason: null, startedAt: isoNow(), endedAt: null };
    demoSessions.set(session.id, session);
    return { ...session };
  };

  const setOpsStatus = (actorId: string, batteryId: string, next: OpsStatus, reason: string, expectedVersion?: number): DemoBattery => {
    const battery = demoBatteries.find((item) => item.id === batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (battery.opsStatus === next) throw new Error("NO_STATUS_CHANGE");
    const normalizedReason = normalizeReason(reason);
    if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
    battery.opsStatus = next;
    battery.version += 1;
    audit({ actorId, action: "BATTERY_OPS_STATUS_CHANGE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
    if (next === "BLOCKED") {
      const session = findActiveSession(battery.ownerId);
      if (session && session.batteryId === batteryId) {
        session.status = "ENDED";
        session.endReason = "BLOCKED";
        session.endedAt = isoNow();
        audit({ actorId: "SYSTEM", action: "SESSION_AUTO_END", resource: session.id, result: "SUCCESS", reason: "BLOCKED" });
      }
    }
    return { ...battery };
  };

  const setMemo = (actorId: string, batteryId: string, memo: string, expectedVersion?: number): DemoBattery => {
    const battery = demoBatteries.find((item) => item.id === batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
    battery.adminMemo = normalizeMemo(memo);
    battery.version += 1;
    audit({ actorId, action: "BATTERY_MEMO_UPDATE", resource: batteryId, result: "SUCCESS", reason: null });
    return { ...battery };
  };

  const setUserStatus = (actorId: string, userId: string, status: DemoStatus, reason: string): DemoUser => {
    const user = demoUsers.find((item) => item.id === userId);
    if (!user) throw new Error("NOT_FOUND");
    const normalizedReason = normalizeReason(reason);
    if (actorId === userId && status === "SUSPENDED") throw new Error("SELF_SUSPEND_FORBIDDEN");
    if (user.status === status) throw new Error("NO_STATUS_CHANGE");
    user.status = status;
    audit({ actorId, action: status === "SUSPENDED" ? "USER_SUSPEND" : "USER_RESTORE", resource: userId, result: "SUCCESS", reason: normalizedReason });
    return { ...user };
  };

  const setRelay = (actorId: string, batteryId: string, action: "cut" | "restore", reason: string): DemoRelay => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    const normalizedReason = normalizeReason(reason);
    const current = readRelay(batteryId);
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
    audit({ actorId, action: action === "cut" ? "RELAY_CUT" : "RELAY_RESTORE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
    return { ...next };
  };

  // Server Fail-Safe only. Unlike setRelay (user action), this ENGAGES the
  // interlock. It is the only path that sets interlockEngaged at runtime.
  // The relay transition + RELAY_AUTO_CUT audit are one atomic unit — contract §3.4.
  // Not idempotent: calling it again on an already-interlocked battery stacks
  // another audit entry. De-duplication is the caller's (B3) responsibility.
  const engage = (batteryId: string, triggerCode: string, condition: string): DemoRelay => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    const current = readRelay(batteryId);
    const next: DemoRelay = {
      ...current,
      state: "OPEN",
      interlockEngaged: true,
      interlockCondition: condition,
      reasonCode: triggerCode,
      reason: null,
      changedAt: isoNow(),
      changedBy: "SYSTEM"
    };
    demoRelays.set(batteryId, next);
    audit({ actorId: "SYSTEM", action: "RELAY_AUTO_CUT", resource: batteryId, result: "SUCCESS", reason: triggerCode });
    return { ...next };
  };

  const beginDiagnosis = (ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): DemoDiagnosis => {
    const battery = findBattery(batteryId);
    const session = findActiveSession(ownerId);
    if (!battery || !session || session.batteryId !== batteryId) throw new Error("NO_ACTIVE_SESSION");
    if (battery.targetMode !== 2) throw new Error("MODE_NOT_SUPPORTED");
    if (!F21_THRESHOLDS.configured) throw new Error("SAFETY_PROFILE_NOT_READY");
    if (findActiveDiagnosis(batteryId)) throw new Error("DIAGNOSIS_IN_PROGRESS");
    const diagnosis: DemoDiagnosis = { id: `dg_${randomUUID()}`, batteryId, sessionId: session.id, kind, status: "RUNNING", phase: kind === "QUICK" ? "P0" : "CAPACITY", input, result: null, startedAt: isoNow(), estimatedEndAt: new Date(Date.now() + 10_000).toISOString() };
    demoDiagnoses.set(diagnosis.id, diagnosis);
    return { ...diagnosis };
  };

  const cancelDiagnosis = (ownerId: string, batteryId: string): DemoDiagnosis => {
    const diagnosis = findActiveDiagnosis(batteryId);
    const session = findActiveSession(ownerId);
    if (!diagnosis || !session || session.batteryId !== batteryId) throw new Error("NO_DIAGNOSIS_IN_PROGRESS");
    diagnosis.status = "ABORTED";
    diagnosis.result = { abortReason: "USER" };
    return { ...diagnosis };
  };

  const health1 = (battery: DemoBattery): Record<string, unknown> | null => {
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
  };

  const buildCsv = (batteryId: string, sessionId: string | null): string => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    return `${CSV_HEADER}\n${csvRow(battery, sessionId)}\n`;
  };

  return {
    demoUsers,

    async userById(id) { return findUser(id); },
    async users() { return listUsers(); },
    async batteryById(id) { return findBattery(id); },
    async batteries(ownerId) { return listBatteries(ownerId); },
    async activeSession(ownerId) { return findActiveSession(ownerId); },
    async sessionById(id) { return findSessionById(id); },
    async sessionsForBattery(batteryId) { return listSessionsForBattery(batteryId); },
    async activeDiagnosis(batteryId) { return findActiveDiagnosis(batteryId); },
    async diagnosisById(id) { return findDiagnosisById(id); },
    async diagnosesForBattery(batteryId) { return listDiagnosesForBattery(batteryId); },
    async relayByBattery(id) { return readRelay(id); },
    async audits() { return listAudits(); },

    async createBattery(ownerId, input) { return addBattery(ownerId, input); },
    async updateBattery(ownerId, batteryId, input) { return editBattery(ownerId, batteryId, input); },
    async recordAudit(input) { return audit(input); },
    async startSession(ownerId, batteryId) { return beginSession(ownerId, batteryId); },
    async changeOpsStatus(actorId, batteryId, next, reason, expectedVersion) { return setOpsStatus(actorId, batteryId, next, reason, expectedVersion); },
    async saveMemo(actorId, batteryId, memo, expectedVersion) { return setMemo(actorId, batteryId, memo, expectedVersion); },
    async changeUserStatus(actorId, userId, status, reason) { return setUserStatus(actorId, userId, status, reason); },
    async changeRelay(actorId, batteryId, action, reason) { return setRelay(actorId, batteryId, action, reason); },
    async engageFailsafe(batteryId, triggerCode, condition) { return engage(batteryId, triggerCode, condition); },
    async startDiagnosis(ownerId, kind, batteryId, input) { return beginDiagnosis(ownerId, kind, batteryId, input); },
    async abortDiagnosis(ownerId, batteryId) { return cancelDiagnosis(ownerId, batteryId); },

    async idempotent(actorId, key, body) { return checkIdempotent(actorId, key, body); },
    async rememberIdempotency(actorId, key, body, status, response) { storeIdempotency(actorId, key, body, status, response); },

    async mode1Health(battery) { return health1(battery); },
    async csvForBattery(batteryId, sessionId) { return buildCsv(batteryId, sessionId); }
  };
}
