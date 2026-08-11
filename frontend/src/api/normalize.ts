import type { ActiveSession, Battery, BatteryHealth, Dashboard, DashboardMetrics, Grade, LatestMetric, MetricStatus, NoticeSummary, Relay } from "../types";

export class ApiShapeError extends Error {
  readonly path: string;

  constructor(path: string, message = "서버 응답 형식이 올바르지 않습니다.") {
    super(`${message} (${path})`);
    this.name = "ApiShapeError";
    this.path = path;
  }
}

export function gradeFromScore(score: number): Grade {
  if (score < 0.3) return "NORMAL";
  if (score < 0.6) return "CAUTION";
  if (score < 0.8) return "WARNING";
  return "DANGER";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiShapeError(path);
  return value;
}

function requiredString(value: Record<string, unknown>, key: string, path: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") throw new ApiShapeError(`${path}.${key}`);
  return candidate;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiShapeError(path);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : typeof value === "string" && value.trim() !== "" ? value : null;
}

function isGrade(value: unknown): value is Grade {
  return value === "NORMAL" || value === "CAUTION" || value === "WARNING" || value === "DANGER";
}

function isMetricStatus(value: unknown): value is MetricStatus {
  return value === null || value === "OK" || value === "WARN" || value === "CRIT";
}

function isMode(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function normalizeLatest(raw: unknown): LatestMetric | null {
  if (raw === null || raw === undefined) return null;
  const value = requiredRecord(raw, "battery.latest");
  const scoreValue = value.score;
  const score = typeof scoreValue === "number" && Number.isFinite(scoreValue) && scoreValue >= 0 && scoreValue <= 1 ? scoreValue : null;
  // The server-provided grade is authoritative. A score without a grade is
  // incomplete data, not permission for the client to make a safety verdict.
  const grade = isGrade(value.grade) ? value.grade : null;
  return {
    score,
    grade,
    voltageV: nullableNumber(value.voltageV, "battery.latest.voltageV"),
    currentA: nullableNumber(value.currentA, "battery.latest.currentA"),
    powerW: nullableNumber(value.powerW, "battery.latest.powerW"),
    representativeTempC: nullableNumber(value.representativeTempC, "battery.latest.representativeTempC"),
    representativeTempSource: value.representativeTempSource === "CONTACT" || value.representativeTempSource === "IR_SURFACE" ? value.representativeTempSource : null,
    tempContact: nullableNumber(value.tempContact, "battery.latest.tempContact"),
    tempIrSurface: nullableNumber(value.tempIrSurface, "battery.latest.tempIrSurface"),
    socPct: nullableNumber(value.socPct, "battery.latest.socPct"),
    socBasis: value.socBasis === "ABSOLUTE_GAUGE" || value.socBasis === "RELATIVE_SESSION_START" ? value.socBasis : null,
    measuredAt: nullableString(value.measuredAt),
  };
}

function normalizeHealth(raw: unknown): BatteryHealth | null {
  if (raw === null || raw === undefined) return null;
  const value = requiredRecord(raw, "battery.health");
  const confidence = value.confidence === undefined ? undefined : value.confidence === "LOW" || value.confidence === "HIGH" ? value.confidence : (() => { throw new ApiShapeError("battery.health.confidence"); })();
  let capacity: BatteryHealth["capacity"];
  if (value.capacity === null || value.capacity === undefined) capacity = value.capacity === null ? null : undefined;
  else {
    const capacityValue = requiredRecord(value.capacity, "battery.health.capacity");
    capacity = {
      deliveredWh: nullableNumber(capacityValue.deliveredWh, "battery.health.capacity.deliveredWh"),
      ratedWh: nullableNumber(capacityValue.ratedWh, "battery.health.capacity.ratedWh"),
      baselineWh: nullableNumber(capacityValue.baselineWh, "battery.health.capacity.baselineWh"),
      sohRelPct: nullableNumber(capacityValue.sohRelPct, "battery.health.capacity.sohRelPct"),
      sohAbsPct: nullableNumber(capacityValue.sohAbsPct, "battery.health.capacity.sohAbsPct"),
      assumedEfficiency: nullableNumber(capacityValue.assumedEfficiency, "battery.health.capacity.assumedEfficiency"),
    };
  }
  return {
    source: optionalString(value.source),
    confidence,
    measuredAt: optionalString(value.measuredAt),
    sohPct: nullableNumber(value.sohPct, "battery.health.sohPct"),
    rulCycles: nullableNumber(value.rulCycles, "battery.health.rulCycles"),
    cycleCount: nullableNumber(value.cycleCount, "battery.health.cycleCount"),
    internalResistanceMohm: nullableNumber(value.internalResistanceMohm, "battery.health.internalResistanceMohm"),
    capacity,
  };
}

export function normalizeBattery(raw: unknown): Battery {
  const value = requiredRecord(raw, "battery");
  const chemistry = value.chemistry;
  const targetMode = value.targetMode;
  const opsStatus = value.opsStatus;
  if (chemistry !== "LI_ION" && chemistry !== "LI_PO") throw new ApiShapeError("battery.chemistry");
  if (!isMode(targetMode)) throw new ApiShapeError("battery.targetMode");
  if (opsStatus !== "NORMAL" && opsStatus !== "WATCH" && opsStatus !== "BLOCKED") throw new ApiShapeError("battery.opsStatus");
  const diagnosisCapability = isRecord(value.diagnosisCapability) && typeof value.diagnosisCapability.executionAllowed === "boolean"
    ? { executionAllowed: value.diagnosisCapability.executionAllowed, reasonCode: nullableString(value.diagnosisCapability.reasonCode) }
    : undefined;
  return {
    id: requiredString(value, "id", "battery"),
    label: requiredString(value, "label", "battery"),
    chemistry,
    seriesCount: nullableNumber(value.seriesCount, "battery.seriesCount"),
    maker: nullableString(value.maker),
    model: nullableString(value.model),
    targetMode,
    hardwareProfile: optionalString(value.hardwareProfile),
    capacityWh: nullableNumber(value.capacityWh, "battery.capacityWh"),
    ratedOutputCurrentA: nullableNumber(value.ratedOutputCurrentA, "battery.ratedOutputCurrentA"),
    opsStatus,
    memo: nullableString(value.memo),
    adminMemo: typeof value.adminMemo === "string" ? value.adminMemo : undefined,
    version: optionalNumber(value.version),
    isConnected: typeof value.isConnected === "boolean" ? value.isConnected : undefined,
    latest: normalizeLatest(value.latest),
    health: normalizeHealth(value.health),
    diagnosisCapability,
  };
}

function normalizeSession(raw: unknown): ActiveSession {
  const value = requiredRecord(raw, "session");
  const status = value.status === undefined ? "ACTIVE" : value.status;
  if (status !== "ACTIVE" && status !== "ENDED") throw new ApiShapeError("session.status");
  const mode = value.mode === undefined ? undefined : isMode(value.mode) ? value.mode : (() => { throw new ApiShapeError("session.mode"); })();
  const targetMode = value.targetMode === undefined ? undefined : isMode(value.targetMode) ? value.targetMode : (() => { throw new ApiShapeError("session.targetMode"); })();
  return {
    id: requiredString(value, "id", "session"),
    batteryId: requiredString(value, "batteryId", "session"),
    batteryLabel: requiredString(value, "batteryLabel", "session"),
    deviceId: optionalString(value.deviceId),
    mode,
    targetMode,
    status,
    startedAt: requiredString(value, "startedAt", "session"),
  };
}

function normalizeMetric(raw: unknown, path: string): { value: number | null; status: MetricStatus; ageMs?: number; freshness?: "FRESH" | "STALE" } {
  const value = requiredRecord(raw, path);
  if (!has(value, "value") || !has(value, "status") || !isMetricStatus(value.status)) throw new ApiShapeError(path);
  const result = { value: nullableNumber(value.value, `${path}.value`), status: value.status } as { value: number | null; status: MetricStatus; ageMs?: number; freshness?: "FRESH" | "STALE" };
  const ageMs = optionalNumber(value.ageMs);
  if (ageMs !== undefined) result.ageMs = ageMs;
  if (value.freshness === "FRESH" || value.freshness === "STALE") result.freshness = value.freshness;
  return result;
}

export function normalizeDashboardMetrics(raw: unknown): DashboardMetrics {
  const value = requiredRecord(raw, "metrics");
  const keys = ["voltageV", "currentA", "powerW", "tempContact", "tempIrSurface", "representativeTempC", "socPct"] as const;
  for (const key of keys) if (!has(value, key)) throw new ApiShapeError(`metrics.${key}`);
  const representative = requiredRecord(value.representativeTempC, "metrics.representativeTempC");
  const source = representative.source;
  if (source !== null && source !== "CONTACT" && source !== "IR_SURFACE") throw new ApiShapeError("metrics.representativeTempC.source");
  if (!has(value, "socBasis") || (value.socBasis !== null && value.socBasis !== "ABSOLUTE_GAUGE" && value.socBasis !== "RELATIVE_SESSION_START")) throw new ApiShapeError("metrics.socBasis");
  if (!has(value, "measuredAt") || (value.measuredAt !== null && typeof value.measuredAt !== "string")) throw new ApiShapeError("metrics.measuredAt");
  return {
    voltageV: normalizeMetric(value.voltageV, "metrics.voltageV"),
    currentA: normalizeMetric(value.currentA, "metrics.currentA"),
    powerW: normalizeMetric(value.powerW, "metrics.powerW"),
    tempContact: normalizeMetric(value.tempContact, "metrics.tempContact"),
    tempIrSurface: normalizeMetric(value.tempIrSurface, "metrics.tempIrSurface"),
    representativeTempC: { ...normalizeMetric(value.representativeTempC, "metrics.representativeTempC"), source },
    socPct: normalizeMetric(value.socPct, "metrics.socPct"),
    socBasis: value.socBasis,
    measuredAt: value.measuredAt,
  };
}

export function normalizeDashboardAnomaly(raw: unknown): Dashboard["anomaly"] {
  const value = requiredRecord(raw, "anomaly");
  if (!has(value, "score") || !has(value, "grade")) throw new ApiShapeError("anomaly");
  const score = value.score === null ? null : nullableNumber(value.score, "anomaly.score");
  if (score !== null && (score < 0 || score > 1)) throw new ApiShapeError("anomaly.score");
  if (value.grade !== null && !isGrade(value.grade)) throw new ApiShapeError("anomaly.grade");
  return {
    score,
    grade: value.grade,
    aeScore: value.aeScore === null ? null : optionalNumber(value.aeScore) ?? null,
    informerScore: value.informerScore === null ? null : optionalNumber(value.informerScore) ?? null,
    evaluatedAt: optionalString(value.evaluatedAt),
  };
}

export function normalizeRelay(raw: unknown): Relay {
  const value = requiredRecord(raw, "relay");
  if (value.state !== "CLOSED" && value.state !== "OPEN") throw new ApiShapeError("relay.state");
  const changedBy = requiredRecord(value.changedBy, "relay.changedBy");
  if (changedBy.type === "SYSTEM") {
    if (value.interlock === undefined) throw new ApiShapeError("relay.interlock");
  } else if (changedBy.type === "USER") {
    requiredString(changedBy, "id", "relay.changedBy");
    requiredString(changedBy, "name", "relay.changedBy");
  } else throw new ApiShapeError("relay.changedBy.type");
  const interlock = requiredRecord(value.interlock, "relay.interlock");
  if (typeof interlock.engaged !== "boolean" || (interlock.condition !== null && typeof interlock.condition !== "string") || typeof interlock.canRestore !== "boolean") throw new ApiShapeError("relay.interlock");
  return {
    batteryId: requiredString(value, "batteryId", "relay"),
    state: value.state,
    reason: nullableString(value.reason),
    reasonCode: nullableString(value.reasonCode),
    reasonParams: isRecord(value.reasonParams) ? value.reasonParams : null,
    changedAt: requiredString(value, "changedAt", "relay"),
    changedBy: changedBy.type === "SYSTEM" ? { type: "SYSTEM", systemCode: optionalString(changedBy.systemCode) } : { type: "USER", id: changedBy.id as string, name: changedBy.name as string },
    interlock: { engaged: interlock.engaged, condition: interlock.condition as string | null, canRestore: interlock.canRestore },
  };
}

function normalizeNotice(raw: unknown, index: number): NoticeSummary {
  const value = requiredRecord(raw, `notices[${index}]`);
  const category = value.category;
  if (category !== "IMPORTANT" && category !== "MAINTENANCE" && category !== "FEATURE" && category !== "INFO") throw new ApiShapeError(`notices[${index}].category`);
  return { id: requiredString(value, "id", `notices[${index}]`), category, title: requiredString(value, "title", `notices[${index}]`), summary: requiredString(value, "summary", `notices[${index}]`), publishedAt: requiredString(value, "publishedAt", `notices[${index}]`) };
}

function normalizeQuickTrend(raw: unknown): Dashboard["quickTrend"] {
  if (raw === null || raw === undefined) return undefined;
  const value = requiredRecord(raw, "quickTrend");
  const metric = value.metric;
  if (metric !== "volt" && metric !== "curr" && metric !== "temp" && metric !== "soc") throw new ApiShapeError("quickTrend.metric");
  if (!Array.isArray(value.points)) throw new ApiShapeError("quickTrend.points");
  return {
    metric,
    points: value.points.map((rawPoint, index) => {
      const point = requiredRecord(rawPoint, `quickTrend.points[${index}]`);
      return { at: requiredString(point, "at", `quickTrend.points[${index}]`), value: nullableNumber(point.value, `quickTrend.points[${index}].value`) };
    }),
  };
}

export function normalizeDashboard(raw: unknown): Dashboard {
  const value = requiredRecord(raw, "dashboard");
  const session = normalizeSession(value.session);
  const battery = normalizeBattery(value.battery);
  if (session.batteryId !== battery.id) throw new ApiShapeError("session.batteryId");
  if (!has(value, "metrics")) throw new ApiShapeError("metrics");
  if (!has(value, "anomaly")) throw new ApiShapeError("anomaly");
  if (!has(value, "relay")) throw new ApiShapeError("relay");
  if (!Array.isArray(value.notices)) throw new ApiShapeError("notices");
  const snapshotCursor = typeof value.snapshotCursor === "string" ? value.snapshotCursor : isRecord(value.sync) && typeof value.sync.snapshotCursor === "string" ? value.sync.snapshotCursor : null;
  if (snapshotCursor === null) throw new ApiShapeError("snapshotCursor");
  return {
    session,
    battery,
    metrics: normalizeDashboardMetrics(value.metrics),
    anomaly: normalizeDashboardAnomaly(value.anomaly),
    relay: normalizeRelay(value.relay),
    notices: value.notices.map(normalizeNotice),
    quickTrend: normalizeQuickTrend(value.quickTrend),
    snapshotCursor,
  };
}
