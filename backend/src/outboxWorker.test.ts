import { describe, expect, it, vi } from "vitest";

import {
  OutboxWorker,
  claimOutboxRows,
  createOutboxWorker,
  markOutboxPoison,
  outboxRetryDelayMs,
  recoverExpiredOutboxClaims,
  shouldStartOutboxWorker,
  type FailsafeCutOutboxAcknowledgement,
  type OutboxDbClient,
  type OutboxDbPool,
  type OutboxRow,
} from "./outboxWorker.js";
import type { KafkaDeviceCommandPublisher } from "./device/kafka.js";

type FakeRow = {
  id: number;
  topic: string;
  partition_key: string | null;
  payload: unknown;
  event_id: string;
  dedupe_key: string;
  created_at: Date;
  sent_at: Date | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  claimed_by: string | null;
  claim_token: string | null;
  claimed_at: Date | null;
  lease_until: Date | null;
  dead_at: Date | null;
};

function event(code: "RELAY_CUT" | "RELAY_RESTORE", batteryId: string, reasonCode = "USER") {
  return code === "RELAY_CUT"
    ? { version: 1, code, params: { batteryId, reasonCode } }
    : { version: 1, code, params: { batteryId } };
}

function row(id: number, batteryId: string, payload: unknown = event("RELAY_CUT", batteryId)): FakeRow {
  const now = new Date();
  return {
    id,
    topic: "battery-events",
    partition_key: batteryId,
    payload,
    event_id: `evt-${id}`,
    dedupe_key: `dedupe-${id}`,
    created_at: now,
    sent_at: null,
    attempts: 0,
    last_error: null,
    next_attempt_at: new Date(now.getTime() - 1),
    claimed_by: null,
    claim_token: null,
    claimed_at: null,
    lease_until: null,
    dead_at: null,
  };
}

function failsafeRow(id: number, batteryId: string, reasonCode: string): FakeRow {
  const result = row(id, batteryId, event("RELAY_CUT", batteryId, reasonCode));
  result.dedupe_key = `failsafe-relay-cut:${batteryId}:${reasonCode}:fixture-condition`;
  return result;
}

/** Small SQL-aware fake to exercise the real claim/update boundaries. */
class FakeOutboxDb implements OutboxDbPool {
  readonly queries: Array<{ text: string; values: unknown[] }> = [];
  readonly client: OutboxDbClient;
  failNextSentAck = false;

