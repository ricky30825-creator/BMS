import { Kafka, type EachMessagePayload } from "kafkajs";

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
};

type PersistedTelemetryRow = {
  session_id: string | null;
  battery_id: string | null;
  session_started_at: string | Date | null;
  hardware_profile: string | null;
};

export type TelemetryAttribution = {
  sessionId: string | null;
  batteryId: string | null;
  hardwareProfile: HardwareProfile | null;
  sessionStartedAt: string | Date | null;
};

export type TelemetryIngestResult = {
  kind: "accepted" | "duplicate";
  frame: BatteryRawMetrics;
  measuredAt: Date;
  attribution: TelemetryAttribution;
  latestCandidate: boolean;
};

export type DurableTelemetryFrame = TelemetryIngestResult & {
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
  logger?: TelemetryLogger;
};

export type CreateKafkaRawConsumerOptions = Omit<KafkaRawConsumerOptions, "consumer"> & {
  brokers: string[];
  clientId: string;
  groupId: string;
};

const BASELINE_WINDOW_MS = 10_000;
const DEFAULT_LOGGER: TelemetryLogger = (message, details) => {
  console.error(`[telemetry-consumer] ${message}`, details ?? "");
};

function isHardwareProfile(value: string): value is HardwareProfile {
  return value === "MODE1_EXTERNAL_CELL_V1" || value === "COMBINED_EXISTING_PARTS_V1";
}

function hardwareProfileOrNull(value: string | null): HardwareProfile | null {
  return value && isHardwareProfile(value) ? value : null;
}

function utcDate(timestamp: string): Date {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("invalid telemetry timestamp");
  return date;
}

function socBasisFor(frame: BatteryRawMetrics): "ABSOLUTE_GAUGE" | "RELATIVE_SESSION_START" | null {
  if (frame.soc_pct === null) return null;
  return frame.mode === 1 ? "ABSOLUTE_GAUGE" : "RELATIVE_SESSION_START";
}

