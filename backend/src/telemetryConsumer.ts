import { createHash } from "node:crypto";
import { Kafka, type EachMessagePayload } from "kafkajs";
import { ZodError } from "zod";

import type { BatteryRawMetrics } from "./kafka.js";
import { parseBatteryRawMetrics } from "./kafka.js";
import type { FailsafeSample, HardwareProfile } from "./failsafe.js";

type QueryResult<Row> = { rows: Row[] };

export type TelemetryQueryExecutor = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type TelemetryDbClient = TelemetryQueryExecutor & {
  release(): void;
};

export type TelemetryDbPool = {
  connect(): Promise<TelemetryDbClient>;
};

type ActiveSessionRow = {
  id: string;
  battery_id: string;
  started_at: string | Date;
  hardware_profile: string;
  target_mode: number;
  battery_target_mode: number;
};

type AuditEventRow = {
  id: string;
  created_at: string | Date;
};

type PriorTelemetryRow = {
  session_id: string | null;
  battery_id: string | null;
};

type AuditReasonRow = {
  reason: string | null;
};

type PersistedTelemetryRow = {
  session_id: string | null;
  battery_id: string | null;
  session_started_at: string | Date | null;
  hardware_profile: string | null;
  mode: number | string;
  temp_contact: number | string | null;
  temp_ir_surface: number | string | null;
  gas_raw: number | string | null;
  pressure_raw: number | string | null;
};

type LatestSessionTelemetryRow = { latest_measured_at: string | Date | null };
type PriorTemperatureRow = { measured_at: string | Date; temp_ir_surface: number | string };
type PressureBaselineRow = { baseline_raw: number | string | null; status: "VALID" | "ATTACHMENT_INVALID" | "NO_SAMPLES" };
type PressureMedianRow = { baseline_raw: number | string | null };

export type TelemetryAttribution = {
  sessionId: string | null;
  batteryId: string | null;
  hardwareProfile: HardwareProfile | null;
  sessionStartedAt: string | Date | null;
};

export type UnassignedTelemetryReason = "NO_ACTIVE_SESSION" | "MODE_MISMATCH";

export type UnassignedTelemetryEvent = {
  auditId: string;
  deviceId: string;
  /** Edge-reported measurement time; it is not the event occurrence clock. */
  measuredAt: Date;
  /** Durable audit_log.created_at from the PostgreSQL server clock. */
  occurredAt: Date;
  actualMode: 1 | 2;
  reason: UnassignedTelemetryReason;
  sessionTargetMode: 1 | 2 | null;
  batteryTargetMode: 1 | 2 | null;
};

export type TelemetryIngestResult = {
  kind: "accepted" | "duplicate";
  frame: BatteryRawMetrics;
  measuredAt: Date;
  attribution: TelemetryAttribution;
  latestCandidate: boolean;
  unassignedEvent: UnassignedTelemetryEvent | null;
  /** Null for unattributed or out-of-order frames; only latest session frames enter Fail-Safe. */
  safetySample: FailsafeSample | null;
};

export type DurableTelemetryFrame = Omit<TelemetryIngestResult, "safetySample"> & {
  batteryId: string;
  hardwareProfile: HardwareProfile;
  safetySample: FailsafeSample;
};

export type TelemetryLogger = (message: string, details?: Record<string, unknown>) => void;

export type KafkaRawMessage = {
  offset: string;
  value: Buffer | string | null;
};

export type KafkaRawMessagePayload = {
  topic: string;
  partition: number;
  message: KafkaRawMessage;
};

export type KafkaRawConsumer = {
  connect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(options: { autoCommit?: boolean; eachMessage(payload: KafkaRawMessagePayload): Promise<void> }): Promise<void>;
  commitOffsets(offsets: Array<{ topic: string; partition: number; offset: string }>): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
};

export type KafkaRawConsumerOptions = {
  db: TelemetryDbPool;
  topic: string;
  consumer: KafkaRawConsumer;
  onDurableFrame?: (frame: DurableTelemetryFrame) => Promise<void>;
  onUnassignedData?: (event: UnassignedTelemetryEvent) => Promise<void>;
  logger?: TelemetryLogger;
};

export type CreateKafkaRawConsumerOptions = Omit<KafkaRawConsumerOptions, "consumer"> & {
  brokers: string[];
  clientId: string;
  groupId: string;
};

