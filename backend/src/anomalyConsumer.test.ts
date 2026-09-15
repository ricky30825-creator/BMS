import { describe, expect, it, vi } from "vitest";

import {
  AnomalyAlertsConsumer,
  ingestAnomalyAlert,
  type AnomalyDbClient,
  type AnomalyDbPool,
  type KafkaAnomalyConsumer,
} from "./anomalyConsumer.js";

const anomaly = {
  version: 1,
  device_id: "device-1",
  evaluated_at: "2026-09-14T04:00:00.100Z",
  score: 0.82,
  ae_score: 0.79,
  informer_score: 0.86,
  contributions: [
    { feature: "dT_dt", contribution: 0.41 },
    { feature: "V_drop", contribution: 0.18 },
  ],
  model_version: "ae-1.3+informer-0.9",
  temp_kalman: 42.1,
  temp_cell_estimated: 43.5,
};

type FakeOptions = {
  activeSession?: Partial<{
    id: string;
    battery_id: string;
    target_mode: number;
    battery_target_mode: number;
  }> | null;
  registeredDevice?: boolean;
  failOn?: "anomaly" | "latest" | "domainEvent" | "commit";
};

type StoredAnomaly = {
  device_id: string;
  battery_id: string | null;
  session_id: string | null;
  evaluated_at: Date;
  score: number;
  ae_score: number | null;
  informer_score: number | null;
  contributions: unknown;
  model_version: string | null;
  temp_kalman: number | null;
  temp_cell_estimated: number | null;
};

type StoredLatest = { score: number | null; evaluated_at: Date | null };
type StoredDomainEvent = {
  id: string;
  severity: string;
  device_id: string;
  battery_id: string | null;
  session_id: string | null;
  occurred_at: Date;
  score: number;
  params: unknown;
  dedupe_key: string;
};