function nextOffset(offset: string): string {
  if (!/^\d+$/.test(offset)) throw new Error(`invalid Kafka offset: ${offset}`);
  return (BigInt(offset) + 1n).toString();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
    const sessionResult = await client.query<ActiveSessionRow>(`
      select s.id, s.battery_id, s.started_at, d.hardware_profile
      from measurement_session s
      join device d on d.id = s.device_id
      where s.device_id = $1 and s.status = 'ACTIVE'
      order by s.started_at desc
      limit 1
    `, [frame.device_id]);
    const session = sessionResult.rows[0];
    const sessionHardwareProfile = session ? String(session.hardware_profile) : null;
    const attribution: TelemetryAttribution = session
      ? {
          sessionId: String(session.id),
          batteryId: String(session.battery_id),
          hardwareProfile: hardwareProfileOrNull(sessionHardwareProfile),
          sessionStartedAt: session.started_at,
        }
      : { sessionId: null, batteryId: null, hardwareProfile: null, sessionStartedAt: null };

    const insertResult = await client.query<{ device_id: string; measured_at: Date }>(`
      insert into telemetry_metric (
        session_id, battery_id, device_id, measured_at,
        voltage_v, current_a, power_w, temp_contact, temp_ir_surface,
        gas_raw, pressure_raw, acoustic_raw, soc_pct, diag_phase, load_target_a,
        age_ms, temp_points, mode, soc_basis, raw_payload
      ) values (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20
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
    ]);

    const inserted = insertResult.rows.length > 0;
    let effectiveAttribution = attribution;
    if (!inserted) {
      const existingResult = await client.query<PersistedTelemetryRow>(`
        select t.session_id, t.battery_id, s.started_at as session_started_at, d.hardware_profile
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

    await client.query("commit");
    committed = true;
    return {
      kind: inserted ? "accepted" : "duplicate",
      frame,
      measuredAt,
      attribution: effectiveAttribution,
      latestCandidate: inserted && Boolean(effectiveAttribution.batteryId),
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

type SafetyState = {
  sessionId: string;
  sessionStartedAtMs: number | null;
  pressureSamples: number[];
  pressureBaseline: number | null;
  previousTemperature: { atMs: number; value: number } | null;
};

/** Maintains only the state needed by the existing per-frame Fail-Safe hook. */
export function createSafetySampleTracker() {
  const states = new Map<string, SafetyState>();
  const samples = new Map<string, FailsafeSample>();

  return {
    sampleFor(result: TelemetryIngestResult): FailsafeSample {
      const { attribution, frame, measuredAt } = result;
      if (!attribution.batteryId || !attribution.sessionId) {
        return {
          tempContact: frame.temp_contact,
          tempIrSurface: frame.temp_ir_surface,
          tempRiseRateCPerMin: null,
          pressureRaw: frame.pressure_raw,
          pressureBaseline: null,
          gasRaw: frame.gas_raw,
        };
      }

      const frameKey = `${attribution.sessionId}:${frame.device_id}:${measuredAt.toISOString()}`;
      const priorSample = samples.get(frameKey);
      if (priorSample) return { ...priorSample };

      const sessionStartedAtMs = attribution.sessionStartedAt === null
        ? null
        : new Date(attribution.sessionStartedAt).getTime();
      let state = states.get(attribution.batteryId);
      if (!state || state.sessionId !== attribution.sessionId) {
        state = {
          sessionId: attribution.sessionId,
          sessionStartedAtMs: Number.isFinite(sessionStartedAtMs) ? sessionStartedAtMs : null,
          pressureSamples: [],
          pressureBaseline: null,
          previousTemperature: null,
        };
        states.set(attribution.batteryId, state);
      }

      const atMs = measuredAt.getTime();
      const elapsedMs = state.sessionStartedAtMs === null ? null : atMs - state.sessionStartedAtMs;
      if (frame.pressure_raw !== null && (elapsedMs === null || (elapsedMs >= 0 && elapsedMs <= BASELINE_WINDOW_MS))) {
        state.pressureSamples.push(frame.pressure_raw);
      }
      if (state.pressureBaseline === null && elapsedMs !== null && elapsedMs >= BASELINE_WINDOW_MS) {
        state.pressureBaseline = median(state.pressureSamples);
      }

      let tempRiseRateCPerMin: number | null = null;
      if (frame.temp_ir_surface !== null && state.previousTemperature && atMs > state.previousTemperature.atMs) {
        tempRiseRateCPerMin = (frame.temp_ir_surface - state.previousTemperature.value)
          / ((atMs - state.previousTemperature.atMs) / 60_000);
      }
      if (frame.temp_ir_surface !== null) {
        state.previousTemperature = { atMs, value: frame.temp_ir_surface };
      }

      const sample: FailsafeSample = {
        tempContact: frame.temp_contact,
        tempIrSurface: frame.temp_ir_surface,
        tempRiseRateCPerMin,
        pressureRaw: frame.pressure_raw,
        pressureBaseline: state.pressureBaseline,
        gasRaw: frame.gas_raw,
      };
      samples.set(frameKey, sample);
      if (samples.size > 2048) samples.delete(samples.keys().next().value as string);
      return { ...sample };
    },
  };
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

export class RawMetricsConsumer {
  private readonly logger: TelemetryLogger;
  private readonly tracker = createSafetySampleTracker();
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
        throw new Error(`unsupported Kafka topic: ${payload.topic}`);
      }
      const input = parseJsonMessage(payload.message.value);
      const result = await ingestRawMetricsFrame(this.options.db, input);
      if (result.attribution.batteryId && result.attribution.hardwareProfile && this.options.onDurableFrame) {
        const durableFrame: DurableTelemetryFrame = {
          ...result,
          batteryId: result.attribution.batteryId,
          hardwareProfile: result.attribution.hardwareProfile,
          safetySample: this.tracker.sampleFor(result),
        };
        await serializeByKey(this.pendingByBattery, result.attribution.batteryId, () => this.options.onDurableFrame!(durableFrame));
      }
      await this.options.consumer.commitOffsets([{
        topic: payload.topic,
        partition: payload.partition,
        offset: nextOffset(payload.message.offset),
      }]);
    } catch (error) {
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
  if (value === null) throw new Error("Kafka message has no value");
  try {
    return JSON.parse(typeof value === "string" ? value : value.toString("utf8")) as unknown;
  } catch {
    throw new Error("Kafka message is not valid JSON");
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