  constructor(readonly rows: FakeRow[]) {
    this.client = {
      query: async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => {
        this.queries.push({ text, values });
        const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
        if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] } as { rows: T[] };
        if (normalized.startsWith("with eligible as")) {
          const limit = Number(values[0]);
          const workerId = String(values[1]);
          const claimToken = String(values[2]);
          const leaseMs = Number(values[3]);
          const now = Date.now();
          const candidates = this.rows
            .filter((candidate) => candidate.sent_at === null && candidate.dead_at === null
              && candidate.next_attempt_at.getTime() <= now
              && (candidate.lease_until === null || candidate.lease_until.getTime() <= now))
            .filter((candidate) => !this.rows.some((earlier) => earlier.id < candidate.id
              && earlier.partition_key === candidate.partition_key
              && earlier.sent_at === null && earlier.dead_at === null))
            .sort((left, right) => left.id - right.id)
            .slice(0, limit);
          for (const candidate of candidates) {
            candidate.claimed_by = workerId;
            candidate.claim_token = claimToken;
            candidate.claimed_at = new Date();
            candidate.lease_until = new Date(now + leaseMs);
            candidate.attempts += 1;
          }
          return { rows: candidates.map((candidate) => ({ ...candidate })) } as { rows: T[] };
        }
        if (normalized.startsWith("update outbox set claimed_by = null") && normalized.includes("lease_until <=")) {
          const expired = this.rows.filter((candidate) => candidate.sent_at === null && candidate.dead_at === null
            && candidate.lease_until !== null && candidate.lease_until.getTime() <= Date.now());
          for (const candidate of expired) {
            candidate.claimed_by = null;
            candidate.claim_token = null;
            candidate.claimed_at = null;
            candidate.lease_until = null;
          }
          return { rows: expired.map((candidate) => ({ id: String(candidate.id) })), rowCount: expired.length } as { rows: T[]; rowCount: number };
        }
        if (normalized.startsWith("update outbox set sent_at")) {
          if (this.failNextSentAck) {
            this.failNextSentAck = false;
            throw new Error("sent acknowledgement unavailable");
          }
          const [id, eventId, claimToken, dedupeKey] = values.map(String);
          const candidate = this.rows.find((item) => String(item.id) === id && item.event_id === eventId && item.claim_token === claimToken
            && item.dedupe_key === dedupeKey
            && item.sent_at === null && item.dead_at === null);
          if (!candidate) return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
          candidate.sent_at = new Date();
          candidate.last_error = null;
          candidate.claimed_by = null;
          candidate.claim_token = null;
          candidate.claimed_at = null;
          candidate.lease_until = null;
          return { rows: [{ id: String(candidate.id) }], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        if (normalized.startsWith("update outbox set last_error")) {
          const [id, eventId, claimToken, dedupeKey, error, delayMs] = values;
          const candidate = this.rows.find((item) => String(item.id) === String(id) && item.event_id === String(eventId)
            && item.claim_token === String(claimToken) && item.dedupe_key === String(dedupeKey)
            && item.sent_at === null && item.dead_at === null);
          if (!candidate) return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
          candidate.last_error = String(error);
          candidate.next_attempt_at = new Date(Date.now() + Number(delayMs));
          candidate.claimed_by = null;
          candidate.claim_token = null;
          candidate.claimed_at = null;
          candidate.lease_until = null;
          return { rows: [{ id: String(candidate.id) }], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        if (normalized.startsWith("update outbox set dead_at")) {
          const [id, eventId, claimToken, dedupeKey, error] = values;
          const candidate = this.rows.find((item) => String(item.id) === String(id) && item.event_id === String(eventId)
            && item.claim_token === String(claimToken) && item.dedupe_key === String(dedupeKey)
            && item.sent_at === null && item.dead_at === null);
          if (!candidate) return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
          candidate.dead_at = new Date();
          candidate.last_error = String(error);
          candidate.claimed_by = null;
          candidate.claim_token = null;
          candidate.claimed_at = null;
          candidate.lease_until = null;
          return { rows: [{ id: String(candidate.id) }], rowCount: 1 } as { rows: T[]; rowCount: number };
        }
        return { rows: [] } as { rows: T[] };
      },
      release: vi.fn(),
    };
  }

  async connect(): Promise<OutboxDbClient> {
    return this.client;
  }
}

function fakePublisher(implementation?: (event: unknown, eventId: string) => Promise<void>) {
  const publisher: KafkaDeviceCommandPublisher = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    publish: vi.fn(implementation ?? (async () => undefined)),
  };
  return publisher;
}

function worker(db: FakeOutboxDb, publisher: KafkaDeviceCommandPublisher, extra: Partial<ConstructorParameters<typeof OutboxWorker>[0]> = {}) {
  return createOutboxWorker({
    db,
    publisher,
    workerId: "worker-test",
    batchSize: 1,
    leaseMs: 5_000,
    pollIntervalMs: 50,
    retryBaseMs: 100,
    retryMaxMs: 500,
    logger: vi.fn(),
    ...extra,
  });
}

describe("OutboxWorker claim, retry, and lifecycle", () => {
  it("claims only each battery head and lets another battery progress", async () => {
    const db = new FakeOutboxDb([row(1, "battery-a"), row(2, "battery-a"), row(3, "battery-b")]);
    const [first, second] = await Promise.all([
      claimOutboxRows(db, { workerId: "worker-a", batchSize: 1, leaseMs: 5_000 }),
      claimOutboxRows(db, { workerId: "worker-b", batchSize: 1, leaseMs: 5_000 }),
    ]);
    expect([first, second].flat().map((claimed) => claimed.id).sort()).toEqual(["1", "3"]);
    expect(db.rows.find((candidate) => candidate.id === 2)?.claimed_by).toBeNull();
    expect(db.queries.some((query) => /for update skip locked/i.test(query.text))).toBe(true);
  });

  it("marks sent only after publisher success and carries the durable identity", async () => {
    const db = new FakeOutboxDb([row(1, "battery-a")]);
    const publisher = fakePublisher();
    const result = await worker(db, publisher).processOnce();
    expect(result).toMatchObject({ claimed: 1, published: 1, acknowledged: 1, retried: 0, poisoned: 0 });
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ code: "RELAY_CUT" }), "evt-1", {
      topic: "battery-events",
      partitionKey: "battery-a",
    });
    expect(db.rows[0].sent_at).toBeInstanceOf(Date);
    expect(db.rows[0].last_error).toBeNull();
  });

  it("notifies only a Fail-Safe cut after Kafka publish and sent acknowledgement, never for a manual cut", async () => {
    const failsafe = failsafeRow(1, "battery-a", "FAILSAFE_TEMP_IR_OVER_CAP");
    const manual = row(2, "battery-b", event("RELAY_CUT", "battery-b", "USER"));
    const manualWithFailsafeReason = row(3, "battery-c", event("RELAY_CUT", "battery-c", "FAILSAFE_TEMP_IR_OVER_CAP"));
    const db = new FakeOutboxDb([failsafe, manual, manualWithFailsafeReason]);
    const publisher = fakePublisher();
    const onFailsafeCutOutboxAcknowledged = vi.fn(async (acknowledgement: FailsafeCutOutboxAcknowledgement) => {
      expect(failsafe.sent_at).toBeInstanceOf(Date);
      expect(acknowledgement).toEqual({
        eventId: "evt-1",
        dedupeKey: "failsafe-relay-cut:battery-a:FAILSAFE_TEMP_IR_OVER_CAP:fixture-condition",
        batteryId: "battery-a",
        reasonCode: "FAILSAFE_TEMP_IR_OVER_CAP",
      });
    });

    const result = await worker(db, publisher, { batchSize: 3, onFailsafeCutOutboxAcknowledged }).processOnce();

    expect(result).toMatchObject({ claimed: 3, published: 3, acknowledged: 3, retried: 0, poisoned: 0 });
    expect(failsafe.sent_at).toBeInstanceOf(Date);
    expect(manual.sent_at).toBeInstanceOf(Date);
    expect(manualWithFailsafeReason.sent_at).toBeInstanceOf(Date);
    expect(onFailsafeCutOutboxAcknowledged).toHaveBeenCalledOnce();
  });

  it("publishes no Fail-Safe notification on failure and calls it once after retry succeeds", async () => {
    const db = new FakeOutboxDb([failsafeRow(1, "battery-a", "FAILSAFE_GAS_OVER_CAP")]);
    let publishAttempts = 0;
    const publisher = fakePublisher(async () => {
      publishAttempts += 1;
      if (publishAttempts === 1) throw new Error("broker unavailable");
    });
    const onFailsafeCutOutboxAcknowledged = vi.fn();
    const outbox = worker(db, publisher, { onFailsafeCutOutboxAcknowledged });

    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, published: 0, acknowledged: 0, retried: 1 });
    expect(onFailsafeCutOutboxAcknowledged).not.toHaveBeenCalled();
    expect(db.rows[0].sent_at).toBeNull();
    db.rows[0].next_attempt_at = new Date(Date.now() - 1);

    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, published: 1, acknowledged: 1, retried: 0 });
    expect(await outbox.processOnce()).toMatchObject({ claimed: 0, published: 0, acknowledged: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(onFailsafeCutOutboxAcknowledged).toHaveBeenCalledOnce();
  });

  it("does not notify when sent acknowledgement fails; a later acknowledged retry notifies once", async () => {
    const db = new FakeOutboxDb([failsafeRow(1, "battery-a", "FAILSAFE_GAS_OVER_CAP")]);
    const publisher = fakePublisher();
    const onFailsafeCutOutboxAcknowledged = vi.fn();
    const outbox = worker(db, publisher, { onFailsafeCutOutboxAcknowledged });
    db.failNextSentAck = true;

    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, published: 0, acknowledged: 0, retried: 1 });
    expect(onFailsafeCutOutboxAcknowledged).not.toHaveBeenCalled();
    expect(db.rows[0].sent_at).toBeNull();
    db.rows[0].next_attempt_at = new Date(Date.now() - 1);

    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, published: 1, acknowledged: 1, retried: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(onFailsafeCutOutboxAcknowledged).toHaveBeenCalledOnce();
  });

  it("logs a post-ack callback failure without retrying the sent command", async () => {
    const db = new FakeOutboxDb([failsafeRow(1, "battery-a", "FAILSAFE_TEMP_OVER_CAP")]);
    const publisher = fakePublisher();
    const logger = vi.fn();
    const onFailsafeCutOutboxAcknowledged = vi.fn(async () => { throw new Error("websocket unavailable"); });
    const outbox = worker(db, publisher, { logger, onFailsafeCutOutboxAcknowledged });

    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, published: 1, acknowledged: 1, retried: 0 });
    expect(await outbox.processOnce()).toMatchObject({ claimed: 0, published: 0, acknowledged: 0 });
    expect(db.rows[0].sent_at).toBeInstanceOf(Date);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(onFailsafeCutOutboxAcknowledged).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith(
      "Fail-Safe relay.autoCut callback failed after outbox sent acknowledgement",
      expect.objectContaining({
        eventId: "evt-1",
        dedupeKey: "failsafe-relay-cut:battery-a:FAILSAFE_TEMP_OVER_CAP:fixture-condition",
        batteryId: "battery-a",
        error: "websocket unavailable",
      }),
    );
  });

  it("keeps failed rows unsent, records error, and applies capped exponential backoff", async () => {
    const db = new FakeOutboxDb([row(1, "battery-a"), row(2, "battery-a")]);
    const publisher = fakePublisher(async () => { throw new Error("broker unavailable"); });
    const outbox = worker(db, publisher, { retryBaseMs: 100, retryMaxMs: 300 });
    const before = Date.now();
    expect(await outbox.processOnce()).toMatchObject({ claimed: 1, retried: 1, published: 0 });
    expect(db.rows[0].sent_at).toBeNull();
    expect(db.rows[0].last_error).toContain("broker unavailable");
    expect(db.rows[0].next_attempt_at.getTime()).toBeGreaterThanOrEqual(before + 90);
    const retryQuery = db.queries.find(({ text }) => /update outbox\s+set last_error/i.test(text));
    expect(retryQuery?.text).toMatch(/last_error\s*=\s*\$5/i);
    expect(retryQuery?.text).toMatch(/next_attempt_at\s*=.*\$6::bigint/i);
    expect(retryQuery?.values.slice(0, 5)).toEqual(["1", "evt-1", expect.any(String), "dedupe-1", "broker unavailable"]);
    expect((await outbox.processOnce()).claimed).toBe(0);
    expect(db.rows[1].claimed_by).toBeNull();
    expect(outboxRetryDelayMs(1, 100, 300)).toBe(100);
    expect(outboxRetryDelayMs(2, 100, 300)).toBe(200);
    expect(outboxRetryDelayMs(3, 100, 300)).toBe(300);
  });

  it("recovers an expired lease and a new worker delivers the pending row", async () => {
    const pending = row(1, "battery-a");
    pending.claimed_by = "dead-worker";
    pending.claim_token = "old-token";
    pending.claimed_at = new Date(Date.now() - 10_000);
    pending.lease_until = new Date(Date.now() - 1);
    pending.attempts = 1;
    const db = new FakeOutboxDb([pending]);
    expect(await recoverExpiredOutboxClaims(db)).toBe(1);
    expect(pending.claimed_by).toBeNull();
    expect(pending.claim_token).toBeNull();
    const publisher = fakePublisher();
    const result = await worker(db, publisher).processOnce();
    expect(result.acknowledged).toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(expect.anything(), "evt-1", expect.anything());
  });

  it("quarantines invalid payloads without sent_at and unblocks later commands", async () => {
    const db = new FakeOutboxDb([row(1, "battery-a", { version: 99, code: "RELAY_CUT", params: {} }), row(2, "battery-a")]);
    const publisher = fakePublisher();
    const onFailsafeCutOutboxAcknowledged = vi.fn();
    const outbox = worker(db, publisher, { onFailsafeCutOutboxAcknowledged });
    const poisonResult = await outbox.processOnce();
    expect(poisonResult).toMatchObject({ claimed: 1, poisoned: 1, published: 0 });
    expect(db.rows[0].dead_at).toBeInstanceOf(Date);
    expect(db.rows[0].sent_at).toBeNull();
    expect(db.rows[0].last_error).toMatch(/^POISON:/);
    expect(onFailsafeCutOutboxAcknowledged).not.toHaveBeenCalled();
    const poisonQuery = db.queries.find(({ text }) => /update outbox\s+set dead_at/i.test(text));
    expect(poisonQuery?.text).toMatch(/last_error\s*=\s*\$5/i);
    expect(poisonQuery?.values.slice(0, 4)).toEqual(["1", "evt-1", expect.any(String), "dedupe-1"]);
    expect((await outbox.processOnce()).acknowledged).toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("starts and stops the publisher only through the explicit worker lifecycle", async () => {
    const db = new FakeOutboxDb([]);
    const publisher = fakePublisher();
    const outbox = worker(db, publisher, { pollIntervalMs: 1 });
    await outbox.start();
    expect(outbox.isRunning).toBe(true);
    await outbox.stop();
    expect(outbox.isRunning).toBe(false);
    expect(publisher.connect).toHaveBeenCalledTimes(1);
    expect(publisher.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ dataMode: "memory", nodeEnv: "development", kafkaEnabled: true }, false],
    [{ dataMode: "postgres", nodeEnv: "test", kafkaEnabled: true }, false],
    [{ dataMode: "postgres", nodeEnv: "development", kafkaEnabled: false }, false],
    [{ dataMode: "postgres", nodeEnv: "production", kafkaEnabled: true }, true],
  ])("applies the PostgreSQL + Kafka runtime gate", (gate, expected) => {
    expect(shouldStartOutboxWorker(gate)).toBe(expected);
  });

  it("can mark a claimed poison row without pretending that Kafka acknowledged it", async () => {
    const db = new FakeOutboxDb([row(1, "battery-a")]);
    const claimed = (await claimOutboxRows(db, { workerId: "worker-a", batchSize: 1, leaseMs: 5_000 }))[0];
    expect(await markOutboxPoison(db, claimed as OutboxRow, "bad payload")).toBe(true);
    expect(db.rows[0].sent_at).toBeNull();
    expect(db.rows[0].dead_at).toBeInstanceOf(Date);
  });
});