const BASELINE_WINDOW_MS = 10_000;
const MIN_PRESSURE_BASELINE_RAW = 500;
const DEFAULT_LOGGER: TelemetryLogger = (message, details) => {
  console.error(`[telemetry-consumer] ${message}`, details ?? "");
};

function isHardwareProfile(value: string): value is HardwareProfile {
  return value === "MODE1_EXTERNAL_CELL_V1" || value === "MODE2_FULL" || value === "COMBINED_EXISTING_PARTS_V1";
}

function hardwareProfileOrNull(value: string | null): HardwareProfile | null {
  return value && isHardwareProfile(value) ? value : null;
}

function modeOrNull(value: unknown): 1 | 2 | null {
  return value === 1 || value === "1" ? 1 : value === 2 || value === "2" ? 2 : null;
}

function dateValue(value: string | Date, errorMessage: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(errorMessage);
  return date;
}

function utcDate(timestamp: string): Date {
  return dateValue(timestamp, "invalid telemetry timestamp");
}

function socBasisFor(frame: BatteryRawMetrics): "ABSOLUTE_GAUGE" | "RELATIVE_SESSION_START" | null {
  if (frame.soc_pct === null) return null;
  return frame.mode === 1 ? "ABSOLUTE_GAUGE" : "RELATIVE_SESSION_START";
}