function fakeDb(options: FakeOptions = {}) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const anomalies = new Map<string, StoredAnomaly>();
  const latest = new Map<string, StoredLatest>();
  const domainEvents = new Map<string, StoredDomainEvent>();
  let transactionSnapshot: { anomalies: Map<string, StoredAnomaly>; latest: Map<string, StoredLatest>; domainEvents: Map<string, StoredDomainEvent> } | null = null;
  const session = () => options.activeSession === null ? null : {
    id: "session-1",
    battery_id: "battery-1",
    target_mode: 1,
    battery_target_mode: 1,
    ...options.activeSession,
  };
  const copyAnomalyMap = () => new Map([...anomalies].map(([key, row]) => [key, { ...row, evaluated_at: new Date(row.evaluated_at) }]));
  const copyLatestMap = () => new Map([...latest].map(([key, row]) => [key, { ...row, evaluated_at: row.evaluated_at ? new Date(row.evaluated_at) : null }]));
  const copyDomainEventMap = () => new Map([...domainEvents].map(([key, row]) => [key, { ...row, occurred_at: new Date(row.occurred_at) }]));
  const client: AnomalyDbClient = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized === "begin") {
        transactionSnapshot = { anomalies: copyAnomalyMap(), latest: copyLatestMap(), domainEvents: copyDomainEventMap() };
        return { rows: [] };
      }
      if (normalized === "rollback") {
        if (transactionSnapshot) {
          anomalies.clear();
          for (const [key, row] of transactionSnapshot.anomalies) anomalies.set(key, { ...row, evaluated_at: new Date(row.evaluated_at) });
          latest.clear();
          for (const [key, row] of transactionSnapshot.latest) latest.set(key, { ...row, evaluated_at: row.evaluated_at ? new Date(row.evaluated_at) : null });
          domainEvents.clear();
          for (const [key, row] of transactionSnapshot.domainEvents) domainEvents.set(key, { ...row, occurred_at: new Date(row.occurred_at) });
        }
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (normalized === "commit") {
        if (options.failOn === "commit") throw new Error("commit failed");
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (normalized.startsWith("select id from device")) {
        return { rows: options.registeredDevice === false ? [] : [{ id: String(values[0]) }] };
      }
      if (normalized.includes("from measurement_session")) {
        const active = session();
        return { rows: active ? [active] : [] };
      }
      if (normalized.startsWith("insert into anomaly_score")) {
        if (options.failOn === "anomaly") throw new Error("anomaly insert failed");
        const evaluatedAt = values[3] as Date;
        const key = `${String(values[0])}:${evaluatedAt.toISOString()}`;
        if (anomalies.has(key)) return { rows: [] };
        const row: StoredAnomaly = {
          device_id: String(values[0]),
          battery_id: values[1] as string | null,
          session_id: values[2] as string | null,
          evaluated_at: evaluatedAt,
          score: values[4] as number,
          ae_score: values[5] as number | null,
          informer_score: values[6] as number | null,
          contributions: values[7],
          model_version: values[8] as string | null,
          temp_kalman: values[9] as number | null,
          temp_cell_estimated: values[10] as number | null,
        };
        anomalies.set(key, row);
        return { rows: [{ ...row }] };
      }
      if (normalized.includes("from anomaly_score")) {
        const evaluatedAt = values[1] as Date;
        const key = `${String(values[0])}:${evaluatedAt.toISOString()}`;
        const row = anomalies.get(key);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (normalized.startsWith("insert into domain_event")) {
        if (options.failOn === "domainEvent") throw new Error("domain event insert failed");
        const key = String(values[8]);
        if (domainEvents.has(key)) return { rows: [] };
        const row: StoredDomainEvent = {
          id: String(values[0]),
          severity: String(values[1]),
          device_id: String(values[2]),
          battery_id: values[3] as string | null,
          session_id: values[4] as string | null,
          occurred_at: values[5] as Date,
          score: values[6] as number,
          params: values[7],
          dedupe_key: key,
        };
        domainEvents.set(key, row);
        return { rows: [] };
      }
      if (normalized.includes("from domain_event")) return { rows: [] };
      if (normalized.includes("from battery_latest")) {
        const row = latest.get(String(values[0]));
        return { rows: row ? [{ ...row }] : [] };
      }
      if (normalized.startsWith("insert into battery_latest")) {
        if (options.failOn === "latest") throw new Error("latest update failed");
        const batteryId = String(values[0]);
        const evaluatedAt = values[2] as Date;
        const current = latest.get(batteryId);
        if (!current || current.evaluated_at === null || evaluatedAt > current.evaluated_at) {
          latest.set(batteryId, { score: values[1] as number, evaluated_at: evaluatedAt });
          return { rows: [{ battery_id: batteryId, score: values[1] as number, evaluated_at: evaluatedAt }] };
        }
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client) } as unknown as AnomalyDbPool,
    client,
    queries,
    anomalies,
    latest,
    domainEvents,
  };
}

function fakeKafka(): KafkaAnomalyConsumer {
  return {
    connect: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
    commitOffsets: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
}

function message(value: unknown, offset = "7", topic = "battery-anomaly-alerts") {
  return { topic, partition: 0, message: { offset, value: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) } };
}

