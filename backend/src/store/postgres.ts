import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./contract.js";
import type { CreateNoticeInput, NoticeListQuery, UpdateNoticeInput } from "./contract.js";
import { CSV_HEADER, INPUT_LIMITS } from "./types.js";
import type {
  AdminEventTrend,
  AdminNotice,
  AnomalyScoreRecord,
  DemoAudit,
  DemoBattery,
  DemoDiagnosis,
  DemoRelay,
  DemoSession,
  DemoStatus,
  DemoUser,
  DiagnosisProgress,
  DomainEvent,
  DomainEventQuery,
  DomainEventSeverity,
  DomainEventSource,
  EventTrendPeriod,
  NoticeCategory,
  NoticeDeliveryChannel,
  NoticeDeliveryIntent,
  NoticeDetail,
  NoticeStatus,
  OpsStatus,
  RecordDomainEventInput,
} from "./types.js";
import { quickPhases, totalDurationMs } from "../diagnosis/phases.js";
import { KAFKA_CONTRACT_VERSION, KAFKA_TOPICS, type BackendOutboundCommandEvent } from "../kafka.js";

type AnyRow = Record<string, any>;
type QueryExecutor = pg.Pool | pg.PoolClient;

const NOMINAL_OUTPUT_V = 5.0;
const DOMAIN_CODES = new Set([
  "NOT_FOUND",
  "BATTERY_BLOCKED",
  "NO_ACTIVE_SESSION",
  "NO_STATUS_CHANGE",
  "REASON_REQUIRED",
  "INTERLOCK_LOCKED",
  "MODE_NOT_SUPPORTED",
  "SAFETY_PROFILE_NOT_READY",
  "DIAGNOSIS_IN_PROGRESS",
  "NO_DIAGNOSIS_IN_PROGRESS",
  "SELF_SUSPEND_FORBIDDEN",
  "REAUTH_REQUIRED",
  "INPUT_TOO_LONG",
  "VERSION_CONFLICT",
  "BATTERY_NAME_REQUIRED",
  "CAPACITY_REQUIRED",
  "CAPACITY_NOT_REGISTERED",
  "RELAY_CUT",
  "DEVICE_OFFLINE",
  "RATED_CURRENT_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "VALIDATION_FAILED",
  "NOTICE_NOT_DELETABLE",
  "INTERNAL_ERROR",
]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

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

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function iso(value: unknown, fallback = new Date().toISOString()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return fallback;
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = jsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? clone(parsed as Record<string, unknown>) : {};
}

function jsonProgress(value: unknown): DiagnosisProgress | null {
  const parsed = jsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? clone(parsed as DiagnosisProgress)
    : null;
}

function anomalyContributions(value: unknown): AnomalyScoreRecord["contributions"] {
  const parsed = jsonValue(value);
  if (parsed === null || parsed === undefined) return null;
  if (!Array.isArray(parsed)) return null;
  return parsed.map((item) => ({
    feature: String((item as { feature?: unknown }).feature ?? ""),
    contribution: numberOrNull((item as { contribution?: unknown }).contribution) ?? 0,
  }));
}

function mapAnomalyScore(row: AnyRow): AnomalyScoreRecord {
  return {
    deviceId: String(row.device_id),
    batteryId: row.battery_id == null ? null : String(row.battery_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    evaluatedAt: iso(row.evaluated_at),
    score: numberOrNull(row.score) ?? 0,
    aeScore: numberOrNull(row.ae_score),
    informerScore: numberOrNull(row.informer_score),
    contributions: anomalyContributions(row.contributions),
    modelVersion: row.model_version == null ? null : String(row.model_version),
    tempKalman: numberOrNull(row.temp_kalman),
    tempCellEstimated: numberOrNull(row.temp_cell_estimated),
  };
}

function bodyHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body) ?? "undefined").digest("hex");
}

function isPgError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function pgConstraint(error: unknown): string | null {
  return typeof error === "object" && error !== null && "constraint" in error && typeof (error as { constraint?: unknown }).constraint === "string"
    ? (error as { constraint: string }).constraint
    : null;
}

function domainize(error: unknown, uniqueCode?: string): Error {
  if (error instanceof Error && DOMAIN_CODES.has(error.message)) return error;
  const constraint = pgConstraint(error);
  if (isPgError(error, "23505")) {
    if (constraint === "uq_active_diagnosis_battery" || constraint?.includes("active_diagnosis")) return new Error("DIAGNOSIS_IN_PROGRESS");
    if (constraint === "uq_active_session_global" || constraint?.includes("active_session")) return new Error("NO_ACTIVE_SESSION");
    if (uniqueCode) return new Error(uniqueCode);
  }
  if (isPgError(error, "23503")) return new Error("NOT_FOUND");
  if (isPgError(error, "23514") || isPgError(error, "22P02")) return new Error("VALIDATION_FAILED");
  return new Error("INTERNAL_ERROR");
}

async function query<T extends AnyRow>(executor: QueryExecutor, text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> {
  return executor.query<T>(text, values);
}

type BatteryRow = AnyRow;
type UserRow = AnyRow;
type SessionRow = AnyRow;
type DiagnosisRow = AnyRow;
type RelayRow = AnyRow;

function healthFromRow(row: AnyRow): DemoBattery["mode1Health"] | undefined {
  const designCapacityMah = numberOrNull(row.design_capacity_mah);
  const fullChargeCapacityMah = numberOrNull(row.full_charge_capacity_mah);
  const cycleCount = integerOrNull(row.cycle_count);
  const rulCycles = integerOrNull(row.rul_cycles);
  const internalResistanceMohm = numberOrNull(row.internal_resistance_mohm);
  if (designCapacityMah === null || fullChargeCapacityMah === null || cycleCount === null || rulCycles === null || internalResistanceMohm === null) return undefined;
  return {
    designCapacityMah,
    fullChargeCapacityMah,
    cycleCount,
    rulCycles,
    internalResistanceMohm,
    calculatedAt: iso(row.health_calculated_at ?? row.calculated_at),
  };
}

function mapBattery(row: BatteryRow): DemoBattery {
  const targetMode = Number(row.target_mode) as 1 | 2;
  const battery: DemoBattery = {
    id: String(row.id),
    ownerId: String(row.owner_user_id),
    label: String(row.label),
    model: row.model == null ? "" : String(row.model),
    maker: row.maker == null ? null : String(row.maker),
    chemistry: row.chemistry as "LI_ION" | "LI_PO",
    targetMode,
    seriesCount: integerOrNull(row.series_count),
    capacityWh: numberOrNull(row.capacity_wh),
    ratedOutputCurrentA: numberOrNull(row.rated_output_current_a),
    opsStatus: row.ops_status as OpsStatus,
    memo: row.memo == null ? "" : String(row.memo),
    adminMemo: row.admin_memo == null ? "" : String(row.admin_memo),
    version: integerOrNull(row.version) ?? 0,
    latest: {
      voltageV: numberOrNull(row.latest_voltage_v),
      currentA: numberOrNull(row.latest_current_a),
      powerW: numberOrNull(row.latest_power_w),
      tempContact: numberOrNull(row.latest_temp_contact),
      tempIrSurface: numberOrNull(row.latest_temp_ir_surface),
      socPct: numberOrNull(row.latest_soc_pct),
      score: numberOrNull(row.latest_score),
      measuredAt: nullableIso(row.latest_measured_at),
    },
  };
  const health = healthFromRow(row);
  if (health) battery.mode1Health = health;
  return battery;
}

function mapUser(row: UserRow): DemoUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name == null ? "" : String(row.name),
    role: (row.role ?? "USER") as "USER" | "ADMIN",
    status: (row.status ?? "ACTIVE") as DemoStatus,
    phone: row.phone == null ? "" : String(row.phone),
    joinedAt: iso(row.joined_at ?? row.created_at),
  };
}

function mapSession(row: SessionRow): DemoSession {
  return {
    id: String(row.id),
    batteryId: String(row.battery_id),
    ownerId: String(row.owner_user_id),
    deviceId: String(row.device_id),
    targetMode: Number(row.target_mode) as 1 | 2,
    status: row.status as "ACTIVE" | "ENDED",
    endReason: row.end_reason == null ? null : String(row.end_reason),
    startedAt: iso(row.started_at),
    endedAt: row.ended_at == null ? null : iso(row.ended_at),
  };
}

function mapDiagnosis(row: DiagnosisRow, runtimeProgress?: DiagnosisProgress | null): DemoDiagnosis {
  const status = row.status as DemoDiagnosis["status"];
  return {
    id: String(row.id),
    batteryId: String(row.battery_id),
    sessionId: String(row.session_id),
    kind: row.kind as "QUICK" | "CAPACITY",
    status,
    phase: row.phase == null ? "" : String(row.phase),
    input: jsonObject(row.input),
    result: row.result == null ? null : jsonObject(row.result),
    startedAt: iso(row.started_at),
    estimatedEndAt: row.estimated_end_at == null ? null : iso(row.estimated_end_at),
    completedAt: row.completed_at == null ? null : iso(row.completed_at),
    progress: status === "RUNNING" ? clone(runtimeProgress ?? jsonProgress(row.progress_snapshot)) : null,
  };
}

function relayReason(value: unknown): string | null {
  const parsed = jsonValue(value);
  if (typeof parsed === "string") return parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { reason?: unknown }).reason === "string") return (parsed as { reason: string }).reason;
  return null;
}