function nextOffset(offset: string): string {
  if (!/^\d+$/.test(offset)) throw new Error(`invalid Kafka offset: ${offset}`);
  return (BigInt(offset) + 1n).toString();
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function persistedPressureBaseline(
  client: TelemetryDbClient,
  frame: BatteryRawMetrics,
  measuredAt: Date,
  attribution: TelemetryAttribution,
): Promise<number | null> {
  if (frame.mode !== 1 || attribution.hardwareProfile !== "MODE1_EXTERNAL_CELL_V1"
    || !attribution.sessionId || attribution.sessionStartedAt === null) return null;

  const sessionStartedAt = dateValue(attribution.sessionStartedAt, "invalid measurement session start");
  if (measuredAt.getTime() - sessionStartedAt.getTime() < BASELINE_WINDOW_MS) return null;

  let result = await client.query<PressureBaselineRow>(`
    select baseline_raw, status
    from failsafe_pressure_baseline
    where session_id = $1
    limit 1
  `, [attribution.sessionId]);
  let baseline = result.rows[0];
  if (!baseline) {
    const windowEnd = new Date(sessionStartedAt.getTime() + BASELINE_WINDOW_MS);
    const medianResult = await client.query<PressureMedianRow>(`
      select percentile_cont(0.5) within group (order by pressure_raw)::numeric as baseline_raw
      from telemetry_metric
      where session_id = $1
        and measured_at >= $2
        and measured_at <= $3
        and pressure_raw is not null
    `, [attribution.sessionId, sessionStartedAt, windowEnd]);
    const baselineRaw = numberOrNull(medianResult.rows[0]?.baseline_raw);
    const status: PressureBaselineRow["status"] = baselineRaw === null
      ? "NO_SAMPLES"
      : baselineRaw < MIN_PRESSURE_BASELINE_RAW ? "ATTACHMENT_INVALID" : "VALID";
    await client.query(`
      insert into failsafe_pressure_baseline (session_id, baseline_raw, status)
      values ($1, $2, $3)
      on conflict (session_id) do nothing
    `, [attribution.sessionId, baselineRaw, status]);
    result = await client.query<PressureBaselineRow>(`
      select baseline_raw, status
      from failsafe_pressure_baseline
      where session_id = $1
      limit 1
    `, [attribution.sessionId]);
    baseline = result.rows[0];
    if (!baseline) throw new Error("pressure baseline could not be finalized");

    if (baseline.status === "ATTACHMENT_INVALID") {
      const dedupeKey = `pressure-baseline-invalid:${attribution.sessionId}`;
      const eventId = `evt_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 32)}`;
      await client.query(`
        insert into domain_event (
          id, event_type, severity, source, device_id, battery_id, session_id,
          occurred_at, score, params, dedupe_key
        ) values ($1, 'PRESSURE_SENSOR_ATTACHMENT_INVALID', 'CAUTION', 'INGEST', $2, $3, $4,
          $5, null, $6::jsonb, $7)
        on conflict do nothing
      `, [
        eventId,
        frame.device_id,
        attribution.batteryId,
        attribution.sessionId,
        measuredAt,
        JSON.stringify({ baselineRaw: numberOrNull(baseline.baseline_raw), minimumBaselineRaw: MIN_PRESSURE_BASELINE_RAW }),
        dedupeKey,
      ]);
    }
  }
  return baseline.status === "VALID" ? numberOrNull(baseline.baseline_raw) : null;
}

async function safetySampleForLatestFrame(
  client: TelemetryDbClient,
  frame: BatteryRawMetrics,
  measuredAt: Date,
  attribution: TelemetryAttribution,
): Promise<FailsafeSample | null> {
  if (!attribution.batteryId || !attribution.sessionId || !attribution.hardwareProfile) return null;

  // Serialize session state and refuse to evaluate an older event-time frame.
  // Raw telemetry remains durable, while late data cannot rewind the safety view.
  await client.query(`
    select id
    from measurement_session
    where id = $1
    for update
  `, [attribution.sessionId]);
  const latestResult = await client.query<LatestSessionTelemetryRow>(`
    select max(measured_at) as latest_measured_at
    from telemetry_metric
    where session_id = $1
  `, [attribution.sessionId]);
  const latestMeasuredAt = latestResult.rows[0]?.latest_measured_at;
  if (latestMeasuredAt == null
    || dateValue(latestMeasuredAt, "invalid latest telemetry timestamp").getTime() !== measuredAt.getTime()) return null;

  let tempRiseRateCPerMin: number | null = null;
  if (frame.temp_ir_surface !== null) {
    const previousResult = await client.query<PriorTemperatureRow>(`
      select measured_at, temp_ir_surface
      from telemetry_metric
      where session_id = $1
        and measured_at < $2
        and temp_ir_surface is not null
      order by measured_at desc
      limit 1
    `, [attribution.sessionId, measuredAt]);
    const previous = previousResult.rows[0];
    if (previous) {
      const previousAt = dateValue(previous.measured_at, "invalid previous temperature timestamp").getTime();
      const seconds = (measuredAt.getTime() - previousAt) / 1000;
      if (seconds > 0) {
        tempRiseRateCPerMin = (frame.temp_ir_surface - Number(previous.temp_ir_surface)) * 60 / seconds;
      }
    }
  }

  const pressureBaseline = await persistedPressureBaseline(client, frame, measuredAt, attribution);
  return {
    tempContact: frame.temp_contact,
    tempIrSurface: frame.temp_ir_surface,
    tempRiseRateCPerMin,
    pressureRaw: frame.pressure_raw,
    pressureBaseline,
    gasRaw: frame.gas_raw,
  };
}

/**
 * The DB transaction is the only acknowledgement boundary. A natural-key
 * conflict is a successful no-op, so it is safe to commit that Kafka offset.
 */
export async function ingestRawMetricsFrame(
  db: TelemetryDbPool,
  input: unknown,
): Promise<TelemetryIngestResult> {
  const frame = parseBatteryRawMetrics(input);
  const measuredAt = utcDate(frame.timestamp);
  const client = await db.connect();
  let committed = false;

  try {
    await client.query("begin");
    // Resolve registration separately from liveness mutation. An unknown
    // device is still retained as unassigned telemetry, but never created or
    // implicitly marked online.
    const deviceResult = await client.query<{ id: string }>(`
      select id
      from device
      where id = $1
    `, [frame.device_id]);
    const registeredDevice = deviceResult.rows.length > 0;

    let session: ActiveSessionRow | undefined;
    if (registeredDevice) {
      const sessionResult = await client.query<ActiveSessionRow>(`
        select s.id, s.battery_id, s.started_at, d.hardware_profile,
               s.target_mode, b.target_mode as battery_target_mode
        from measurement_session s
        join battery_asset b on b.id = s.battery_id
        join device d on d.id = s.device_id
        where s.device_id = $1 and s.status = 'ACTIVE'
        order by s.started_at desc
        limit 1
        for update of s
      `, [frame.device_id]);
      session = sessionResult.rows[0];
    }
    const sessionHardwareProfile = session ? String(session.hardware_profile) : null;
    const sessionTargetMode = modeOrNull(session?.target_mode);
    const batteryTargetMode = modeOrNull(session?.battery_target_mode);
    const sessionMatchesFrame = Boolean(
      session
      && sessionTargetMode === frame.mode
      && batteryTargetMode === frame.mode
    );
    const attribution: TelemetryAttribution = sessionMatchesFrame && session
      ? {
          sessionId: String(session.id),
          batteryId: String(session.battery_id),
          hardwareProfile: hardwareProfileOrNull(sessionHardwareProfile),
          sessionStartedAt: session.started_at,
        }
      : { sessionId: null, batteryId: null, hardwareProfile: null, sessionStartedAt: null };

    const unassignedReason: UnassignedTelemetryReason = session ? "MODE_MISMATCH" : "NO_ACTIVE_SESSION";
    let priorTelemetry: PriorTelemetryRow | null = null;
    let lastUnassignedReason: string | null = null;
    if (!attribution.batteryId) {
      const priorResult = await client.query<PriorTelemetryRow>(`
        select t.session_id, t.battery_id
        from telemetry_metric t
        where t.device_id = $1
        order by t.measured_at desc
        limit 1
      `, [frame.device_id]);
      priorTelemetry = priorResult.rows[0] ?? null;
      if (priorTelemetry && !priorTelemetry.session_id && !priorTelemetry.battery_id) {
        const lastEventResult = await client.query<AuditReasonRow>(`
          select reason
          from audit_log
          where action = 'UNASSIGNED_DATA' and resource = $1
          order by created_at desc, id desc
          limit 1
        `, [frame.device_id]);
        lastUnassignedReason = lastEventResult.rows[0]?.reason ?? null;
      }
    }

    const insertResult = await client.query<{ device_id: string; measured_at: Date }>(`
      insert into telemetry_metric (
        session_id, battery_id, device_id, measured_at,
        voltage_v, current_a, power_w, temp_contact, temp_ir_surface,
        gas_raw, pressure_raw, acoustic_raw, soc_pct, diag_phase, load_target_a,
        age_ms, temp_points, mode, soc_basis, raw_payload,
        temp_ambient
      ) values (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21
      )
      on conflict (device_id, measured_at) do nothing
      returning device_id, measured_at
    `, [
      attribution.sessionId,
      attribution.batteryId,
      frame.device_id,
      measuredAt,
      frame.voltage_v,
      frame.current_a,
      frame.power_w,
      frame.temp_contact,
      frame.temp_ir_surface,
      frame.gas_raw,
      frame.pressure_raw,
      frame.acoustic_raw,
      frame.soc_pct,
      frame.diag_phase ?? null,
      frame.load_target_a ?? null,
      frame.age_ms,
      frame.temp_points,
      frame.mode,
      socBasisFor(frame),
      frame,
      frame.temp_ambient ?? null,
    ]);

    const inserted = insertResult.rows.length > 0;

    // Only a newly accepted natural-key row is a liveness heartbeat. The
    // database clock is authoritative; edge timestamps are untrusted because
    // device clocks may be skewed. This stays in the same transaction as the
    // telemetry/latest/audit writes so any later failure rolls it back.
    if (inserted && registeredDevice) {
      await client.query(`
        with receipt as (select clock_timestamp() as received_at)
        update device as d
        set last_seen_at = greatest(coalesce(d.last_seen_at, receipt.received_at), receipt.received_at),
            status = 'ONLINE'
        from receipt
        where d.id = $1
      `, [frame.device_id]);
    }

    let effectiveAttribution = attribution;
    let safetyFrame = frame;
    let unassignedEvent: UnassignedTelemetryEvent | null = null;
    if (!inserted) {
      const existingResult = await client.query<PersistedTelemetryRow>(`
        select t.session_id, t.battery_id, s.started_at as session_started_at, d.hardware_profile,
               t.mode, t.temp_contact, t.temp_ir_surface, t.gas_raw, t.pressure_raw
        from telemetry_metric t
        left join measurement_session s on s.id = t.session_id
        left join device d on d.id = t.device_id
        where t.device_id = $1 and t.measured_at = $2
        limit 1
      `, [frame.device_id, measuredAt]);
      const existing = existingResult.rows[0];
      if (!existing) throw new Error("telemetry duplicate row could not be read");
      effectiveAttribution = {
        sessionId: existing.session_id ? String(existing.session_id) : null,
        batteryId: existing.battery_id ? String(existing.battery_id) : null,
        hardwareProfile: hardwareProfileOrNull(existing.hardware_profile),
        sessionStartedAt: existing.session_started_at,
      };
      // A natural-key conflict is an acknowledgement/replay of the committed
      // row. Never make a safety decision from conflicting duplicate payload.
      safetyFrame = {
        ...frame,
        mode: modeOrNull(existing.mode) ?? frame.mode,
        temp_contact: numberOrNull(existing.temp_contact),
        temp_ir_surface: numberOrNull(existing.temp_ir_surface),
        gas_raw: numberOrNull(existing.gas_raw),
        pressure_raw: numberOrNull(existing.pressure_raw),
      };
    }

    const shouldRecordUnassignedEvent = inserted
      && !effectiveAttribution.batteryId
      && (!priorTelemetry
        || Boolean(priorTelemetry.session_id || priorTelemetry.battery_id)
        || lastUnassignedReason !== unassignedReason);
    if (shouldRecordUnassignedEvent) {
      const eventResult = await client.query<AuditEventRow>(`
        insert into audit_log (actor_user_id, action, resource, result, reason)
        values (null, 'UNASSIGNED_DATA', $1, 'SUCCESS', $2)
        returning id, created_at
      `, [frame.device_id, unassignedReason]);
      const eventRow = eventResult.rows[0];
      if (!eventRow?.id || eventRow.created_at == null) throw new Error("unassigned telemetry event could not be recorded");
      unassignedEvent = {
        auditId: String(eventRow.id),
        deviceId: frame.device_id,
        measuredAt,
        occurredAt: dateValue(eventRow.created_at, "invalid unassigned telemetry event timestamp"),
        actualMode: frame.mode,
        reason: unassignedReason,
        sessionTargetMode,
        batteryTargetMode,
      };
    }

    if (inserted && effectiveAttribution.batteryId) {
      await client.query(`
        insert into battery_latest (
          battery_id, measured_at, voltage_v, current_a, power_w,
          temp_contact, temp_ir_surface, soc_pct, soc_basis, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        on conflict (battery_id) do update set
          measured_at = excluded.measured_at,
          voltage_v = excluded.voltage_v,
          current_a = excluded.current_a,
          power_w = excluded.power_w,
          temp_contact = excluded.temp_contact,
          temp_ir_surface = excluded.temp_ir_surface,
          soc_pct = excluded.soc_pct,
          soc_basis = excluded.soc_basis,
          updated_at = now()
        where battery_latest.measured_at is null
           or excluded.measured_at > battery_latest.measured_at
      `, [
        effectiveAttribution.batteryId,
        measuredAt,
        frame.voltage_v,
        frame.current_a,
        frame.power_w,
        frame.temp_contact,
        frame.temp_ir_surface,
        frame.soc_pct,
        socBasisFor(frame),
      ]);
    }

    const safetySample = await safetySampleForLatestFrame(client, safetyFrame, measuredAt, effectiveAttribution);

    await client.query("commit");
    committed = true;
    return {
      kind: inserted ? "accepted" : "duplicate",
      frame,
      measuredAt,
      attribution: effectiveAttribution,
      latestCandidate: inserted && Boolean(effectiveAttribution.batteryId),
      unassignedEvent,
      safetySample,
    };
  } catch (error) {
    if (!committed) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original DB failure; the offset remains uncommitted.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function serializeByKey(
  pending: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = pending.get(key) ?? Promise.resolve();
  const current = previous.then(task);
  pending.set(key, current);
  return current.finally(() => {
    if (pending.get(key) === current) pending.delete(key);
  });
}

class PoisonTelemetryMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoisonTelemetryMessageError";
  }
}

export class RawMetricsConsumer {
  private readonly logger: TelemetryLogger;
  private readonly pendingByBattery = new Map<string, Promise<unknown>>();
  private connected = false;
  private stopping = false;
  private runPromise: Promise<void> | null = null;

  constructor(private readonly options: KafkaRawConsumerOptions) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  async start(): Promise<void> {
    if (this.connected) return;
    if (!this.options.topic.trim()) throw new Error("KAFKA_CONSUMER_CONFIG_INVALID");
    try {
      await this.options.consumer.connect();
      this.connected = true;
      await this.options.consumer.subscribe({ topic: this.options.topic, fromBeginning: false });
      this.stopping = false;
      this.runPromise = this.options.consumer.run({
        autoCommit: false,
        eachMessage: (payload) => this.handleMessage(payload),
      });
      void this.runPromise.catch((error) => {
        if (!this.stopping) this.logger("consumer stopped before offset completion", { error: errorMessage(error) });
      });
    } catch (error) {
      await this.disconnectAfterFailedStart();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.connected) return;
    try {
      await this.options.consumer.stop();
    } finally {
      await this.options.consumer.disconnect();
      this.connected = false;
      this.runPromise = null;
    }
  }

  async handleMessage(payload: KafkaRawMessagePayload): Promise<void> {
    try {
      if (payload.topic !== this.options.topic) {
        throw new PoisonTelemetryMessageError(`unsupported Kafka topic: ${payload.topic}`);
      }
      const input = parseJsonMessage(payload.message.value);
      let result: TelemetryIngestResult;
      try {
        result = await ingestRawMetricsFrame(this.options.db, input);
      } catch (error) {
        if (error instanceof ZodError) throw new PoisonTelemetryMessageError("Kafka message failed raw telemetry schema validation");
        throw error;
      }
      if (result.unassignedEvent && this.options.onUnassignedData) {
        try {
          await this.options.onUnassignedData(result.unassignedEvent);
        } catch (error) {
          // The audit row is already durable. A failed live notification must
          // not turn a bounded transition event into a partition wedge.
          this.logger("unassigned-data broadcast failed after durable audit", {
            deviceId: result.unassignedEvent.deviceId,
            auditId: result.unassignedEvent.auditId,
            error: errorMessage(error),
          });
        }
      }
      if (result.attribution.batteryId && result.attribution.hardwareProfile && result.safetySample && this.options.onDurableFrame) {
        const durableFrame: DurableTelemetryFrame = {
          ...result,
          batteryId: result.attribution.batteryId,
          hardwareProfile: result.attribution.hardwareProfile,
          safetySample: result.safetySample,
        };
        await serializeByKey(this.pendingByBattery, result.attribution.batteryId, () => this.options.onDurableFrame!(durableFrame));
      }
      await this.options.consumer.commitOffsets([{
        topic: payload.topic,
        partition: payload.partition,
        offset: nextOffset(payload.message.offset),
      }]);
    } catch (error) {
      if (error instanceof PoisonTelemetryMessageError) {
        try {
          await this.options.consumer.commitOffsets([{
            topic: payload.topic,
            partition: payload.partition,
            offset: nextOffset(payload.message.offset),
          }]);
        } catch (commitError) {
          this.logger("poison message could not be skipped", {
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
            error: errorMessage(commitError),
          });
          throw commitError;
        }
        this.logger("poison message skipped", {
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          error: errorMessage(error),
        });
        return;
      }
      this.logger("message was not acknowledged", {
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private async disconnectAfterFailedStart(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.options.consumer.disconnect();
    } finally {
      this.connected = false;
    }
  }
}

function parseJsonMessage(value: Buffer | string | null): unknown {
  if (value === null) throw new PoisonTelemetryMessageError("Kafka message has no value");
  try {
    return JSON.parse(typeof value === "string" ? value : value.toString("utf8")) as unknown;
  } catch {
    throw new PoisonTelemetryMessageError("Kafka message is not valid JSON");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertKafkaConsumerConfig(options: Pick<CreateKafkaRawConsumerOptions, "brokers" | "clientId" | "groupId" | "topic">): void {
  if (options.brokers.length === 0 || !options.clientId.trim() || !options.groupId.trim() || !options.topic.trim()) {
    throw new Error("KAFKA_CONSUMER_CONFIG_INVALID");
  }
}

export function createKafkaRawMetricsConsumer(options: CreateKafkaRawConsumerOptions): RawMetricsConsumer {
  assertKafkaConsumerConfig(options);
  const kafka = new Kafka({ clientId: options.clientId, brokers: options.brokers });
  const kafkaConsumer = kafka.consumer({ groupId: options.groupId });
  const consumer: KafkaRawConsumer = {
    connect: () => kafkaConsumer.connect(),
    subscribe: (subscribeOptions) => kafkaConsumer.subscribe(subscribeOptions),
    run: ({ autoCommit, eachMessage }) => kafkaConsumer.run({
      autoCommit,
      eachMessage: (payload: EachMessagePayload) => eachMessage(payload),
    }),
    commitOffsets: (offsets) => kafkaConsumer.commitOffsets(offsets),
    stop: () => kafkaConsumer.stop(),
    disconnect: () => kafkaConsumer.disconnect(),
  };
  return new RawMetricsConsumer({ ...options, consumer });
}