describe("anomaly score ingestion", () => {
  it("validates, session-tags, and preserves every AI field", async () => {
    const fake = fakeDb();
    const result = await ingestAnomalyAlert(fake.pool, anomaly);

    expect(result.kind).toBe("accepted");
    expect(result.attribution).toEqual({ sessionId: "session-1", batteryId: "battery-1" });
    expect(result.anomaly).toMatchObject({
      deviceId: "device-1",
      batteryId: "battery-1",
      sessionId: "session-1",
      score: 0.82,
      aeScore: 0.79,
      informerScore: 0.86,
      modelVersion: "ae-1.3+informer-0.9",
      tempKalman: 42.1,
      tempCellEstimated: 43.5,
    });
    expect(result.anomaly.contributions).toEqual(anomaly.contributions);
    const insert = fake.queries.find((query) => query.text.toLowerCase().includes("insert into anomaly_score"));
    expect(insert?.values.slice(0, 5)).toEqual(["device-1", "battery-1", "session-1", new Date(anomaly.evaluated_at), 0.82]);
    expect(insert?.values[7]).toBe(JSON.stringify(anomaly.contributions));
    expect(fake.latest.get("battery-1")).toMatchObject({ score: 0.82 });
  });

  it("stores null attribution without an active session", async () => {
    const fake = fakeDb({ activeSession: null });
    const result = await ingestAnomalyAlert(fake.pool, anomaly);

    expect(result.attribution).toEqual({ sessionId: null, batteryId: null });
    expect(result.anomaly.batteryId).toBeNull();
    expect(result.anomaly.sessionId).toBeNull();
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("insert into battery_latest"))).toBe(false);
  });

  it("does not attribute an unknown device", async () => {
    const fake = fakeDb({ registeredDevice: false });
    const result = await ingestAnomalyAlert(fake.pool, anomaly);
    expect(result.attribution).toEqual({ sessionId: null, batteryId: null });
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("from measurement_session"))).toBe(false);
  });

  it("does not attribute when the active session and asset modes disagree", async () => {
    const fake = fakeDb({ activeSession: { target_mode: 1, battery_target_mode: 2 } });
    const result = await ingestAnomalyAlert(fake.pool, anomaly);
    expect(result.attribution).toEqual({ sessionId: null, batteryId: null });
    expect(result.latestCandidate).toBe(false);
  });

  it("reuses persisted attribution when a replay arrives after a session change", async () => {
    const options: FakeOptions = { activeSession: { id: "session-1", battery_id: "battery-1" } };
    const fake = fakeDb(options);
    await ingestAnomalyAlert(fake.pool, anomaly);
    options.activeSession = { id: "session-2", battery_id: "battery-2" };

    const replay = await ingestAnomalyAlert(fake.pool, anomaly);
    expect(replay.kind).toBe("duplicate");
    expect(replay.attribution).toEqual({ sessionId: "session-1", batteryId: "battery-1" });
    expect(replay.shouldEmitEvents).toBe(false);
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("insert into battery_latest"))).toHaveLength(1);
  });

  it("keeps battery_latest monotonic for an older accepted result", async () => {
    const fake = fakeDb();
    await ingestAnomalyAlert(fake.pool, anomaly);
    const older = await ingestAnomalyAlert(fake.pool, { ...anomaly, evaluated_at: "2026-09-14T03:59:59.900Z", score: 0.99 });

    expect(older.kind).toBe("accepted");
    expect(older.latestUpdated).toBe(false);
    expect(older.shouldEmitEvents).toBe(false);
    expect(fake.latest.get("battery-1")?.score).toBe(0.82);
    const latestQuery = fake.queries.find((query) => query.text.toLowerCase().includes("insert into battery_latest"));
    expect(latestQuery?.text).toContain("excluded.evaluated_at > battery_latest.evaluated_at");
  });

  it("stores one grade-transition domain event in the score transaction", async () => {
    const fake = fakeDb();
    await ingestAnomalyAlert(fake.pool, anomaly);
    const transitioned = await ingestAnomalyAlert(fake.pool, {
      ...anomaly,
      evaluated_at: "2026-09-14T04:00:01.100Z",
      score: 0.55,
    });

    expect(transitioned.previousGrade).toBe("DANGER");
    expect(transitioned.grade).toBe("CAUTION");
    expect(fake.domainEvents.size).toBe(1);
    const event = [...fake.domainEvents.values()][0];
    expect(event).toMatchObject({
      severity: "CAUTION",
      device_id: "device-1",
      battery_id: "battery-1",
      session_id: "session-1",
      score: 0.55,
    });

    const replay = await ingestAnomalyAlert(fake.pool, { ...anomaly, evaluated_at: "2026-09-14T04:00:01.100Z", score: 0.55 });
    expect(replay.kind).toBe("duplicate");
    expect(fake.domainEvents.size).toBe(1);
  });

  it("rolls back the score and latest cache when domain-event persistence fails", async () => {
    const fake = fakeDb({ failOn: "domainEvent" });
    const seededLatest = { score: 0.82, evaluated_at: new Date("2026-09-14T04:00:00.100Z") };
    fake.latest.set("battery-1", seededLatest);
    await expect(ingestAnomalyAlert(fake.pool, { ...anomaly, score: 0.55, evaluated_at: "2026-09-14T04:00:01.100Z" })).rejects.toThrow("domain event insert failed");
    expect(fake.anomalies.size).toBe(0);
    expect(fake.latest.get("battery-1")).toEqual(seededLatest);
    expect(fake.domainEvents.size).toBe(0);
    expect(fake.queries.map((query) => query.text.toLowerCase())).toContain("rollback");
  });
});