function mapRelay(row: RelayRow): DemoRelay {
  return {
    batteryId: String(row.battery_id),
    state: row.state as "CLOSED" | "OPEN",
    interlockEngaged: Boolean(row.interlock_engaged),
    interlockCondition: row.interlock_condition == null ? null : String(row.interlock_condition),
    reasonCode: row.reason_code == null ? null : String(row.reason_code),
    reason: relayReason(row.reason_params),
    changedAt: iso(row.changed_at),
    changedBy: row.changed_by == null ? "SYSTEM" : String(row.changed_by),
  };
}

function mapAudit(row: AnyRow): DemoAudit {
  return {
    id: String(row.id),
    actorId: row.actor_user_id == null ? null : String(row.actor_user_id),
    action: String(row.action),
    resource: String(row.resource),
    result: row.result as "SUCCESS" | "DENIED" | "FAILED",
    reason: row.reason == null ? null : String(row.reason),
    at: iso(row.created_at),
  };
}

function mapDomainEvent(row: AnyRow): DomainEvent {
  return {
    id: String(row.id),
    eventType: String(row.event_type),
    severity: String(row.severity) as DomainEventSeverity,
    source: String(row.source) as DomainEventSource,
    deviceId: row.device_id == null ? null : String(row.device_id),
    batteryId: row.battery_id == null ? null : String(row.battery_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    occurredAt: iso(row.occurred_at),
    score: numberOrNull(row.score),
    params: jsonObject(row.params),
    acknowledgedAt: nullableIso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by == null ? null : String(row.acknowledged_by),
    dedupeKey: String(row.dedupe_key),
    createdAt: iso(row.created_at),
  };
}

function noticeSummary(body: string): string {
  return Array.from(body.normalize("NFKC")).slice(0, 120).join("");
}

function mapNoticeDeliveryIntent(row: AnyRow): NoticeDeliveryIntent {
  return {
    id: String(row.id),
    noticeId: String(row.notice_id),
    channel: String(row.channel) as NoticeDeliveryChannel,
    status: String(row.status) as NoticeDeliveryIntent["status"],
    requestedAt: iso(row.requested_at),
    sentAt: nullableIso(row.sent_at),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

function mapAdminNotice(row: AnyRow, deliveryIntents: NoticeDeliveryIntent[] = []): AdminNotice {
  const body = row.body == null ? "" : String(row.body);
  return {
    id: String(row.id),
    category: String(row.category) as NoticeCategory,
    audience: String(row.audience) as AdminNotice["audience"],
    status: String(row.status) as NoticeStatus,
    title: row.title == null ? "" : String(row.title),
    body,
    summary: noticeSummary(body),
    viewCount: integerOrNull(row.view_count) ?? 0,
    publishedAt: nullableIso(row.published_at),
    archivedAt: nullableIso(row.archived_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    deliveryIntents: clone(deliveryIntents),
  };
}

function mapPublicNotice(row: AnyRow): NoticeDetail {
  const body = row.body == null ? "" : String(row.body);
  const publishedAt = nullableIso(row.published_at);
  if (!publishedAt) throw new Error("INTERNAL_ERROR");
  return {
    id: String(row.id),
    category: String(row.category) as NoticeCategory,
    title: row.title == null ? "" : String(row.title),
    body,
    summary: noticeSummary(body),
    publishedAt,
  };
}

function validateNoticeCategory(value: unknown): value is NoticeCategory {
  return value === "IMPORTANT" || value === "MAINTENANCE" || value === "FEATURE" || value === "INFO";
}

function validateNoticeStatus(value: unknown): value is NoticeStatus {
  return value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED";
}

function validateNoticeAudience(value: unknown): value is AdminNotice["audience"] {
  return value === "ALL" || value === "USER" || value === "ADMIN";
}

const NOTICE_CHANNELS = new Set<NoticeDeliveryChannel>(["KAKAO", "EMAIL", "SMS", "WEBPUSH", "INAPP"]);

function normalizedNoticeChannels(value: NoticeDeliveryChannel[] | undefined): NoticeDeliveryChannel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((channel) => !NOTICE_CHANNELS.has(channel))) throw new Error("VALIDATION_FAILED");
  return [...new Set(value)];
}

function noticeText(value: unknown): string {
  if (typeof value !== "string") throw new Error("VALIDATION_FAILED");
  // Titles and bodies are free text and must round-trip exactly. Only the
  // derived summary applies NFKC normalization.
  return value;
}

function validateNoticeQuery(query: NoticeListQuery): void {
  if (query.category !== undefined && !validateNoticeCategory(query.category)) throw new Error("VALIDATION_FAILED");
  if (query.status !== undefined && !validateNoticeStatus(query.status)) throw new Error("VALIDATION_FAILED");
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) throw new Error("VALIDATION_FAILED");
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) throw new Error("VALIDATION_FAILED");
}

const NOTICE_COLUMNS = `
  id, category, audience, status, title, body, view_count,
  published_at, archived_at, created_by, updated_by, created_at, updated_at
`;

const NOTICE_COLUMNS_QUALIFIED = `
  n.id, n.category, n.audience, n.status, n.title, n.body, n.view_count,
  n.published_at, n.archived_at, n.created_by, n.updated_by, n.created_at, n.updated_at
`;

async function noticeRow(executor: QueryExecutor, noticeId: string, lock = false): Promise<AnyRow | null> {
  const result = await query<AnyRow>(executor, `
    select ${NOTICE_COLUMNS}
    from notice
    where id = $1
    ${lock ? "for update" : ""}
  `, [noticeId]);
  return result.rows[0] ?? null;
}

const DOMAIN_EVENT_COLUMNS = `
  id, event_type, severity, source, device_id, battery_id, session_id,
  occurred_at, score, params, acknowledged_at, acknowledged_by,
  dedupe_key, created_at
`;
const DOMAIN_EVENT_COLUMNS_QUALIFIED = `
  e.id, e.event_type, e.severity, e.source, e.device_id, e.battery_id, e.session_id,
  e.occurred_at, e.score, e.params, e.acknowledged_at, e.acknowledged_by,
  e.dedupe_key, e.created_at
`;

const DOMAIN_EVENT_SEVERITIES = new Set<DomainEventSeverity>(["NORMAL", "CAUTION", "WARNING", "DANGER", "CUT"]);
const DOMAIN_EVENT_SOURCES = new Set<DomainEventSource>(["SYSTEM", "AI", "INGEST", "USER"]);

function domainEventJson(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VALIDATION_FAILED");
  return clone(value as Record<string, unknown>);
}

