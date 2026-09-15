import { createHash } from "node:crypto";
import { Kafka, type EachMessagePayload } from "kafkajs";
import { ZodError } from "zod";

import { parseBatteryAnomalyAlert, type BatteryAnomalyAlert } from "./kafka.js";
import { gradeForScore, type Grade } from "./realtime/grade.js";

type QueryResult<Row> = { rows: Row[] };

export type AnomalyQueryExecutor = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type AnomalyDbClient = AnomalyQueryExecutor & {
  release(): void;
};

export type AnomalyDbPool = {
  connect(): Promise<AnomalyDbClient>;
};

type ActiveSessionRow = {
  id: string;
  battery_id: string;
  target_mode: number | string;
  battery_target_mode: number | string;
};

type PersistedAnomalyRow = {
  device_id?: string;
  battery_id?: string | null;
  session_id?: string | null;
  evaluated_at?: string | Date;
  score?: number | string;
  ae_score?: number | string | null;
  informer_score?: number | string | null;
  contributions?: unknown;
  model_version?: string | null;
  temp_kalman?: number | string | null;
  temp_cell_estimated?: number | string | null;
};

type LatestAnomalyRow = {
  score?: number | string | null;
  evaluated_at?: string | Date | null;
};

export type AnomalyAttribution = {
  sessionId: string | null;
  batteryId: string | null;
};

/** The durable row and its processing-time attribution. */
export type DurableAnomalyScore = {
  deviceId: string;
  batteryId: string | null;
  sessionId: string | null;
  evaluatedAt: Date;
  score: number;
  aeScore: number | null;
  informerScore: number | null;
  contributions: Array<{ feature: string; contribution: number }> | null;
  modelVersion: string | null;
  tempKalman: number | null;
  tempCellEstimated: number | null;
};

export type AnomalyIngestResult = {
  kind: "accepted" | "duplicate";
  alert: BatteryAnomalyAlert;
  /** Alias retained for callers that use the topic payload terminology. */
  payload: BatteryAnomalyAlert;
  anomaly: DurableAnomalyScore;
  record: DurableAnomalyScore;
  evaluatedAt: Date;
  attribution: AnomalyAttribution;
  /** True only for a newly inserted row with a valid active-session tag. */
  latestCandidate: boolean;
  /** True only when this result advanced battery_latest. */
  latestUpdated: boolean;
  previousScore: number | null;
  previousGrade: Grade | null;
  grade: Grade | null;
  shouldEmitEvents: boolean;
};

export type AnomalyLogger = (message: string, details?: Record<string, unknown>) => void;

export type KafkaAnomalyMessage = {
  offset: string;
  value: Buffer | string | null;
};

export type KafkaAnomalyMessagePayload = {
  topic: string;
  partition: number;
  message: KafkaAnomalyMessage;
};

export type KafkaAnomalyConsumer = {
  connect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(options: { autoCommit?: boolean; eachMessage(payload: KafkaAnomalyMessagePayload): Promise<void> }): Promise<void>;
  commitOffsets(offsets: Array<{ topic: string; partition: number; offset: string }>): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
};

export type AnomalyConsumerOptions = {
  db: AnomalyDbPool;
  topic: string;
  consumer: KafkaAnomalyConsumer;
  /** Called after a new score has durably advanced battery_latest. */
  onDurableAnomaly?: (result: AnomalyIngestResult) => Promise<void>;
  /** Alias for integrations that call the callback onAnomaly. */
  onAnomaly?: (result: AnomalyIngestResult) => Promise<void>;
  logger?: AnomalyLogger;
};

export type CreateKafkaAnomalyConsumerOptions = Omit<AnomalyConsumerOptions, "consumer"> & {
  brokers: string[];
  clientId: string;
  groupId: string;
};

