import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
  KAFKA_TOPICS,
  parseBackendOutboundCommandEvent,
  partitionKeyForBackendOutboundCommandEvent,
  type BackendOutboundCommandEvent,
} from "./kafka.js";
import type { KafkaDeviceCommandPublisher } from "./device/kafka.js";

type QueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

export type OutboxQueryExecutor = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type OutboxDbClient = OutboxQueryExecutor & {
  release(): void;
};

export type OutboxDbPool = OutboxQueryExecutor & {
  connect(): Promise<OutboxDbClient>;
};

type OutboxRowData = {
  id: string | number;
  topic: string;
  partition_key: string | null;
  payload: unknown;
  event_id: string;
  dedupe_key: string;
  created_at: string | Date;
  sent_at: string | Date | null;
  attempts: number | string;
  last_error: string | null;
  next_attempt_at: string | Date;
  claimed_by: string | null;
  claim_token: string | null;
  claimed_at: string | Date | null;
  lease_until: string | Date | null;
  dead_at: string | Date | null;
};

export type OutboxRow = {
  id: string;
  topic: string;
  partitionKey: string | null;
  payload: unknown;
  eventId: string;
  dedupeKey: string;
  createdAt: Date;
  sentAt: Date | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  claimedBy: string | null;
  claimToken: string;
  claimedAt: Date | null;
  leaseUntil: Date | null;
  deadAt: Date | null;
};

export type OutboxClaimOptions = {
  workerId: string;
  batchSize: number;
  leaseMs: number;
};

export type OutboxProcessResult = {
  claimed: number;
  published: number;
  acknowledged: number;
  retried: number;
  poisoned: number;
};

export type OutboxWorkerOptions = {
  db: OutboxDbPool;
  publisher: KafkaDeviceCommandPublisher;
  workerId?: string;
  batchSize?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  logger?: (message: string, details?: Record<string, unknown>) => void;
};

export type OutboxRuntimeGate = {
  dataMode: string;
  nodeEnv: string;
  kafkaEnabled: boolean;
};

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 60_000;
const DEFAULT_LOGGER = (message: string, details?: Record<string, unknown>): void => {
  console.error(`[outbox-worker] ${message}`, details ?? "");
};

/** PostgreSQL/Kafka are both required; memory and test paths stay disconnected. */
export function shouldStartOutboxWorker(gate: OutboxRuntimeGate): boolean {
  return gate.dataMode === "postgres" && gate.nodeEnv !== "test" && gate.kafkaEnabled;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`OUTBOX_${name}_INVALID`);
  return value;
}