function validateDomainEventInput(input: RecordDomainEventInput): {
  id: string;
  eventType: string;
  severity: DomainEventSeverity;
  source: DomainEventSource;
  deviceId: string | null;
  batteryId: string | null;
  sessionId: string | null;
  occurredAt: Date;
  score: number | null;
  params: Record<string, unknown>;
  dedupeKey: string;
} {
  const eventType = input.eventType.normalize("NFKC").trim();
  const dedupeKey = input.dedupeKey.normalize("NFKC").trim();
  const eventId = input.id?.normalize("NFKC").trim() || `evt_${randomUUID()}`;
  if (!eventType || !dedupeKey || !eventId || !DOMAIN_EVENT_SEVERITIES.has(input.severity) || !DOMAIN_EVENT_SOURCES.has(input.source)) {
    throw new Error("VALIDATION_FAILED");
  }
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("VALIDATION_FAILED");
  const score = input.score ?? null;
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) throw new Error("VALIDATION_FAILED");
  return {
    id: eventId,
    eventType,
    severity: input.severity,
    source: input.source,
    deviceId: input.deviceId ?? null,
    batteryId: input.batteryId ?? null,
    sessionId: input.sessionId ?? null,
    occurredAt,
    score,
    params: domainEventJson(input.params),
    dedupeKey,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function metricCsvRow(row: AnyRow): string {
  return [
    row.measured_at == null ? "" : iso(row.measured_at),
    row.device_id,
    row.battery_id,
    row.session_id,
    row.mode,
    row.voltage_v,
    row.current_a,
    row.power_w,
    row.temp_contact,
    row.temp_ir_surface,
    row.soc_pct,
    row.soc_basis,
    row.gas_raw,
    row.pressure_raw,
    row.acoustic_raw,
    row.age_ms,
  ].map(csvCell).join(",");
}

/**
 * The edge wire payload deliberately stays at the version-1 `code + params`
 * shape.  Identity lives beside it in the outbox row so a future producer can
 * publish the same durable id as message metadata without making the edge
 * payload carry backend-only fields.
 */
function outboxEventId(dedupeKey: string): string {
  return `evt_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 32)}`;
}

function transientOutboxDedupe(scope: string): string {
  return `${scope}:${randomUUID()}`;
}

async function enqueueOutbox(
  executor: QueryExecutor,
  event: BackendOutboundCommandEvent,
  dedupeKey: string,
): Promise<void> {
  await query(executor, `
    insert into outbox (event_id, dedupe_key, topic, partition_key, payload)
    values ($1, $2, $3, $4, $5)
    on conflict (dedupe_key) do nothing
  `, [
    outboxEventId(dedupeKey),
    dedupeKey,
    KAFKA_TOPICS.events,
    event.params.batteryId,
    { version: KAFKA_CONTRACT_VERSION, code: event.code, params: event.params },
  ]);
}

export function createPostgresStore(pool: pg.Pool): CellGuardStore {
  // The database is canonical; this cache only keeps the high-frequency
  // diagnosis working state between phase snapshots. A new process resumes
  // from diagnosis.progress_snapshot, which is written at each phase change.
  const runtimeProgress = new Map<string, DiagnosisProgress>();

  async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original domain/database failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function dbCall<T>(fn: () => Promise<T>, uniqueCode?: string): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw domainize(error, uniqueCode);
    }
  }

  async function batteryRow(executor: QueryExecutor, batteryId: string, lock = false): Promise<BatteryRow | null> {
    const result = await query<BatteryRow>(executor, `
      select
        a.id, a.owner_user_id, a.label, a.chemistry, a.target_mode, a.series_count,
        a.maker, a.model, a.capacity_wh, a.rated_output_current_a, a.ops_status,
        a.memo, a.admin_memo, a.version, a.updated_at,
        l.measured_at as latest_measured_at,
        l.voltage_v as latest_voltage_v,
        l.current_a as latest_current_a,
        l.power_w as latest_power_w,
        l.temp_contact as latest_temp_contact,
        l.temp_ir_surface as latest_temp_ir_surface,
        l.soc_pct as latest_soc_pct,
        l.score as latest_score,
        h.design_capacity_mah,
        h.full_charge_capacity_mah,
        h.cycle_count,
        h.rul_cycles,
        h.internal_resistance_mohm,
        h.calculated_at as health_calculated_at
      from battery_asset a
      left join battery_latest l on l.battery_id = a.id
      left join battery_health h on h.battery_id = a.id
      where a.id = $1
      ${lock ? "for update of a" : ""}
    `, [batteryId]);
    return result.rows[0] ?? null;
  }

  async function sessionRow(executor: QueryExecutor, sessionId: string): Promise<SessionRow | null> {
    const result = await query<SessionRow>(executor, `
      select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
      from measurement_session
      where id = $1
    `, [sessionId]);
    return result.rows[0] ?? null;
  }

  async function activeSessionRow(executor: QueryExecutor, ownerId?: string): Promise<SessionRow | null> {
    const result = await query<SessionRow>(executor, `
      select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
      from measurement_session
      where status = 'ACTIVE'
        and ($1::text is null or owner_user_id = $1)
      order by started_at desc
      limit 1
    `, [ownerId ?? null]);
    return result.rows[0] ?? null;
  }

  async function diagnosisRow(executor: QueryExecutor, diagnosisId: string, lock = false): Promise<DiagnosisRow | null> {
    const result = await query<DiagnosisRow>(executor, `
      select id, battery_id, session_id, kind, status, phase, input, result,
             started_at, estimated_end_at, completed_at, progress_snapshot
      from diagnosis
      where id = $1
      ${lock ? "for update" : ""}
    `, [diagnosisId]);
    return result.rows[0] ?? null;
  }

  async function activeDiagnosisRow(executor: QueryExecutor, batteryId?: string, lock = false): Promise<DiagnosisRow | null> {
    const result = await query<DiagnosisRow>(executor, `
      select id, battery_id, session_id, kind, status, phase, input, result,
             started_at, estimated_end_at, completed_at, progress_snapshot
      from diagnosis
      where status = 'RUNNING'
        and ($1::text is null or battery_id = $1)
      order by started_at asc
      limit 1
      ${lock ? "for update" : ""}
    `, [batteryId ?? null]);
    return result.rows[0] ?? null;
  }

  async function relayRow(executor: QueryExecutor, batteryId: string, lock = false): Promise<RelayRow | null> {
    const result = await query<RelayRow>(executor, `
      select battery_id, state, interlock_engaged, interlock_condition,
             reason_code, reason_params, changed_at, changed_by
      from relay_state
      where battery_id = $1
      ${lock ? "for update" : ""}
    `, [batteryId]);
    return result.rows[0] ?? null;
  }

  async function ensureRelay(client: pg.PoolClient, batteryId: string): Promise<void> {
    await query(client, `
      insert into relay_state (battery_id, state, interlock_engaged, interlock_condition, reason_code, reason_params, changed_at, changed_by)
      values ($1, 'CLOSED', false, null, null, null, now(), 'SYSTEM')
      on conflict (battery_id) do nothing
    `, [batteryId]);
  }

  async function insertAudit(executor: QueryExecutor, input: Omit<DemoAudit, "id" | "at">): Promise<DemoAudit> {
    const actorUserId = input.actorId === "SYSTEM" ? null : input.actorId;
    const result = await query<AnyRow>(executor, `
      insert into audit_log (actor_user_id, action, resource, result, reason)
      values ($1, $2, $3, $4, $5)
      returning id, actor_user_id, action, resource, result, reason, created_at
    `, [actorUserId, input.action, input.resource, input.result, input.reason]);
    return mapAudit(result.rows[0]);
  }

  /**
   * Insert a domain event as part of the caller's transaction.  The natural
   * dedupe key is the replay boundary; a duplicate is deliberately a no-op.
   * The helper does not start or commit a transaction itself so anomaly-score,
   * relay, audit, and outbox writes can share one atomic boundary.
   */
  async function insertDomainEvent(executor: QueryExecutor, input: RecordDomainEventInput): Promise<void> {
    const normalized = validateDomainEventInput(input);
    await query(executor, `
      insert into domain_event (
        id, event_type, severity, source, device_id, battery_id, session_id,
        occurred_at, score, params, acknowledged_at, acknowledged_by,
        dedupe_key
      ) values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10::jsonb, null, null,
        $11
      )
      on conflict (dedupe_key) do nothing
    `, [
      normalized.id,
      normalized.eventType,
      normalized.severity,
      normalized.source,
      normalized.deviceId,
      normalized.batteryId,
      normalized.sessionId,
      normalized.occurredAt,
      normalized.score,
      normalized.params,
      normalized.dedupeKey,
    ]);
  }

  async function fetchBattery(batteryId: string, executor: QueryExecutor = pool): Promise<DemoBattery | undefined> {
    const row = await batteryRow(executor, batteryId);
    return row ? clone(mapBattery(row)) : undefined;
  }

  async function domainEventRow(executor: QueryExecutor, eventId: string, lock = false): Promise<AnyRow | null> {
    const result = await query<AnyRow>(executor, `
      select ${DOMAIN_EVENT_COLUMNS}
      from domain_event
      where id = $1
      ${lock ? "for update" : ""}
    `, [eventId]);
    return result.rows[0] ?? null;
  }

  function trendWindow(period: EventTrendPeriod, now = Date.now()): {
    count: number;
    stepMs: number;
    startMs: number;
    endExclusiveMs: number;
  } {
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const count = period === "24h" ? 25 : period === "7d" ? 7 : period === "30d" ? 30 : 0;
    if (!count) throw new Error("VALIDATION_FAILED");
    const stepMs = period === "24h" ? hourMs : dayMs;
    const current = new Date(now);
    const endBucketMs = period === "24h"
      ? Math.floor(now / hourMs) * hourMs
      : Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
    const startMs = endBucketMs - (count - 1) * stepMs;
    return { count, stepMs, startMs, endExclusiveMs: endBucketMs + stepMs };
  }

  async function adminEventTrend(period: EventTrendPeriod): Promise<AdminEventTrend> {
    const window = trendWindow(period);
    const result = await query<AnyRow>(pool, `
      select severity, occurred_at, count(*)::int as count
      from domain_event
      where event_type = 'ANOMALY_GRADE_CHANGED'
        and severity in ('CAUTION', 'WARNING', 'DANGER')
        and occurred_at >= $1::timestamptz
        and occurred_at < $2::timestamptz
      group by severity, occurred_at
      order by occurred_at asc
    `, [new Date(window.startMs), new Date(window.endExclusiveMs)]);
    const buckets = Array.from({ length: window.count }, (_, index) => ({
      at: new Date(window.startMs + index * window.stepMs).toISOString(),
      caution: 0,
      warning: 0,
      danger: 0,
    }));
    for (const row of result.rows) {
      const occurredAt = new Date(row.occurred_at).getTime();
      const index = Math.floor((occurredAt - window.startMs) / window.stepMs);
      if (index < 0 || index >= window.count) continue;
      const count = integerOrNull(row.count) ?? 0;
      const bucket = buckets[index];
      if (row.severity === "CAUTION") bucket.caution += count;
      else if (row.severity === "WARNING") bucket.warning += count;
      else if (row.severity === "DANGER") bucket.danger += count;
    }
    const total = buckets.reduce((sum, bucket) => sum + bucket.caution + bucket.warning + bucket.danger, 0);
    const dangerTotal = buckets.reduce((sum, bucket) => sum + bucket.danger, 0);
    // Scan from oldest to newest and update only on a strictly larger total;
    // this makes an equal peak retain the earliest bucket by contract.
    let peakTotal = 0;
    let peakIndex = -1;
    buckets.forEach((bucket, index) => {
      const bucketTotal = bucket.caution + bucket.warning + bucket.danger;
      if (bucketTotal > peakTotal) {
        peakTotal = bucketTotal;
        peakIndex = index;
      }
    });
    return {
      period,
      buckets,
      summary: {
        total,
        dangerTotal,
        peakAt: peakIndex < 0 ? null : buckets[peakIndex].at,
        peakTotal,
      },
    };
  }

  async function noticeDeliveryIntentRows(executor: QueryExecutor, noticeId: string): Promise<NoticeDeliveryIntent[]> {
    const result = await query<AnyRow>(executor, `
      select id, notice_id, channel, status, requested_at, sent_at,
             provider_message_id, last_error
      from notice_delivery_intent
      where notice_id = $1
      order by id asc
    `, [noticeId]);
    return result.rows.map((row) => mapNoticeDeliveryIntent(row));
  }

  async function insertNoticeDeliveryIntents(client: pg.PoolClient, noticeId: string, channels: NoticeDeliveryChannel[]): Promise<void> {
    for (const channel of channels) {
      // This repository has no Kakao/web-push provider or credentials. The
      // intent is durable, but it is explicitly BLOCKED instead of pretending
      // that a provider accepted the message.
      await query(client, `
        insert into notice_delivery_intent
          (notice_id, channel, status, requested_at, sent_at, provider_message_id, last_error)
        values ($1, $2, 'BLOCKED', clock_timestamp(), null, null, 'PROVIDER_NOT_CONFIGURED')
        on conflict (notice_id, channel) do nothing
      `, [noticeId, channel]);
    }
  }

  function validateNoticeMutation(input: CreateNoticeInput | UpdateNoticeInput, status: NoticeStatus): void {
    if (input.category !== undefined && !validateNoticeCategory(input.category)) throw new Error("VALIDATION_FAILED");
    if (input.audience !== undefined && !validateNoticeAudience(input.audience)) throw new Error("VALIDATION_FAILED");
    if (!validateNoticeStatus(status)) throw new Error("VALIDATION_FAILED");
    if (status === "ARCHIVED") throw new Error("VALIDATION_FAILED");
    if (input.notifyChannels !== undefined) normalizedNoticeChannels(input.notifyChannels);
  }

  function assertPublishableNotice(title: string, body: string, status: NoticeStatus): void {
    if (status === "PUBLISHED" && (!title.trim() || !body.trim())) throw new Error("VALIDATION_FAILED");
  }

  async function adminNoticeWithIntents(executor: QueryExecutor, row: AnyRow): Promise<AdminNotice> {
    const intents = await noticeDeliveryIntentRows(executor, String(row.id));
    return clone(mapAdminNotice(row, intents));
  }

  async function publicNoticeRowForUser(executor: QueryExecutor, noticeId: string, viewerId: string): Promise<AnyRow | null> {
    // Locking the notice row serializes the read/update pair for one notice;
    // the visibility check and the conditional view upsert therefore share the
    // same transaction and cannot double-count concurrent browser tabs.
    const row = await noticeRow(executor, noticeId, true);
    if (!row || String(row.status) !== "PUBLISHED" || !["ALL", "USER"].includes(String(row.audience))) return null;
    const view = await query<AnyRow>(executor, `
      select last_viewed_at
      from notice_view
      where notice_id = $1 and viewer_user_id = $2
      for update
    `, [noticeId, viewerId]);
    const lastViewedAt = view.rows[0]?.last_viewed_at;
    const lastMs = lastViewedAt == null ? Number.NaN : new Date(lastViewedAt).getTime();
    // Compare against the same PostgreSQL clock used by the persisted view
    // timestamp, so a web process clock skew cannot shorten or extend the
    // 24-hour window.
    const clock = await query<AnyRow>(executor, "select clock_timestamp() as now");
    const nowMs = new Date(clock.rows[0]?.now ?? Date.now()).getTime();
    if (!Number.isFinite(lastMs) || nowMs - lastMs >= 24 * 60 * 60 * 1000) {
      await query(executor, `update notice set view_count = view_count + 1 where id = $1`, [noticeId]);
      await query(executor, `
        insert into notice_view (notice_id, viewer_user_id, last_viewed_at)
        values ($1, $2, clock_timestamp())
        on conflict (notice_id, viewer_user_id)
        do update set last_viewed_at = excluded.last_viewed_at
      `, [noticeId, viewerId]);
      const updated = await noticeRow(executor, noticeId, false);
      return updated;
    }
    return row;
  }

  async function listNoticeRows(executor: QueryExecutor, queryInput: NoticeListQuery, publicOnly: boolean): Promise<AnyRow[]> {
    validateNoticeQuery(queryInput);
    const values: unknown[] = [];
    const where: string[] = ["1 = 1"];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (publicOnly) {
      where.push("n.status = 'PUBLISHED'");
      where.push("n.audience in ('ALL', 'USER')");
    } else if (queryInput.status !== undefined) {
      where.push(`n.status = ${add(queryInput.status)}`);
    }
    if (queryInput.category !== undefined) where.push(`n.category = ${add(queryInput.category)}`);
    const limit = queryInput.limit === undefined ? null : add(queryInput.limit);
    const offset = queryInput.offset === undefined ? null : add(queryInput.offset);
    const result = await query<AnyRow>(executor, `
      select ${NOTICE_COLUMNS_QUALIFIED}
      from notice n
      where ${where.join(" and ")}
      order by coalesce(n.published_at, n.created_at) desc, n.id desc
      ${limit === null ? "" : `limit ${limit}`}
      ${offset === null ? "" : `offset ${offset}`}
    `, values);
    return result.rows;
  }

  function estimatedEnd(kind: "QUICK" | "CAPACITY", battery: DemoBattery, input: Record<string, unknown>, startMs: number): string {
    if (kind === "QUICK") return new Date(startMs + totalDurationMs(quickPhases(battery.ratedOutputCurrentA))).toISOString();
    const currentA = typeof input.dischargeCurrentA === "number" && input.dischargeCurrentA > 0 ? input.dischargeCurrentA : 1.0;
    const hours = (battery.capacityWh ?? 0) / (NOMINAL_OUTPUT_V * currentA);
    return new Date(startMs + hours * 3_600_000).toISOString();
  }

  const store: CellGuardStore = {
    async userById(id) {
      return dbCall(async () => {
        const result = await query<UserRow>(pool, `
          select u.id, u.email, u.name, u."createdAt" as joined_at,
                 p.role, p.status, p.phone
          from "user" u
          left join app_user_profile p on p.user_id = u.id
          where u.id = $1
        `, [id]);
        return result.rows[0] ? clone(mapUser(result.rows[0])) : undefined;
      });
    },

    async users() {
      return dbCall(async () => {
        const result = await query<UserRow>(pool, `
          select u.id, u.email, u.name, u."createdAt" as joined_at,
                 p.role, p.status, p.phone
          from "user" u
          left join app_user_profile p on p.user_id = u.id
          order by u."createdAt" asc, u.id asc
        `);
        return result.rows.map((row) => clone(mapUser(row)));
      });
    },

    async batteryById(id) {
      return dbCall(() => fetchBattery(id));
    },

    async batteries(ownerId) {
      return dbCall(async () => {
        const result = await query<BatteryRow>(pool, `
          select
            a.id, a.owner_user_id, a.label, a.chemistry, a.target_mode, a.series_count,
            a.maker, a.model, a.capacity_wh, a.rated_output_current_a, a.ops_status,
            a.memo, a.admin_memo, a.version, a.updated_at,
            l.measured_at as latest_measured_at,
            l.voltage_v as latest_voltage_v, l.current_a as latest_current_a,
            l.power_w as latest_power_w, l.temp_contact as latest_temp_contact,
            l.temp_ir_surface as latest_temp_ir_surface, l.soc_pct as latest_soc_pct,
            l.score as latest_score,
            h.design_capacity_mah, h.full_charge_capacity_mah, h.cycle_count,
            h.rul_cycles, h.internal_resistance_mohm, h.calculated_at as health_calculated_at
          from battery_asset a
          left join battery_latest l on l.battery_id = a.id
          left join battery_health h on h.battery_id = a.id
          where ($1::text is null or a.owner_user_id = $1)
          order by a.created_at asc, a.id asc
        `, [ownerId ?? null]);
        return result.rows.map((row) => clone(mapBattery(row)));
      });
    },

    async activeSession(ownerId) {
      return dbCall(async () => {
        const row = await activeSessionRow(pool, ownerId);
        return row ? clone(mapSession(row)) : null;
      });
    },

    async sessionById(id) {
      return dbCall(async () => {
        const row = await sessionRow(pool, id);
        return row ? clone(mapSession(row)) : undefined;
      });
    },

    async sessionsForBattery(batteryId) {
      return dbCall(async () => {
        const result = await query<SessionRow>(pool, `
          select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
          from measurement_session
          where battery_id = $1
          order by started_at desc, id desc
        `, [batteryId]);
        return result.rows.map((row) => clone(mapSession(row)));
      });
    },

    async latestAnomaly(batteryId) {
      return dbCall(async () => {
        const result = await query<AnyRow>(pool, `
          select device_id, battery_id, session_id, evaluated_at, score,
                 ae_score, informer_score, contributions, model_version,
                 temp_kalman, temp_cell_estimated
          from anomaly_score
          where battery_id = $1
          order by evaluated_at desc
          limit 1
        `, [batteryId]);
        return result.rows[0] ? clone(mapAnomalyScore(result.rows[0])) : null;
      });
    },

    async anomalyScoresForBattery(batteryId, from, to) {
      return dbCall(async () => {
        if (from && Number.isNaN(Date.parse(from))) throw new Error("VALIDATION_FAILED");
        if (to && Number.isNaN(Date.parse(to))) throw new Error("VALIDATION_FAILED");
        const result = await query<AnyRow>(pool, `
          select device_id, battery_id, session_id, evaluated_at, score,
                 ae_score, informer_score, contributions, model_version,
                 temp_kalman, temp_cell_estimated
          from anomaly_score
          where battery_id = $1
            and ($2::timestamptz is null or evaluated_at >= $2::timestamptz)
            and ($3::timestamptz is null or evaluated_at <= $3::timestamptz)
          order by evaluated_at desc
        `, [batteryId, from ?? null, to ?? null]);
        return result.rows.map((row) => clone(mapAnomalyScore(row)));
      });
    },

    async domainEventById(id) {
      return dbCall(async () => {
        const row = await domainEventRow(pool, id);
        return row ? clone(mapDomainEvent(row)) : undefined;
      });
    },

    async domainEvents(filters: DomainEventQuery = {}) {
      return dbCall(async () => {
        const values: unknown[] = [];
        const where: string[] = ["1 = 1"];
        const add = (value: unknown): string => {
          values.push(value);
          return `$${values.length}`;
        };
        const normalizedEventTypes = filters.eventType === undefined
          ? null
          : (Array.isArray(filters.eventType) ? filters.eventType : [filters.eventType]).map((value) => String(value));
        const normalizedSeverities = filters.severity === undefined
          ? null
          : (Array.isArray(filters.severity) ? filters.severity : [filters.severity]).map((value) => String(value));
        if (normalizedEventTypes?.length === 0 || normalizedSeverities?.length === 0) return [];
        if (filters.ownerId !== undefined) where.push(`b.owner_user_id = ${add(filters.ownerId)}`);
        if (filters.batteryId !== undefined) where.push(`e.battery_id = ${add(filters.batteryId)}`);
        if (filters.deviceId !== undefined) where.push(`e.device_id = ${add(filters.deviceId)}`);
        if (normalizedEventTypes) where.push(`e.event_type = any(${add(normalizedEventTypes)}::text[])`);
        if (normalizedSeverities) where.push(`e.severity = any(${add(normalizedSeverities)}::text[])`);
        if (filters.from !== undefined) {
          if (Number.isNaN(Date.parse(filters.from))) throw new Error("VALIDATION_FAILED");
          where.push(`e.occurred_at >= ${add(filters.from)}::timestamptz`);
        }
        if (filters.to !== undefined) {
          if (Number.isNaN(Date.parse(filters.to))) throw new Error("VALIDATION_FAILED");
          where.push(`e.occurred_at < ${add(filters.to)}::timestamptz`);
        }
        if (filters.acknowledged !== undefined) where.push(filters.acknowledged ? "e.acknowledged_at is not null" : "e.acknowledged_at is null");
        if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 0)) throw new Error("VALIDATION_FAILED");
        if (filters.offset !== undefined && (!Number.isInteger(filters.offset) || filters.offset < 0)) throw new Error("VALIDATION_FAILED");
        const limit = filters.limit === undefined ? null : add(filters.limit);
        const offset = filters.offset === undefined ? null : add(filters.offset);
        const result = await query<AnyRow>(pool, `
          select ${DOMAIN_EVENT_COLUMNS_QUALIFIED}
          from domain_event e
          left join battery_asset b on b.id = e.battery_id
          where ${where.join(" and ")}
          order by e.occurred_at desc, e.id desc
          ${limit === null ? "" : `limit ${limit}`}
          ${offset === null ? "" : `offset ${offset}`}
        `, values);
        return result.rows.map((row) => clone(mapDomainEvent(row)));
      });
    },

    async getAdminEventTrend(period) {
      return dbCall(() => adminEventTrend(period));
    },

    async publishedNotices(queryInput = {}) {
      return dbCall(async () => {
        const rows = await listNoticeRows(pool, queryInput, true);
        return rows.map((row) => clone({
          id: String(row.id),
          category: String(row.category) as NoticeCategory,
          title: row.title == null ? "" : String(row.title),
          summary: noticeSummary(row.body == null ? "" : String(row.body)),
          publishedAt: nullableIso(row.published_at) ?? "",
        }));
      });
    },

    async adminNotices(queryInput = {}) {
      return dbCall(async () => {
        const rows = await listNoticeRows(pool, queryInput, false);
        return Promise.all(rows.map((row) => adminNoticeWithIntents(pool, row)));
      });
    },

    async noticeForUser(id, viewerId) {
      return dbCall(async () => transaction(async (client) => {
        const row = await publicNoticeRowForUser(client, id, viewerId);
        return row ? clone(mapPublicNotice(row)) : undefined;
      }));
    },

    async adminNoticeById(id) {
      return dbCall(async () => {
        const row = await noticeRow(pool, id);
        return row ? await adminNoticeWithIntents(pool, row) : undefined;
      });
    },

    async noticeDeliveryIntents(noticeId) {
      return dbCall(async () => noticeDeliveryIntentRows(pool, noticeId));
    },

    async activeDiagnosis(batteryId) {
      return dbCall(async () => {
        const row = await activeDiagnosisRow(pool, batteryId);
        return row ? clone(mapDiagnosis(row, runtimeProgress.get(String(row.id)))) : null;
      });
    },

    async diagnosisById(id) {
      return dbCall(async () => {
        const row = await diagnosisRow(pool, id);
        return row ? clone(mapDiagnosis(row, runtimeProgress.get(String(row.id)))) : undefined;
      });
    },

    async diagnosesForBattery(batteryId) {
      return dbCall(async () => {
        const result = await query<DiagnosisRow>(pool, `
          select id, battery_id, session_id, kind, status, phase, input, result,
                 started_at, estimated_end_at, completed_at, progress_snapshot
          from diagnosis
          where battery_id = $1
          order by started_at desc, id desc
        `, [batteryId]);
        return result.rows.map((row) => clone(mapDiagnosis(row, runtimeProgress.get(String(row.id)))));
      });
    },

    async relayByBattery(id) {
      return dbCall(async () => {
        const battery = await batteryRow(pool, id);
        if (!battery) throw new Error("NOT_FOUND");
        const row = await relayRow(pool, id);
        if (row) return clone(mapRelay(row));
        return {
          batteryId: id,
          state: "CLOSED",
          interlockEngaged: false,
          interlockCondition: null,
          reasonCode: null,
          reason: null,
          changedAt: new Date().toISOString(),
          changedBy: "SYSTEM",
        };
      });
    },

    async audits() {
      return dbCall(async () => {
        const result = await query<AnyRow>(pool, `
          select id, actor_user_id, action, resource, result, reason, created_at
          from audit_log
          order by created_at desc, id desc
        `);
        return result.rows.map((row) => clone(mapAudit(row)));
      });
    },

    async createBattery(ownerId, input) {
      const label = input.label.normalize("NFKC").trim();
      if (!label) throw new Error("BATTERY_NAME_REQUIRED");
      if (label.length > 120) throw new Error("INPUT_TOO_LONG");
      if (input.targetMode === 2 && !(Number(input.capacityWh) > 0)) throw new Error("CAPACITY_REQUIRED");
      if (input.targetMode === 2 && !(Number(input.ratedOutputCurrentA) > 0)) throw new Error("RATED_CURRENT_REQUIRED");
      return dbCall(async () => transaction(async (client) => {
        const id = `bat_${randomUUID()}`;
        const now = new Date();
        await query(client, `
          insert into battery_asset
            (id, owner_user_id, label, chemistry, target_mode, series_count, maker, model,
             capacity_wh, rated_output_current_a, ops_status, memo, admin_memo, version, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'NORMAL', '', '', 0, $11, $11)
        `, [
          id,
          ownerId,
          label,
          input.chemistry,
          input.targetMode,
          input.targetMode === 1 ? input.seriesCount ?? null : null,
          input.maker?.normalize("NFKC").trim() || null,
          input.model?.normalize("NFKC").trim() || "",
          input.capacityWh ?? null,
          input.ratedOutputCurrentA ?? null,
          now,
        ]);
        await ensureRelay(client, id);
        const row = await batteryRow(client, id);
        if (!row) throw new Error("NOT_FOUND");
        return clone(mapBattery(row));
      }));
    },

    async updateBattery(ownerId, batteryId, input) {
      return dbCall(async () => transaction(async (client) => {
        const current = await batteryRow(client, batteryId, true);
        if (!current || String(current.owner_user_id) !== ownerId) throw new Error("NOT_FOUND");
        const sets: string[] = [];
        const values: unknown[] = [batteryId];
        const add = (expression: string, value: unknown) => {
          values.push(value);
          sets.push(`${expression} = $${values.length}`);
        };
        if (input.label !== undefined) {
          const label = input.label.normalize("NFKC").trim();
          if (!label) throw new Error("BATTERY_NAME_REQUIRED");
          if (label.length > 120) throw new Error("INPUT_TOO_LONG");
          add("label", label);
        }
        if (input.maker !== undefined) add("maker", input.maker?.normalize("NFKC").trim() || null);
        if (input.model !== undefined) add("model", input.model?.normalize("NFKC").trim() || "");
        if (input.seriesCount !== undefined) add("series_count", input.seriesCount);
        if (input.memo !== undefined) add("memo", normalizeMemo(input.memo));
        if (sets.length) await query(client, `update battery_asset set ${sets.join(", ")}, updated_at = now() where id = $1`, values);
        const row = await batteryRow(client, batteryId);
        if (!row) throw new Error("NOT_FOUND");
        return clone(mapBattery(row));
      }));
    },

    async recordAudit(input) {
      return dbCall(async () => clone(await insertAudit(pool, input)));
    },

    async recordDomainEvent(input) {
      const normalized = validateDomainEventInput(input);
      return dbCall(async () => transaction(async (client) => {
        await insertDomainEvent(client, { ...normalized, occurredAt: normalized.occurredAt.toISOString() });
        const row = await domainEventRow(client, normalized.id);
        if (row) return clone(mapDomainEvent(row));
        const byKey = await query<AnyRow>(client, `
          select ${DOMAIN_EVENT_COLUMNS}
          from domain_event
          where dedupe_key = $1
          limit 1
        `, [normalized.dedupeKey]);
        if (!byKey.rows[0]) throw new Error("INTERNAL_ERROR");
        return clone(mapDomainEvent(byKey.rows[0]));
      }));
    },

    async acknowledgeDomainEvent(actorId, eventId) {
      return dbCall(async () => transaction(async (client) => {
        const current = await domainEventRow(client, eventId, true);
        if (!current) throw new Error("NOT_FOUND");
        const result = await query<AnyRow>(client, `
          update domain_event
          set acknowledged_at = coalesce(acknowledged_at, clock_timestamp()),
              acknowledged_by = coalesce(acknowledged_by, $2)
          where id = $1
          returning ${DOMAIN_EVENT_COLUMNS}
        `, [eventId, actorId === "SYSTEM" ? null : actorId]);
        if (!result.rows[0]) throw new Error("NOT_FOUND");
        return clone(mapDomainEvent(result.rows[0]));
      }));
    },

    async createNotice(actorId, input) {
      const status = input.status ?? "DRAFT";
      if (!validateNoticeCategory(input.category) || !validateNoticeAudience(input.audience) || !validateNoticeStatus(status)) throw new Error("VALIDATION_FAILED");
      const title = noticeText(input.title);
      const body = noticeText(input.body);
      assertPublishableNotice(title, body, status);
      const channels = normalizedNoticeChannels(input.notifyChannels);
      return dbCall(async () => transaction(async (client) => {
        const id = `notice_${randomUUID()}`;
        const created = await query<AnyRow>(client, `
          insert into notice
            (id, category, audience, status, title, body, view_count,
             published_at, archived_at, created_by, updated_by, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, 0,
                  case when $4 = 'PUBLISHED' then clock_timestamp() else null end,
                  null, $7, $7, clock_timestamp(), clock_timestamp())
          returning ${NOTICE_COLUMNS}
        `, [id, input.category, input.audience, status, title, body, actorId]);
        if (!created.rows[0]) throw new Error("INTERNAL_ERROR");
        if (status === "PUBLISHED") await insertNoticeDeliveryIntents(client, id, channels);
        await insertAudit(client, { actorId, action: status === "PUBLISHED" ? "NOTICE_PUBLISH" : "NOTICE_CREATE", resource: id, result: "SUCCESS", reason: null });
        return adminNoticeWithIntents(client, created.rows[0]);
      }));
    },

    async updateNotice(actorId, noticeId, input) {
      const channels = normalizedNoticeChannels(input.notifyChannels);
      return dbCall(async () => transaction(async (client) => {
        const current = await noticeRow(client, noticeId, true);
        if (!current) throw new Error("NOT_FOUND");
        const currentStatus = String(current.status) as NoticeStatus;
        if (currentStatus === "ARCHIVED") throw new Error("VALIDATION_FAILED");
        const nextStatus = input.status ?? currentStatus;
        validateNoticeMutation(input, nextStatus);
        if (currentStatus === "PUBLISHED" && nextStatus !== "PUBLISHED") throw new Error("VALIDATION_FAILED");
        if (currentStatus === "DRAFT" && nextStatus === "ARCHIVED") throw new Error("VALIDATION_FAILED");

        const category = input.category ?? String(current.category);
        const audience = input.audience ?? String(current.audience);
        if (!validateNoticeCategory(category) || !validateNoticeAudience(audience)) throw new Error("VALIDATION_FAILED");
        const title = input.title === undefined ? String(current.title ?? "") : noticeText(input.title);
        const body = input.body === undefined ? String(current.body ?? "") : noticeText(input.body);
        assertPublishableNotice(title, body, nextStatus);
        if (currentStatus === "PUBLISHED" && channels.length) throw new Error("VALIDATION_FAILED");
        const publishing = currentStatus === "DRAFT" && nextStatus === "PUBLISHED";
        const updated = await query<AnyRow>(client, `
          update notice
          set category = $2,
              audience = $3,
              status = $4,
              title = $5,
              body = $6,
              published_at = case when $4 = 'PUBLISHED' then coalesce(published_at, clock_timestamp()) else published_at end,
              updated_by = $7,
              updated_at = clock_timestamp()
          where id = $1
          returning ${NOTICE_COLUMNS}
        `, [noticeId, category, audience, nextStatus, title, body, actorId]);
        if (!updated.rows[0]) throw new Error("NOT_FOUND");
        if (publishing) await insertNoticeDeliveryIntents(client, noticeId, channels);
        await insertAudit(client, { actorId, action: publishing ? "NOTICE_PUBLISH" : "NOTICE_UPDATE", resource: noticeId, result: "SUCCESS", reason: null });
        return adminNoticeWithIntents(client, updated.rows[0]);
      }));
    },

    async archiveNotice(actorId, noticeId) {
      return dbCall(async () => transaction(async (client) => {
        const current = await noticeRow(client, noticeId, true);
        if (!current) throw new Error("NOT_FOUND");
        if (String(current.status) !== "PUBLISHED") throw new Error("VALIDATION_FAILED");
        const updated = await query<AnyRow>(client, `
          update notice
          set status = 'ARCHIVED', archived_at = clock_timestamp(), updated_by = $2, updated_at = clock_timestamp()
          where id = $1
          returning ${NOTICE_COLUMNS}
        `, [noticeId, actorId]);
        if (!updated.rows[0]) throw new Error("NOT_FOUND");
        await insertAudit(client, { actorId, action: "NOTICE_ARCHIVE", resource: noticeId, result: "SUCCESS", reason: null });
        return adminNoticeWithIntents(client, updated.rows[0]);
      }));
    },

    async deleteNotice(actorId, noticeId) {
      await dbCall(async () => transaction(async (client) => {
        const current = await noticeRow(client, noticeId, true);
        if (!current) throw new Error("NOT_FOUND");
        if (String(current.status) !== "DRAFT") throw new Error("NOTICE_NOT_DELETABLE");
        const deleted = await query(client, `delete from notice where id = $1`, [noticeId]);
        if ((deleted.rowCount ?? 0) !== 1) throw new Error("NOT_FOUND");
        await insertAudit(client, { actorId, action: "NOTICE_DELETE", resource: noticeId, result: "SUCCESS", reason: null });
      }));
    },

    async startSession(ownerId, batteryId) {
      return dbCall(async () => transaction(async (client) => {
        // Do not lock the asset before looking for an active session. When two
        // fresh requests race, both may observe no active row and the partial
        // unique index must make exactly one insert fail; serializing on the
        // asset would turn that race into two successful superseding sessions.
        const battery = await batteryRow(client, batteryId);
        if (!battery) throw new Error("NOT_FOUND");
        if (String(battery.owner_user_id) !== ownerId) throw new Error("NOT_FOUND");
        if (battery.ops_status === "BLOCKED") throw new Error("BATTERY_BLOCKED");

        const deviceResult = await query<AnyRow>(client, `
          select id, status
          from device
          where owner_user_id = $1
          order by created_at asc, id asc
          limit 1
        `, [ownerId]);
        const device = deviceResult.rows[0];
        if (!device || (device.status != null && device.status !== "ONLINE")) throw new Error("DEVICE_OFFLINE");

        const currentBattery = mapBattery(battery);
        const id = `ses_${randomUUID()}`;
        const startedMs = Date.now();
        const startedAt = new Date(startedMs);

        const currentResult = await query<SessionRow>(client, `
          select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
          from measurement_session
          where status = 'ACTIVE'
          order by started_at desc
          limit 1
          for update
        `);
        const current = currentResult.rows[0];
        if (current) {
          // A physical mode/battery switch must cut the previous relay before
          // the new session's start command is made durable.  This is only an
          // outbox/state transition; no GPIO or DeviceCommandPort is called
          // from the PostgreSQL path.
          const needsPreviousRelayCut = String(current.battery_id) !== batteryId
            || Number(current.target_mode) !== currentBattery.targetMode;
          if (needsPreviousRelayCut) {
            const previousBatteryId = String(current.battery_id);
            await ensureRelay(client, previousBatteryId);
            const previousRelay = await relayRow(client, previousBatteryId, true);
            if (!previousRelay) throw new Error("NOT_FOUND");
            const reasonCode = Number(current.target_mode) !== currentBattery.targetMode
              ? "MODE_SWITCH"
              : "SESSION_SUPERSEDED";
            await query(client, `
              update relay_state
              set state = 'OPEN', reason_code = $2, reason_params = null,
                  changed_at = now(), changed_by = $3
              where battery_id = $1
            `, [previousBatteryId, reasonCode, ownerId]);
            await insertAudit(client, {
              actorId: ownerId,
              action: "RELAY_CUT",
              resource: previousBatteryId,
              result: "SUCCESS",
              reason: reasonCode,
            });
            await enqueueOutbox(client, {
              version: KAFKA_CONTRACT_VERSION,
              code: "RELAY_CUT",
              params: { batteryId: previousBatteryId, reasonCode },
            }, `session-switch-relay-cut:${id}`);
          }
          await query(client, `update measurement_session set status = 'ENDED', end_reason = 'SUPERSEDED', ended_at = now() where id = $1`, [current.id]);
          await insertAudit(client, { actorId: ownerId, action: "SESSION_AUTO_END", resource: String(current.id), result: "SUCCESS", reason: "SUPERSEDED" });
          await enqueueOutbox(client, {
            version: KAFKA_CONTRACT_VERSION,
            code: "SESSION_ENDED",
            params: { sessionId: String(current.id), batteryId: String(current.battery_id), endReason: "SUPERSEDED" },
          }, `session-ended:${String(current.id)}`);
        }

        const deviceId = String(device.id);
        const result = await query<SessionRow>(client, `
          insert into measurement_session
            (id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at)
          values ($1, $2, $3, $4, $5, 'ACTIVE', null, $6, null)
          returning id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
        `, [id, batteryId, ownerId, deviceId, currentBattery.targetMode, startedAt]);
        await insertAudit(client, { actorId: ownerId, action: "SESSION_START", resource: id, result: "SUCCESS", reason: null });
        await enqueueOutbox(client, {
          version: KAFKA_CONTRACT_VERSION,
          code: "SESSION_STARTED",
          params: { sessionId: id, batteryId, targetMode: currentBattery.targetMode },
        }, `session-started:${id}`);
        return clone(mapSession(result.rows[0]));
      }), "NO_ACTIVE_SESSION");
    },

    async changeOpsStatus(actorId, batteryId, next, reason, expectedVersion) {
      const normalizedReason = reason.normalize("NFKC").trim();
      return dbCall(async () => transaction(async (client) => {
        const current = await batteryRow(client, batteryId, true);
        if (!current) throw new Error("NOT_FOUND");
        if (current.ops_status === next) throw new Error("NO_STATUS_CHANGE");
        if (!normalizedReason) throw new Error("REASON_REQUIRED");
        if (normalizedReason.length > INPUT_LIMITS.reasonChars) throw new Error("INPUT_TOO_LONG");
        const version = integerOrNull(current.version) ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== version) throw new Error("VERSION_CONFLICT");
        await query(client, `
          update battery_asset
          set ops_status = $2, version = version + 1, updated_at = now()
          where id = $1
        `, [batteryId, next]);
        await insertAudit(client, { actorId, action: "BATTERY_OPS_STATUS_CHANGE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });

        if (next === "BLOCKED") {
          const active = await query<SessionRow>(client, `
            select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
            from measurement_session
            where status = 'ACTIVE' and battery_id = $1
            for update
          `, [batteryId]);
          if (active.rows[0]) {
            const session = active.rows[0];
            await query(client, `update measurement_session set status = 'ENDED', end_reason = 'BLOCKED', ended_at = now() where id = $1`, [session.id]);
            await insertAudit(client, { actorId: "SYSTEM", action: "SESSION_AUTO_END", resource: String(session.id), result: "SUCCESS", reason: "BLOCKED" });
            await enqueueOutbox(client, {
              version: KAFKA_CONTRACT_VERSION,
              code: "SESSION_ENDED",
              params: { sessionId: String(session.id), batteryId: String(session.battery_id), endReason: "BLOCKED" },
            }, `session-ended:${String(session.id)}`);
          }
        }
        const updated = await batteryRow(client, batteryId);
        if (!updated) throw new Error("NOT_FOUND");
        return clone(mapBattery(updated));
      }));
    },

    async saveMemo(actorId, batteryId, memo, expectedVersion) {
      const normalizedMemo = normalizeMemo(memo);
      return dbCall(async () => transaction(async (client) => {
        const current = await batteryRow(client, batteryId, true);
        if (!current) throw new Error("NOT_FOUND");
        const version = integerOrNull(current.version) ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== version) throw new Error("VERSION_CONFLICT");
        await query(client, `update battery_asset set admin_memo = $2, version = version + 1, updated_at = now() where id = $1`, [batteryId, normalizedMemo]);
        await insertAudit(client, { actorId, action: "BATTERY_MEMO_UPDATE", resource: batteryId, result: "SUCCESS", reason: null });
        const updated = await batteryRow(client, batteryId);
        if (!updated) throw new Error("NOT_FOUND");
        return clone(mapBattery(updated));
      }));
    },

    async changeUserStatus(actorId, userId, status, reason) {
      const normalizedReason = reason.normalize("NFKC").trim();
      return dbCall(async () => transaction(async (client) => {
        const result = await query<UserRow>(client, `
          select u.id, u.email, u.name, u."createdAt" as joined_at,
                 p.role, p.status, p.phone
          from "user" u
          join app_user_profile p on p.user_id = u.id
          where u.id = $1
          for update of p
        `, [userId]);
        const current = result.rows[0];
        if (!current) throw new Error("NOT_FOUND");
        if (!normalizedReason) throw new Error("REASON_REQUIRED");
        if (normalizedReason.length > INPUT_LIMITS.reasonChars) throw new Error("INPUT_TOO_LONG");
        if (actorId === userId && status === "SUSPENDED") throw new Error("SELF_SUSPEND_FORBIDDEN");
        if (current.status === status) throw new Error("NO_STATUS_CHANGE");
        await query(client, `update app_user_profile set status = $2, updated_at = now() where user_id = $1`, [userId, status]);
        await insertAudit(client, { actorId, action: status === "SUSPENDED" ? "USER_SUSPEND" : "USER_RESTORE", resource: userId, result: "SUCCESS", reason: normalizedReason });
        const updated = await query<UserRow>(client, `
          select u.id, u.email, u.name, u."createdAt" as joined_at,
                 p.role, p.status, p.phone
          from "user" u
          join app_user_profile p on p.user_id = u.id
          where u.id = $1
        `, [userId]);
        if (!updated.rows[0]) throw new Error("NOT_FOUND");
        return clone(mapUser(updated.rows[0]));
      }));
    },

    async changeRelay(actorId, batteryId, action, reason, idempotencyKey) {
      const normalizedReason = normalizeReason(reason);
      return dbCall(async () => transaction(async (client) => {
        const battery = await batteryRow(client, batteryId);
        if (!battery) throw new Error("NOT_FOUND");
        if (String(battery.owner_user_id) !== actorId) throw new Error("NOT_FOUND");
        await ensureRelay(client, batteryId);
        const current = await relayRow(client, batteryId, true);
        if (!current) throw new Error("NOT_FOUND");

        // The REST layer normally records the idempotency result after this
        // method returns.  If the process crashes in that small window, a
        // replay must not append a second audit row or command.  The outbox
        // dedupe key is deterministic for the complete request body, so an
        // existing row is the durable evidence that this operation committed.
        const dedupeKey = idempotencyKey
          ? `relay:${createHash("sha256").update(JSON.stringify({ actorId, batteryId, action, reason: normalizedReason, idempotencyKey })).digest("hex")}`
          : transientOutboxDedupe(`relay:${action}:${batteryId}`);
        if (idempotencyKey) {
          const alreadyQueued = await query<AnyRow>(client, `
            select event_id
            from outbox
            where dedupe_key = $1
            limit 1
          `, [dedupeKey]);
          if (alreadyQueued.rows[0]) return clone(mapRelay(current));
        }

        if (action === "restore" && Boolean(current.interlock_engaged)) throw new Error("INTERLOCK_LOCKED");
        await query(client, `
          update relay_state
          set state = $2,
              interlock_engaged = case when $2 = 'OPEN' then interlock_engaged else false end,
              interlock_condition = case when $2 = 'OPEN' then interlock_condition else null end,
              reason_code = case when $2 = 'OPEN' then reason_code else null end,
              reason_params = jsonb_build_object('reason', $3::text),
              changed_at = now(), changed_by = $4
          where battery_id = $1
        `, [batteryId, action === "cut" ? "OPEN" : "CLOSED", normalizedReason, actorId]);
        await insertAudit(client, { actorId, action: action === "cut" ? "RELAY_CUT" : "RELAY_RESTORE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
        if (action === "cut") {
          await enqueueOutbox(client, {
            version: KAFKA_CONTRACT_VERSION,
            code: "RELAY_CUT",
            params: { batteryId, reasonCode: current.reason_code == null ? null : String(current.reason_code) },
          }, dedupeKey);
        } else {
          await enqueueOutbox(client, {
            version: KAFKA_CONTRACT_VERSION,
            code: "RELAY_RESTORE",
            params: { batteryId },
          }, dedupeKey);
        }
        const updated = await relayRow(client, batteryId);
        if (!updated) throw new Error("NOT_FOUND");
        return clone(mapRelay(updated));
      }));
    },

    async engageFailsafe(batteryId, triggerCode, condition) {
      return dbCall(async () => transaction(async (client) => {
        const battery = await batteryRow(client, batteryId);
        if (!battery) throw new Error("NOT_FOUND");
        await ensureRelay(client, batteryId);
        const current = await relayRow(client, batteryId, true);
        if (!current) throw new Error("NOT_FOUND");
        // A Fail-Safe interlock is latched.  Replayed frames or concurrent
        // safety evaluations must not append another audit/domain/outbox row.
        if (Boolean(current.interlock_engaged)) return clone(mapRelay(current));
        await query(client, `
          update relay_state
          set state = 'OPEN', interlock_engaged = true, interlock_condition = $2,
              reason_code = $3, reason_params = null, changed_at = now(), changed_by = 'SYSTEM'
          where battery_id = $1
        `, [batteryId, condition, triggerCode]);
        await insertAudit(client, { actorId: "SYSTEM", action: "RELAY_AUTO_CUT", resource: batteryId, result: "SUCCESS", reason: triggerCode });
        const activeSession = await query<SessionRow>(client, `
          select id, battery_id, device_id
          from measurement_session
          where battery_id = $1 and status = 'ACTIVE'
          order by started_at desc
          limit 1
        `, [batteryId]);
        const session = activeSession.rows[0];
        await insertDomainEvent(client, {
          id: `evt_${createHash("sha256").update(`failsafe:${batteryId}:${triggerCode}:${condition}`).digest("hex").slice(0, 32)}`,
          eventType: "RELAY_AUTO_CUT",
          severity: "CUT",
          source: "SYSTEM",
          deviceId: session?.device_id == null ? null : String(session.device_id),
          batteryId,
          sessionId: session?.id == null ? null : String(session.id),
          occurredAt: new Date().toISOString(),
          score: null,
          params: { triggerCode, condition },
          dedupeKey: `failsafe:${batteryId}:${triggerCode}:${condition}`,
        });
        await enqueueOutbox(client, {
          version: KAFKA_CONTRACT_VERSION,
          code: "RELAY_CUT",
          params: { batteryId, reasonCode: triggerCode },
        }, `failsafe-relay-cut:${batteryId}:${triggerCode}:${condition}`);
        const updated = await relayRow(client, batteryId);
        if (!updated) throw new Error("NOT_FOUND");
        return clone(mapRelay(updated));
      }));
    },

    async startDiagnosis(ownerId, kind, batteryId, input) {
      const created = await dbCall(async () => transaction(async (client) => {
        const batteryRowValue = await batteryRow(client, batteryId, true);
        const sessionResult = await query<SessionRow>(client, `
          select id, battery_id, owner_user_id, device_id, target_mode, status, end_reason, started_at, ended_at
          from measurement_session
          where status = 'ACTIVE' and owner_user_id = $1 and battery_id = $2
          for update
        `, [ownerId, batteryId]);
        if (!batteryRowValue || !sessionResult.rows[0]) throw new Error("NO_ACTIVE_SESSION");
        if (Number(batteryRowValue.target_mode) !== 2) throw new Error("MODE_NOT_SUPPORTED");
        if (kind === "CAPACITY" && numberOrNull(batteryRowValue.capacity_wh) === null) throw new Error("CAPACITY_NOT_REGISTERED");
        const running = await activeDiagnosisRow(client, batteryId, true);
        if (running) throw new Error("DIAGNOSIS_IN_PROGRESS");

        const battery = mapBattery(batteryRowValue);
        const startedMs = Date.now();
        const startedAt = new Date(startedMs);
        const phase = kind === "QUICK" ? "P0" : "CAPACITY";
        const progress: DiagnosisProgress = {
          loadTargetA: null,
          loadActualA: null,
          partialMetrics: null,
          windows: [],
          deliveredWh: 0,
          vLightLoadV: null,
          lastElapsedMs: null,
          tempTrail: [],
        };
        const id = `dg_${randomUUID()}`;
        const estimatedEndAt = estimatedEnd(kind, battery, input, startedMs);
        const result = await query<DiagnosisRow>(client, `
          insert into diagnosis
            (id, battery_id, session_id, kind, status, phase, input, result,
             started_at, estimated_end_at, completed_at, progress_snapshot)
          values ($1, $2, $3, $4, 'RUNNING', $5, $6, null, $7, $8, null, $9)
          returning id, battery_id, session_id, kind, status, phase, input, result,
                    started_at, estimated_end_at, completed_at, progress_snapshot
        `, [id, batteryId, sessionResult.rows[0].id, kind, phase, input, startedAt, estimatedEndAt, progress]);
        return { diagnosis: clone(mapDiagnosis(result.rows[0], progress)), progress };
      }), "DIAGNOSIS_IN_PROGRESS");
      runtimeProgress.set(created.diagnosis.id, clone(created.progress));
      return created.diagnosis;
    },

    async abortDiagnosis(ownerId, batteryId) {
      const aborted = await dbCall(async () => transaction(async (client) => {
        const active = await activeDiagnosisRow(client, batteryId, true);
        const session = await activeSessionRow(client, ownerId);
        if (!active || !session || String(session.battery_id) !== batteryId) throw new Error("NO_DIAGNOSIS_IN_PROGRESS");
        const progress = runtimeProgress.get(String(active.id)) ?? jsonProgress(active.progress_snapshot);
        const result = {
          abortReason: "USER",
          partial: true,
          deliveredWh: progress?.deliveredWh ?? 0,
        };
        const updated = await query<DiagnosisRow>(client, `
          update diagnosis
          set status = 'ABORTED', result = $2, progress_snapshot = null
          where id = $1
          returning id, battery_id, session_id, kind, status, phase, input, result,
                    started_at, estimated_end_at, completed_at, progress_snapshot
        `, [active.id, result]);
        return { id: String(active.id), diagnosis: clone(mapDiagnosis(updated.rows[0])) };
      }));
      runtimeProgress.delete(aborted.id);
      return aborted.diagnosis;
    },

    async advanceDiagnosis(id, phase, progress) {
      return dbCall(async () => {
        const result = await transaction(async (client) => {
          const current = await diagnosisRow(client, id, true);
          if (!current) throw new Error("NOT_FOUND");
          if (String(current.phase) === phase) return { row: current, phaseChanged: false };
          const updated = await query<DiagnosisRow>(client, `
            update diagnosis
            set phase = $2, progress_snapshot = $3
            where id = $1
            returning id, battery_id, session_id, kind, status, phase, input, result,
                      started_at, estimated_end_at, completed_at, progress_snapshot
          `, [id, phase, progress]);
          if (!updated.rows[0]) throw new Error("NOT_FOUND");
          return { row: updated.rows[0], phaseChanged: true };
        });
        runtimeProgress.set(id, clone(progress));
        const mapped = mapDiagnosis(result.row, progress);
        // Memory returns the supplied progress for this call; on the normal
        // RUNNING path this is also the value used by the runtime cache.
        mapped.progress = clone(progress);
        return clone(mapped);
      });
    },

    async completeDiagnosis(id, result) {
      const completed = await dbCall(async () => transaction(async (client) => {
        const current = await diagnosisRow(client, id, true);
        if (!current) throw new Error("NOT_FOUND");
        const updated = await query<DiagnosisRow>(client, `
          update diagnosis
          set status = 'COMPLETED', result = $2, completed_at = now(), progress_snapshot = null
          where id = $1
          returning id, battery_id, session_id, kind, status, phase, input, result,
                    started_at, estimated_end_at, completed_at, progress_snapshot
        `, [id, result]);
        return clone(mapDiagnosis(updated.rows[0]));
      }));
      runtimeProgress.delete(id);
      return completed;
    },

    async abortDiagnosisBySystem(batteryId, reason) {
      const aborted = await dbCall(async () => transaction(async (client) => {
        const active = await activeDiagnosisRow(client, batteryId, true);
        if (!active) return null;
        const progress = runtimeProgress.get(String(active.id)) ?? jsonProgress(active.progress_snapshot);
        const result = { abortReason: reason, partial: true, deliveredWh: progress?.deliveredWh ?? 0 };
        const updated = await query<DiagnosisRow>(client, `
          update diagnosis
          set status = 'ABORTED', result = $2, progress_snapshot = null
          where id = $1
          returning id, battery_id, session_id, kind, status, phase, input, result,
                    started_at, estimated_end_at, completed_at, progress_snapshot
        `, [active.id, result]);
        return updated.rows[0] ? { id: String(active.id), diagnosis: clone(mapDiagnosis(updated.rows[0])) } : null;
      }));
      if (aborted) {
        runtimeProgress.delete(aborted.id);
        return aborted.diagnosis;
      }
      return null;
    },

    async idempotent(actorId, key, body): Promise<IdempotencyResult> {
      return dbCall(async () => {
        const result = await query<AnyRow>(pool, `
          select request_hash, status, response
          from idempotency_key
          where actor_user_id = $1 and key = $2
        `, [actorId, key]);
        const previous = result.rows[0];
        if (!previous) return { kind: "new" };
        if (String(previous.request_hash) !== bodyHash(body)) return { kind: "conflict" };
        return { kind: "replay", status: integerOrNull(previous.status) ?? undefined, body: clone(jsonValue(previous.response)) };
      });
    },

    async rememberIdempotency(actorId, key, body, status, response) {
      await dbCall(async () => {
        await query(pool, `
          insert into idempotency_key (actor_user_id, key, request_hash, status, response)
          values ($1, $2, $3, $4, $5)
          on conflict (actor_user_id, key) do update
          set request_hash = excluded.request_hash, status = excluded.status, response = excluded.response
        `, [actorId, key, bodyHash(body), status, response]);
      });
    },

    async mode1Health(battery) {
      if (battery.targetMode !== 1) return null;
      return dbCall(async () => {
        const result = await query<AnyRow>(pool, `
          select design_capacity_mah, full_charge_capacity_mah, cycle_count,
                 rul_cycles, internal_resistance_mohm, calculated_at
          from battery_health
          where battery_id = $1
        `, [battery.id]);
        const health = result.rows[0] ? healthFromRow(result.rows[0]) : undefined;
        if (!health) return null;
        return {
          source: "BACKEND_BQ27441_AGGREGATE",
          sohPct: Number(((health.fullChargeCapacityMah / health.designCapacityMah) * 100).toFixed(1)),
          rulCycles: health.rulCycles,
          cycleCount: health.cycleCount,
          internalResistanceMohm: health.internalResistanceMohm,
          calculatedAt: health.calculatedAt,
        };
      });
    },

    async csvForBattery(batteryId, sessionId, from, to) {
      return dbCall(async () => {
        const battery = await fetchBattery(batteryId);
        if (!battery) throw new Error("NOT_FOUND");
        if (from && Number.isNaN(Date.parse(from))) throw new Error("VALIDATION_FAILED");
        if (to && Number.isNaN(Date.parse(to))) throw new Error("VALIDATION_FAILED");
        const result = await query<AnyRow>(pool, `
          select measured_at, device_id, battery_id, session_id, mode,
                 voltage_v, current_a, power_w, temp_contact, temp_ir_surface,
                 soc_pct, soc_basis, gas_raw, pressure_raw, acoustic_raw, age_ms
          from telemetry_metric
          where battery_id = $1
            and ($2::text is null or session_id = $2)
            and ($3::timestamptz is null or measured_at >= $3::timestamptz)
            and ($4::timestamptz is null or measured_at <= $4::timestamptz)
          order by measured_at asc
        `, [batteryId, sessionId, from ?? null, to ?? null]);
        if (result.rows.length) return `${CSV_HEADER}\n${result.rows.map(metricCsvRow).join("\n")}\n`;
        return `${CSV_HEADER}\n`;
      });
    },
  };

  return store;
}