const DEFAULT_LOGGER: AnomalyLogger = (message, details) => {
  console.error(`[anomaly-consumer] ${message}`, details ?? "");
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function dateValue(value: string | Date, errorMessage: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(errorMessage);
  return date;
}

function utcDate(timestamp: string): Date {
  return dateValue(timestamp, "invalid anomaly timestamp");
}

function modeOrNull(value: unknown): 1 | 2 | null {
  return value === 1 || value === "1" ? 1 : value === 2 || value === "2" ? 2 : null;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function jsonParameter(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function contributionsOrNull(value: unknown, fallback: DurableAnomalyScore["contributions"]): DurableAnomalyScore["contributions"] {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return fallback;
  return parsed.map((item) => ({
    feature: String((item as { feature?: unknown }).feature ?? ""),
    contribution: Number((item as { contribution?: unknown }).contribution),
  }));
}

function persistedAnomalyRow(row: PersistedAnomalyRow, fallback: DurableAnomalyScore): DurableAnomalyScore {
  const evaluatedAt = row.evaluated_at === undefined
    ? fallback.evaluatedAt
    : dateValue(row.evaluated_at, "invalid persisted anomaly timestamp");
  const score = numberOrNull(row.score) ?? fallback.score;
  return {
    deviceId: row.device_id === undefined ? fallback.deviceId : String(row.device_id),
    batteryId: row.battery_id === undefined ? fallback.batteryId : stringOrNull(row.battery_id),
    sessionId: row.session_id === undefined ? fallback.sessionId : stringOrNull(row.session_id),
    evaluatedAt,
    score,
    aeScore: row.ae_score === undefined ? fallback.aeScore : numberOrNull(row.ae_score),
    informerScore: row.informer_score === undefined ? fallback.informerScore : numberOrNull(row.informer_score),
    contributions: contributionsOrNull(row.contributions, fallback.contributions),
    modelVersion: row.model_version === undefined ? fallback.modelVersion : stringOrNull(row.model_version),
    tempKalman: row.temp_kalman === undefined ? fallback.tempKalman : numberOrNull(row.temp_kalman),
    tempCellEstimated: row.temp_cell_estimated === undefined ? fallback.tempCellEstimated : numberOrNull(row.temp_cell_estimated),
  };
}

function offsetAfter(offset: string): string {
  if (!/^\d+$/.test(offset)) throw new Error(`invalid Kafka offset: ${offset}`);
  return (BigInt(offset) + 1n).toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A malformed JSON or contract payload is permanent poison for this topic. */
class PoisonAnomalyMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoisonAnomalyMessageError";
  }
}

function parseJsonMessage(value: Buffer | string | null): unknown {
  if (value === null) throw new PoisonAnomalyMessageError("Kafka message has no value");
  try {
    return JSON.parse(typeof value === "string" ? value : value.toString("utf8")) as unknown;
  } catch {
    throw new PoisonAnomalyMessageError("Kafka message is not valid JSON");
  }
}

function activeSessionAttribution(row: ActiveSessionRow | undefined): AnomalyAttribution {
  if (!row) return { sessionId: null, batteryId: null };
  // There is no mode in the AI contract. The join in ingestAnomalyAlert
  // verifies that the session and asset agree before this row is returned.
  if (!modeOrNull(row.target_mode) || !modeOrNull(row.battery_target_mode)
    || modeOrNull(row.target_mode) !== modeOrNull(row.battery_target_mode)) {
    return { sessionId: null, batteryId: null };
  }
  return { sessionId: String(row.id), batteryId: String(row.battery_id) };
}

/**
 * Persist one v1 AI result. The transaction is also the offset boundary: the
 * caller must not acknowledge Kafka until this function and its callback have
 * completed successfully.
 */
export async function ingestAnomalyAlert(
  db: AnomalyDbPool,
  input: unknown,
): Promise<AnomalyIngestResult> {
  const alert = parseBatteryAnomalyAlert(input);
  const evaluatedAt = utcDate(alert.evaluated_at);
  const client = await db.connect();
  let committed = false;

  const inputRecord: DurableAnomalyScore = {
    deviceId: alert.device_id,
    batteryId: null,
    sessionId: null,
    evaluatedAt,
    score: alert.score,
    aeScore: alert.ae_score,
    informerScore: alert.informer_score,
    contributions: alert.contributions,
    modelVersion: alert.model_version,
    tempKalman: alert.temp_kalman,
    tempCellEstimated: alert.temp_cell_estimated,
  };

  try {
    await client.query("begin");

    // Registration is an explicit trust boundary. An AI process cannot make
    // up a device/session relationship merely by choosing an identifier.
    const deviceResult = await client.query<{ id: string }>(`
      select id
      from device
      where id = $1
    `, [alert.device_id]);
    const registeredDevice = deviceResult.rows.length > 0;

    let session: ActiveSessionRow | undefined;
    if (registeredDevice) {
      const sessionResult = await client.query<ActiveSessionRow>(`
        select s.id, s.battery_id, s.target_mode,
               b.target_mode as battery_target_mode
        from measurement_session s
        join device d on d.id = s.device_id
        join battery_asset b on b.id = s.battery_id
        where s.device_id = $1
          and s.status = 'ACTIVE'
          and s.target_mode = b.target_mode
        order by s.started_at desc
        limit 1
      `, [alert.device_id]);
      session = sessionResult.rows[0];
    }

    const attribution = activeSessionAttribution(session);
    inputRecord.batteryId = attribution.batteryId;
    inputRecord.sessionId = attribution.sessionId;

    const insertResult = await client.query<PersistedAnomalyRow>(`
      insert into anomaly_score (
        device_id, battery_id, session_id, evaluated_at, score,
        ae_score, informer_score, contributions, model_version,
        temp_kalman, temp_cell_estimated
      ) values (
        $1, $2, $3, $4, $5,
        $6, $7, $8::jsonb, $9,
        $10, $11
      )
      on conflict (device_id, evaluated_at) do nothing
      returning device_id, battery_id, session_id, evaluated_at, score,
                ae_score, informer_score, contributions, model_version,
                temp_kalman, temp_cell_estimated
    `, [
      alert.device_id,
      attribution.batteryId,
      attribution.sessionId,
      evaluatedAt,
      alert.score,
      alert.ae_score,
      alert.informer_score,
      jsonParameter(alert.contributions),
      alert.model_version,
      alert.temp_kalman,
      alert.temp_cell_estimated,
    ]);

    const inserted = insertResult.rows.length > 0;
    let effectiveRecord = inputRecord;
    if (!inserted) {
      // Replay attribution is immutable. Do not retag an old result against a
      // later active session (or erase a tag when the session has ended).
      const existingResult = await client.query<PersistedAnomalyRow>(`
        select device_id, battery_id, session_id, evaluated_at, score,
               ae_score, informer_score, contributions, model_version,
               temp_kalman, temp_cell_estimated
        from anomaly_score
        where device_id = $1 and evaluated_at = $2
        limit 1
      `, [alert.device_id, evaluatedAt]);
      const existing = existingResult.rows[0];
      if (!existing) throw new Error("anomaly duplicate row could not be read");
      effectiveRecord = persistedAnomalyRow(existing, inputRecord);
    }

    let previousScore: number | null = null;
    let latestUpdated = false;
    let previousGrade: Grade | null = null;
    let grade: Grade | null = null;

    if (inserted && effectiveRecord.batteryId) {
      const previousResult = await client.query<LatestAnomalyRow>(`
        select score, evaluated_at
        from battery_latest
        where battery_id = $1
        for update
      `, [effectiveRecord.batteryId]);
      const previous = previousResult.rows[0];
      previousScore = numberOrNull(previous?.score);
      if (previous?.evaluated_at != null) dateValue(previous.evaluated_at, "invalid latest anomaly timestamp");

      // Only score/evaluated_at are touched. A score result must never erase a
      // real sensor snapshot in the same cache row.
      const latestResult = await client.query<{ battery_id: string; score: number; evaluated_at: Date }>(`
        insert into battery_latest (battery_id, score, evaluated_at, updated_at)
        values ($1, $2, $3, now())
        on conflict (battery_id) do update set
          score = excluded.score,
          evaluated_at = excluded.evaluated_at,
          updated_at = now()
        where battery_latest.evaluated_at is null
           or excluded.evaluated_at > battery_latest.evaluated_at
        returning battery_id, score, evaluated_at
      `, [effectiveRecord.batteryId, effectiveRecord.score, effectiveRecord.evaluatedAt]);

      latestUpdated = latestResult.rows.length > 0;

      previousGrade = latestUpdated ? gradeForScore(previousScore) : null;
      grade = gradeForScore(effectiveRecord.score);
      if (latestUpdated && previousGrade && grade && previousGrade !== grade) {
        const dedupeKey = `anomaly-grade:${effectiveRecord.deviceId}:${effectiveRecord.evaluatedAt.toISOString()}`;
        await client.query(`
          insert into domain_event (
            id, event_type, severity, source, device_id, battery_id, session_id,
            occurred_at, score, params, acknowledged_at, acknowledged_by, dedupe_key
          ) values (
            $1, 'ANOMALY_GRADE_CHANGED', $2, 'AI', $3, $4, $5,
            $6, $7, $8::jsonb, null, null, $9
          )
          on conflict (dedupe_key) do nothing
        `, [
          `evt_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 32)}`,
          grade,
          effectiveRecord.deviceId,
          effectiveRecord.batteryId,
          effectiveRecord.sessionId,
          effectiveRecord.evaluatedAt,
          effectiveRecord.score,
          JSON.stringify({
            from: previousGrade,
            to: grade,
            previousScore,
            score: effectiveRecord.score,
            evaluatedAt: effectiveRecord.evaluatedAt.toISOString(),
          }),
          dedupeKey,
        ]);
      }
    }

    await client.query("commit");
    committed = true;

    if (!grade) grade = gradeForScore(effectiveRecord.score);
    const result: AnomalyIngestResult = {
      kind: inserted ? "accepted" : "duplicate",
      alert,
      payload: alert,
      anomaly: effectiveRecord,
      record: effectiveRecord,
      evaluatedAt: effectiveRecord.evaluatedAt,
      attribution: { sessionId: effectiveRecord.sessionId, batteryId: effectiveRecord.batteryId },
      latestCandidate: inserted && Boolean(effectiveRecord.batteryId),
      latestUpdated,
      previousScore,
      previousGrade,
      grade,
      shouldEmitEvents: inserted && latestUpdated && Boolean(effectiveRecord.batteryId),
    };
    return result;
  } catch (error) {
    if (!committed) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original DB failure; Kafka remains uncommitted.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function nextOffset(offset: string): string {
  return offsetAfter(offset);
}

export class AnomalyAlertsConsumer {
  private readonly logger: AnomalyLogger;
  private readonly pendingNotifications = new Map<string, AnomalyIngestResult>();
  private connected = false;
  private stopping = false;
  private runPromise: Promise<void> | null = null;

  constructor(private readonly options: AnomalyConsumerOptions) {
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

  async handleMessage(payload: KafkaAnomalyMessagePayload): Promise<void> {
    try {
      if (payload.topic !== this.options.topic) {
        throw new PoisonAnomalyMessageError(`unsupported Kafka topic: ${payload.topic}`);
      }
      const input = parseJsonMessage(payload.message.value);
      let result: AnomalyIngestResult;
      try {
        result = await ingestAnomalyAlert(this.options.db, input);
      } catch (error) {
        if (error instanceof ZodError) throw new PoisonAnomalyMessageError("Kafka message failed anomaly schema validation");
        throw error;
      }

      // A duplicate natural key is a durable no-op. In particular it must not
      // recreate grade transitions or alerts during Kafka replay. If the
      // previous post-commit callback failed, retain that one result in memory
      // so the replay retries the failed notification instead of dropping it.
      const eventKey = `${result.anomaly.deviceId}:${result.anomaly.evaluatedAt.toISOString()}`;
      const pending = this.pendingNotifications.get(eventKey);
      if (result.shouldEmitEvents || pending) {
        const callback = this.options.onDurableAnomaly ?? this.options.onAnomaly;
        if (callback) {
          try {
            await callback(pending ?? result);
            this.pendingNotifications.delete(eventKey);
          } catch (error) {
            this.pendingNotifications.set(eventKey, pending ?? result);
            throw error;
          }
        }
      }

      await this.options.consumer.commitOffsets([{
        topic: payload.topic,
        partition: payload.partition,
        offset: nextOffset(payload.message.offset),
      }]);
    } catch (error) {
      if (error instanceof PoisonAnomalyMessageError) {
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
      this.runPromise = null;
    }
  }
}

/** Short alias for callers that do not use the topic's full name. */
export const AnomalyConsumer = AnomalyAlertsConsumer;

function assertKafkaConsumerConfig(options: Pick<CreateKafkaAnomalyConsumerOptions, "brokers" | "clientId" | "groupId" | "topic">): void {
  if (options.brokers.length === 0 || !options.clientId.trim() || !options.groupId.trim() || !options.topic.trim()) {
    throw new Error("KAFKA_CONSUMER_CONFIG_INVALID");
  }
}

export function createKafkaAnomalyAlertsConsumer(options: CreateKafkaAnomalyConsumerOptions): AnomalyAlertsConsumer {
  assertKafkaConsumerConfig(options);
  const kafka = new Kafka({ clientId: options.clientId, brokers: options.brokers });
  const kafkaConsumer = kafka.consumer({ groupId: options.groupId });
  const consumer: KafkaAnomalyConsumer = {
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
  return new AnomalyAlertsConsumer({ ...options, consumer });
}

export const createKafkaAnomalyConsumer = createKafkaAnomalyAlertsConsumer;