describe("anomaly Kafka consumer", () => {
  it("commits poison JSON, contract, and wrong-topic messages", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const logger = vi.fn();
    const consumer = new AnomalyAlertsConsumer({ db: fake.pool, topic: "battery-anomaly-alerts", consumer: kafka, logger });

    await consumer.handleMessage(message("not-json", "7"));
    await consumer.handleMessage(message({ version: 999 }, "8"));
    await consumer.handleMessage(message(anomaly, "9", "other-topic"));

    expect(kafka.commitOffsets).toHaveBeenCalledTimes(3);
    expect(kafka.commitOffsets).toHaveBeenNthCalledWith(1, [{ topic: "battery-anomaly-alerts", partition: 0, offset: "8" }]);
    expect(kafka.commitOffsets).toHaveBeenNthCalledWith(3, [{ topic: "other-topic", partition: 0, offset: "10" }]);
    expect(logger).toHaveBeenCalledTimes(3);
  });

  it("keeps DB failures retryable and does not commit their offsets", async () => {
    const fake = fakeDb({ failOn: "latest" });
    const kafka = fakeKafka();
    const consumer = new AnomalyAlertsConsumer({ db: fake.pool, topic: "battery-anomaly-alerts", consumer: kafka, logger: vi.fn() });

    await expect(consumer.handleMessage(message(anomaly))).rejects.toThrow("latest update failed");
    expect(kafka.commitOffsets).not.toHaveBeenCalled();
    expect(fake.queries.some((query) => query.text.toLowerCase() === "rollback")).toBe(true);
    expect(fake.anomalies.size).toBe(0);
  });

  it("does not repeat score/grade/alert callbacks for a replay", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const callback = vi.fn(async () => undefined);
    const consumer = new AnomalyAlertsConsumer({ db: fake.pool, topic: "battery-anomaly-alerts", consumer: kafka, onDurableAnomaly: callback, logger: vi.fn() });

    await consumer.handleMessage(message(anomaly, "7"));
    await consumer.handleMessage(message(anomaly, "8"));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toMatchObject({ kind: "accepted", shouldEmitEvents: true, grade: "DANGER" });
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);
  });

  it("leaves the offset retryable when the post-commit notification fails", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const callback = vi.fn().mockRejectedValueOnce(new Error("broadcast unavailable"));
    const consumer = new AnomalyAlertsConsumer({ db: fake.pool, topic: "battery-anomaly-alerts", consumer: kafka, onDurableAnomaly: callback, logger: vi.fn() });

    await expect(consumer.handleMessage(message(anomaly))).rejects.toThrow("broadcast unavailable");
    expect(kafka.commitOffsets).not.toHaveBeenCalled();
    // The replay retries only the callback that failed after the durable
    // insert. It still does not create a second DB/event candidate.
    await consumer.handleMessage(message(anomaly, "8"));
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[1][0]).toMatchObject({ kind: "accepted", shouldEmitEvents: true });
    expect(kafka.commitOffsets).toHaveBeenCalledOnce();
  });

  it("starts with manual commit and disconnects cleanly", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const consumer = new AnomalyAlertsConsumer({ db: fake.pool, topic: "battery-anomaly-alerts", consumer: kafka, logger: vi.fn() });

    await consumer.start();
    await consumer.stop();
    expect(kafka.connect).toHaveBeenCalledOnce();
    expect(kafka.subscribe).toHaveBeenCalledWith({ topic: "battery-anomaly-alerts", fromBeginning: false });
    expect(kafka.run).toHaveBeenCalledWith(expect.objectContaining({ autoCommit: false }));
    expect(kafka.stop).toHaveBeenCalledOnce();
    expect(kafka.disconnect).toHaveBeenCalledOnce();
  });
});