function asDate(value: string | Date | null | undefined, field: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid outbox ${field}`);
  return date;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function mapOutboxRow(row: OutboxRowData): OutboxRow {
  const claimToken = String(row.claim_token ?? "").trim();
  if (!claimToken) throw new Error("outbox claim token missing");
  const nextAttemptAt = asDate(row.next_attempt_at, "next_attempt_at");
  const createdAt = asDate(row.created_at, "created_at");
  if (!nextAttemptAt || !createdAt) throw new Error("outbox timestamp missing");
  return {
    id: String(row.id),
    topic: String(row.topic ?? ""),
    partitionKey: row.partition_key == null ? null : String(row.partition_key),
    payload: jsonValue(row.payload),
    eventId: String(row.event_id ?? ""),
    dedupeKey: String(row.dedupe_key ?? ""),
    createdAt,
    sentAt: asDate(row.sent_at, "sent_at"),
    attempts: Number(row.attempts),
    lastError: row.last_error == null ? null : String(row.last_error),
    nextAttemptAt,
    claimedBy: row.claimed_by == null ? null : String(row.claimed_by),
    claimToken,
    claimedAt: asDate(row.claimed_at, "claimed_at"),
    leaseUntil: asDate(row.lease_until, "lease_until"),
    deadAt: asDate(row.dead_at, "dead_at"),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Exponential retry delay for the already-incremented attempt count.
 * No jitter is used: ordering and unit-test timing stay deterministic while
 * the capped delay prevents a failed broker from causing a hot loop.
 */
export function outboxRetryDelayMs(attempts: number, baseMs = DEFAULT_RETRY_BASE_MS, maxMs = DEFAULT_RETRY_MAX_MS): number {
  positiveInteger(baseMs, "RETRY_BASE");
  positiveInteger(maxMs, "RETRY_MAX");
  if (!Number.isFinite(attempts) || attempts < 1) return baseMs;
  const exponent = Math.min(Math.max(Math.trunc(attempts) - 1, 0), 30);
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

/**
 * Claim only the head unsent row for each battery partition.  An earlier row
 * remains a blocker even while it is in backoff or leased by another worker;
 * different battery partitions can still be claimed in the same transaction.
 */
export async function claimOutboxRows(db: OutboxDbPool, options: OutboxClaimOptions): Promise<OutboxRow[]> {
  const workerId = options.workerId.trim();
  positiveInteger(options.batchSize, "BATCH_SIZE");
  positiveInteger(options.leaseMs, "LEASE");
  if (!workerId) throw new Error("OUTBOX_WORKER_ID_INVALID");

  const claimToken = `claim_${randomUUID()}`;
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await client.query<OutboxRowData>(`
      with eligible as (
        select o.id
        from outbox o
        where o.sent_at is null
          and o.dead_at is null
          and coalesce(o.next_attempt_at, o.created_at) <= clock_timestamp()
          and (o.lease_until is null or o.lease_until <= clock_timestamp())
          and not exists (
            select 1
            from outbox earlier
            where earlier.partition_key is not distinct from o.partition_key
              and earlier.id < o.id
              and earlier.sent_at is null
              and earlier.dead_at is null
          )
        order by o.id asc
        limit $1
        for update skip locked
      )
      update outbox o
      set claimed_by = $2,
          claim_token = $3,
          claimed_at = clock_timestamp(),
          lease_until = clock_timestamp() + ($4::bigint * interval '1 millisecond'),
          attempts = o.attempts + 1
      from eligible
      where o.id = eligible.id
      returning o.id, o.topic, o.partition_key, o.payload,
                o.event_id, o.dedupe_key, o.created_at, o.sent_at,
                o.attempts, o.last_error, o.next_attempt_at,
                o.claimed_by, o.claim_token, o.claimed_at,
                o.lease_until, o.dead_at
    `, [options.batchSize, workerId, claimToken, options.leaseMs]);
    await client.query("commit");
    return result.rows.map(mapOutboxRow);
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Keep the original claim failure; no row was acknowledged.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Clear leases left by a crashed/restarted worker. */
export async function recoverExpiredOutboxClaims(db: OutboxDbPool): Promise<number> {
  const client = await db.connect();
  try {
    const result = await client.query<{ id: string }>(`
      update outbox
      set claimed_by = null,
          claim_token = null,
          claimed_at = null,
          lease_until = null
      where sent_at is null
        and dead_at is null
        and lease_until is not null
        and lease_until <= clock_timestamp()
      returning id
    `);
    return result.rowCount ?? result.rows.length;
  } finally {
    client.release();
  }
}

async function updateClaimedRow(
  db: OutboxDbPool,
  text: string,
  values: unknown[],
): Promise<boolean> {
  const client = await db.connect();
  try {
    const result = await client.query<{ id: string }>(text, values);
    return (result.rowCount ?? result.rows.length) > 0;
  } finally {
    client.release();
  }
}

export async function markOutboxSent(db: OutboxDbPool, row: OutboxRow): Promise<boolean> {
  return updateClaimedRow(db, `
    update outbox
    set sent_at = clock_timestamp(),
        last_error = null,
        claimed_by = null,
        claim_token = null,
        claimed_at = null,
        lease_until = null
    where id = $1
      and event_id = $2
      and claim_token = $3
      and dedupe_key = $4
      and sent_at is null
      and dead_at is null
    returning id
  `, [row.id, row.eventId, row.claimToken, row.dedupeKey]);
}

export async function markOutboxRetry(
  db: OutboxDbPool,
  row: OutboxRow,
  error: string,
  delayMs: number,
): Promise<boolean> {
  positiveInteger(Math.max(1, Math.ceil(delayMs)), "RETRY_DELAY");
  return updateClaimedRow(db, `
    update outbox
    set last_error = $5,
        next_attempt_at = clock_timestamp() + ($6::bigint * interval '1 millisecond'),
        claimed_by = null,
        claim_token = null,
        claimed_at = null,
        lease_until = null
    where id = $1
      and event_id = $2
      and claim_token = $3
      and dedupe_key = $4
      and sent_at is null
      and dead_at is null
    returning id
  `, [row.id, row.eventId, row.claimToken, row.dedupeKey, error.slice(0, 4000), Math.max(1, Math.ceil(delayMs))]);
}

/**
 * Permanently quarantine a malformed outbox row.  It remains unsent (`sent_at
 *` is null), but `dead_at` removes it from the per-battery ordering chain so a
 * corrupt command cannot wedge later safety commands forever.
 */
export async function markOutboxPoison(db: OutboxDbPool, row: OutboxRow, error: string): Promise<boolean> {
  return updateClaimedRow(db, `
    update outbox
    set dead_at = clock_timestamp(),
        last_error = $5,
        claimed_by = null,
        claim_token = null,
        claimed_at = null,
        lease_until = null
    where id = $1
      and event_id = $2
      and claim_token = $3
      and dedupe_key = $4
      and sent_at is null
      and dead_at is null
    returning id
  `, [row.id, row.eventId, row.claimToken, row.dedupeKey, `POISON: ${error}`.slice(0, 4000)]);
}

class PoisonOutboxRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoisonOutboxRowError";
  }
}

function validateOutboxRow(row: OutboxRow): BackendOutboundCommandEvent {
  if (!row.topic.trim() || row.topic !== KAFKA_TOPICS.events) {
    throw new PoisonOutboxRowError(`unsupported outbox topic: ${row.topic}`);
  }
  if (!row.eventId.trim() || !row.dedupeKey.trim()) {
    throw new PoisonOutboxRowError("outbox durable identity is blank");
  }
  if (!row.partitionKey?.trim()) {
    throw new PoisonOutboxRowError("outbox partition_key is blank");
  }
  if (!Number.isInteger(row.attempts) || row.attempts < 1) {
    throw new PoisonOutboxRowError("outbox attempts is invalid");
  }
  try {
    const event = parseBackendOutboundCommandEvent(row.payload);
    if (partitionKeyForBackendOutboundCommandEvent(event) !== row.partitionKey) {
      throw new PoisonOutboxRowError("outbox partition_key does not match batteryId");
    }
    return event;
  } catch (error) {
    if (error instanceof PoisonOutboxRowError) throw error;
    if (error instanceof ZodError) throw new PoisonOutboxRowError("outbox payload failed version-1 schema validation");
    throw new PoisonOutboxRowError(errorText(error));
  }
}

type RowOutcome = "published" | "retried" | "poisoned";

export class OutboxWorker {
  private readonly logger: (message: string, details?: Record<string, unknown>) => void;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private started = false;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private processingPromise: Promise<OutboxProcessResult> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private waitResolver: (() => void) | null = null;

  constructor(private readonly options: OutboxWorkerOptions) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.workerId = (options.workerId ?? `outbox_${randomUUID()}`).trim();
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    if (!this.workerId) throw new Error("OUTBOX_WORKER_ID_INVALID");
    positiveInteger(this.batchSize, "BATCH_SIZE");
    positiveInteger(this.leaseMs, "LEASE");
    positiveInteger(this.pollIntervalMs, "POLL_INTERVAL");
    positiveInteger(this.retryBaseMs, "RETRY_BASE");
    positiveInteger(this.retryMaxMs, "RETRY_MAX");
  }

  get isRunning(): boolean {
    return this.started && !this.stopping;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.stopping = false;
    await recoverExpiredOutboxClaims(this.options.db);
    try {
      await this.options.publisher.connect();
    } catch (error) {
      await this.options.publisher.disconnect().catch(() => undefined);
      throw error;
    }
    this.started = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeLoop();
    const loop = this.loopPromise;
    if (loop) await loop;
    const processing = this.processingPromise;
    if (processing) await processing.catch(() => undefined);
    try {
      await this.options.publisher.disconnect();
    } finally {
      this.started = false;
      this.loopPromise = null;
    }
  }

  async processOnce(): Promise<OutboxProcessResult> {
    if (this.processingPromise) return this.processingPromise;
    const promise = this.processBatch();
    this.processingPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.processingPromise === promise) this.processingPromise = null;
    }
  }

  private async processBatch(): Promise<OutboxProcessResult> {
    const rows = await claimOutboxRows(this.options.db, {
      workerId: this.workerId,
      batchSize: this.batchSize,
      leaseMs: this.leaseMs,
    });
    const result: OutboxProcessResult = { claimed: rows.length, published: 0, acknowledged: 0, retried: 0, poisoned: 0 };
    const outcomes = await Promise.all(rows.map(async (row): Promise<{ outcome: RowOutcome; acknowledged: boolean }> => {
      try {
        const event = validateOutboxRow(row);
        await this.options.publisher.publish(event, row.eventId, {
          topic: row.topic,
          partitionKey: row.partitionKey!,
        });
        const acknowledged = await markOutboxSent(this.options.db, row);
        return { outcome: "published", acknowledged };
      } catch (error) {
        if (error instanceof PoisonOutboxRowError) {
          const quarantined = await markOutboxPoison(this.options.db, row, error.message);
          this.logger("poison outbox row quarantined", { id: row.id, eventId: row.eventId, quarantined, error: error.message });
          return { outcome: "poisoned", acknowledged: false };
        }
        const delayMs = outboxRetryDelayMs(row.attempts, this.retryBaseMs, this.retryMaxMs);
        const retried = await markOutboxRetry(this.options.db, row, errorText(error), delayMs);
        this.logger("outbox publish failed; retry scheduled", { id: row.id, eventId: row.eventId, retried, delayMs, error: errorText(error) });
        return { outcome: "retried", acknowledged: false };
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.outcome === "published") {
        result.published += 1;
        if (outcome.acknowledged) result.acknowledged += 1;
      } else if (outcome.outcome === "retried") {
        result.retried += 1;
      } else {
        result.poisoned += 1;
      }
    }
    return result;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const result = await this.processOnce();
        if (result.claimed === 0) await this.waitForNextPoll();
      } catch (error) {
        this.logger("delivery loop failed; will retry", { error: errorText(error) });
        await this.waitForNextPoll();
      }
    }
  }

  private waitForNextPoll(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      this.waitResolver = resolve;
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null;
        this.waitResolver = null;
        resolve();
      }, this.pollIntervalMs);
    });
  }

  private wakeLoop(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    const resolve = this.waitResolver;
    this.waitResolver = null;
    resolve?.();
  }
}

export function createOutboxWorker(options: OutboxWorkerOptions): OutboxWorker {
  return new OutboxWorker(options);
}
