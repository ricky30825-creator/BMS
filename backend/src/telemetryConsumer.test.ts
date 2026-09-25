import { describe, expect, it, vi } from "vitest";
import type { KafkaDeviceCommandPublisher } from "./device/kafka.js";
import { evaluateFailsafe } from "./failsafeRunner.js";
import {
  createOutboxWorker,
  type FailsafeCutOutboxAcknowledgement,
  type OutboxDbClient,
  type OutboxDbPool,
} from "./outboxWorker.js";

import {
  RawMetricsConsumer,
  ingestRawMetricsFrame,
  type KafkaRawConsumer,
  type TelemetryDbClient,
  type TelemetryDbPool,
} from "./telemetryConsumer.js";

const mode1Frame = {
  version: 1,
  device_id: "device-1",
  mode: 1,
  timestamp: "2026-09-14T04:00:00.100Z",
  voltage_v: 3.82,
  current_a: -1.25,
  power_w: -4.775,
  soc_pct: 81,
  temp_contact: 36.8,
  temp_ir_surface: 38.1,
  temp_points: { contact: [34.1, 36.8, 35.2], ir: [38.1, 35.9] },
  gas_raw: null,
  pressure_raw: 420,
  acoustic_raw: null,
  age_ms: { soc_pct: 640, temp_contact: 310, temp_ir_surface: 40 },
  diag_phase: null,
  load_target_a: null,
};

const mode2Frame = {
  ...mode1Frame,
  mode: 2 as const,
  device_id: "device-2",
  timestamp: "2026-09-14T04:00:01.100Z",
  voltage_v: 5.02,
  current_a: -1.4,
  power_w: -7.028,
  soc_pct: 72,
  temp_contact: null,
  temp_ir_surface: 34.2,
  temp_points: { contact: null, ir: [34.2] },
  gas_raw: null,
  pressure_raw: null,
};

type FakeOptions = {
  activeSession?: Partial<{
    id: string;
    battery_id: string;
    started_at: string;
    hardware_profile: string;
    target_mode: number;
    battery_target_mode: number;
  }> | null;
  registeredDevice?: boolean;
  failOn?: "telemetry" | "latest" | "audit" | "commit";
  auditCreatedAt?: string;
  serverNow?: string;
};

function fakeDb(options: FakeOptions = {}) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const telemetryKeys = new Set<string>();
  type TelemetryRow = {
    session_id: string | null;
    battery_id: string | null;
    session_started_at: string | null;
    hardware_profile: string | null;
    measured_at: Date;
    mode: number;
    temp_contact: number | null;
    temp_ir_surface: number | null;
    gas_raw: number | null;
    pressure_raw: number | null;
  };
  const telemetryRows = new Map<string, TelemetryRow>();
  const latest = new Map<string, Date>();
  const telemetryHistory: Array<{ device_id: string; session_id: string | null; battery_id: string | null }> = [];
  const auditEvents: Array<{ resource: string; reason: string | null; created_at: string }> = [];
  const baselineRows = new Map<string, { baseline_raw: number | null; status: "VALID" | "ATTACHMENT_INVALID" | "NO_SAMPLES" }>();
  const domainEvents: Array<{ event_type: string; dedupe_key: string; params: Record<string, unknown> }> = [];
  let deviceExists = options.registeredDevice !== false;
  let deviceStatus = "OFFLINE";
  let deviceLastSeenAt: Date | null = null;
  let serverClock = new Date(options.serverNow ?? "2026-09-14T04:10:00.000Z");
  type Snapshot = {
    telemetryKeys: Set<string>;
    telemetryRows: Map<string, TelemetryRow>;
    latest: Map<string, Date>;
    telemetryHistory: Array<{ device_id: string; session_id: string | null; battery_id: string | null }>;
    auditEvents: Array<{ resource: string; reason: string | null; created_at: string }>;
    baselineRows: Map<string, { baseline_raw: number | null; status: "VALID" | "ATTACHMENT_INVALID" | "NO_SAMPLES" }>;
    domainEvents: Array<{ event_type: string; dedupe_key: string; params: Record<string, unknown> }>;
    deviceExists: boolean;
    deviceStatus: string;
    deviceLastSeenAt: Date | null;
  };
  let transactionSnapshot: Snapshot | null = null;
  const takeSnapshot = (): Snapshot => ({
    telemetryKeys: new Set(telemetryKeys),
    telemetryRows: new Map([...telemetryRows].map(([key, row]) => [key, { ...row }])),
    latest: new Map([...latest].map(([key, value]) => [key, new Date(value.getTime())])),
    telemetryHistory: telemetryHistory.map((row) => ({ ...row })),
    auditEvents: auditEvents.map((event) => ({ ...event })),
    baselineRows: new Map([...baselineRows].map(([sessionId, row]) => [sessionId, { ...row }])),
    domainEvents: domainEvents.map((event) => ({ ...event, params: { ...event.params } })),
    deviceExists,
    deviceStatus,
    deviceLastSeenAt: deviceLastSeenAt ? new Date(deviceLastSeenAt.getTime()) : null,
  });
  const restoreSnapshot = (snapshot: Snapshot): void => {
    telemetryKeys.clear();
    for (const key of snapshot.telemetryKeys) telemetryKeys.add(key);
    telemetryRows.clear();
    for (const [key, row] of snapshot.telemetryRows) telemetryRows.set(key, { ...row });
    latest.clear();
    for (const [key, value] of snapshot.latest) latest.set(key, new Date(value.getTime()));
    telemetryHistory.splice(0, telemetryHistory.length, ...snapshot.telemetryHistory.map((row) => ({ ...row })));
    auditEvents.splice(0, auditEvents.length, ...snapshot.auditEvents.map((event) => ({ ...event })));
    baselineRows.clear();
    for (const [sessionId, row] of snapshot.baselineRows) baselineRows.set(sessionId, { ...row });
    domainEvents.splice(0, domainEvents.length, ...snapshot.domainEvents.map((event) => ({ ...event, params: { ...event.params } })));
    deviceExists = snapshot.deviceExists;
    deviceStatus = snapshot.deviceStatus;
    deviceLastSeenAt = snapshot.deviceLastSeenAt ? new Date(snapshot.deviceLastSeenAt.getTime()) : null;
  };
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized === "begin") {
        transactionSnapshot = takeSnapshot();
        return { rows: [] };
      }
      if (normalized === "rollback") {
        if (transactionSnapshot) restoreSnapshot(transactionSnapshot);
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (normalized === "commit") {
        if (options.failOn === "commit") throw new Error("commit failed");
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (normalized.startsWith("select id from device")) {
        return { rows: deviceExists ? [{ id: String(values[0]) }] : [] };
      }
      if (normalized.includes("update device as d")) {
        if (!deviceExists) return { rows: [] };
        const receivedAt = new Date(serverClock.getTime());
        serverClock = new Date(serverClock.getTime() + 1);
        if (!deviceLastSeenAt || receivedAt > deviceLastSeenAt) deviceLastSeenAt = receivedAt;
        deviceStatus = "ONLINE";
        return { rows: [{ id: values[0] }] };
      }
      if (normalized.includes("select max(measured_at)") && normalized.includes("from telemetry_metric")) {
        const rows = [...telemetryRows.values()].filter((row) => row.session_id === String(values[0]));
        const latestMeasuredAt = rows.sort((left, right) => right.measured_at.getTime() - left.measured_at.getTime())[0]?.measured_at ?? null;
        return { rows: [{ latest_measured_at: latestMeasuredAt }] };
      }
      if (normalized.includes("percentile_cont(0.5)") && normalized.includes("from telemetry_metric")) {
        const sessionId = String(values[0]);
        const from = values[1] as Date;
        const to = values[2] as Date;
        const pressures = [...telemetryRows.values()]
          .filter((row) => row.session_id === sessionId && row.pressure_raw !== null
            && row.measured_at >= from && row.measured_at <= to)
          .map((row) => row.pressure_raw!)
          .sort((left, right) => left - right);
        const middle = Math.floor(pressures.length / 2);
        const median = pressures.length === 0 ? null : pressures.length % 2 === 0
          ? (pressures[middle - 1] + pressures[middle]) / 2 : pressures[middle];
        return { rows: [{ baseline_raw: median }] };
      }
      if (normalized.includes("select measured_at, temp_ir_surface") && normalized.includes("from telemetry_metric")) {
        const sessionId = String(values[0]);
        const before = (values[1] as Date).getTime();
        const previous = [...telemetryRows.values()]
          .filter((row) => row.session_id === sessionId && row.temp_ir_surface !== null && row.measured_at.getTime() < before)
          .sort((left, right) => right.measured_at.getTime() - left.measured_at.getTime())[0];
        return { rows: previous ? [{ measured_at: previous.measured_at, temp_ir_surface: previous.temp_ir_surface! }] : [] };
      }
      if (normalized.includes("from telemetry_metric")) {
        if (values.length === 1 && normalized.includes("order by t.measured_at")) {
          const prior = [...telemetryHistory].reverse().find((row) => row.device_id === String(values[0]));
          return { rows: prior ? [{ session_id: prior.session_id, battery_id: prior.battery_id }] : [] };
        }
        const key = `${String(values[0])}:${(values[1] as Date).toISOString()}`;
        const row = telemetryRows.get(key);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes("from audit_log")) {
        const event = [...auditEvents].reverse().find((candidate) => candidate.resource === String(values[0]));
        return { rows: event ? [{ reason: event.reason }] : [] };
      }
      if (normalized.includes("from measurement_session")) {
        const session = options.activeSession === null ? null : {
          id: "session-1",
          battery_id: "battery-1",
          started_at: "2026-09-14T03:59:50.000Z",
          hardware_profile: "MODE1_EXTERNAL_CELL_V1",
          target_mode: 1,
          battery_target_mode: 1,
          ...options.activeSession,
        };
        return { rows: session ? [session] : [] };
      }
      if (normalized.startsWith("insert into telemetry_metric")) {
        if (options.failOn === "telemetry") throw new Error("telemetry insert failed");
        const key = `${String(values[2])}:${(values[3] as Date).toISOString()}`;
        if (telemetryKeys.has(key)) return { rows: [] };
        telemetryKeys.add(key);
        const activeSession = options.activeSession === null ? null : {
          id: "session-1",
          battery_id: "battery-1",
          started_at: "2026-09-14T03:59:50.000Z",
          hardware_profile: "MODE1_EXTERNAL_CELL_V1",
          target_mode: 1,
          battery_target_mode: 1,
          ...options.activeSession,
        };
        telemetryRows.set(key, {
          session_id: values[0] as string | null,
          battery_id: values[1] as string | null,
          session_started_at: activeSession?.started_at ?? null,
          hardware_profile: activeSession?.hardware_profile ?? null,
          measured_at: values[3] as Date,
          mode: values[17] as number,
          temp_contact: values[7] as number | null,
          temp_ir_surface: values[8] as number | null,
          gas_raw: values[9] as number | null,
          pressure_raw: values[10] as number | null,
        });
        telemetryHistory.push({
          device_id: String(values[2]),
          session_id: values[0] as string | null,
          battery_id: values[1] as string | null,
        });
        return { rows: [{ device_id: values[2], measured_at: values[3] }] };
      }
      if (normalized.includes("from failsafe_pressure_baseline")) {
        const row = baselineRows.get(String(values[0]));
        return { rows: row ? [{ ...row }] : [] };
      }
      if (normalized.startsWith("insert into failsafe_pressure_baseline")) {
        const sessionId = String(values[0]);
        if (!baselineRows.has(sessionId)) {
          baselineRows.set(sessionId, { baseline_raw: values[1] as number | null, status: values[2] as "VALID" | "ATTACHMENT_INVALID" | "NO_SAMPLES" });
        }
        return { rows: baselineRows.has(sessionId) ? [{ session_id: sessionId }] : [] };
      }
      if (normalized.startsWith("insert into domain_event")) {
        const dedupeKey = String(values[6]);
        if (!domainEvents.some((event) => event.dedupe_key === dedupeKey)) {
          domainEvents.push({ event_type: "PRESSURE_SENSOR_ATTACHMENT_INVALID", params: JSON.parse(String(values[5])) as Record<string, unknown>, dedupe_key: dedupeKey });
        }
        return { rows: [] };
      }
      if (normalized.startsWith("insert into audit_log")) {
        if (options.failOn === "audit") throw new Error("audit insert failed");
        const createdAt = options.auditCreatedAt ?? "2026-09-14T04:10:00.500Z";
        auditEvents.push({ resource: String(values[0]), reason: values[1] as string | null, created_at: createdAt });
        return { rows: [{ id: String(auditEvents.length), created_at: createdAt }] };
      }
      if (normalized.startsWith("insert into battery_latest")) {
        if (options.failOn === "latest") throw new Error("latest update failed");
        const batteryId = String(values[0]);
        const measuredAt = values[1] as Date;
        const current = latest.get(batteryId);
        if (!current || measuredAt > current) latest.set(batteryId, measuredAt);
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client) } as unknown as TelemetryDbPool,
    client: client as unknown as TelemetryDbClient,
    queries,
    latest,
    auditEvents,
    baselineRows,
    domainEvents,
    setDeviceState(status: string, lastSeenAt: Date | null) {
      deviceStatus = status;
      deviceLastSeenAt = lastSeenAt;
    },
    get deviceExists() { return deviceExists; },
    get deviceStatus() { return deviceStatus; },
    get deviceLastSeenAt() { return deviceLastSeenAt; },
  };
}

function fakeKafka() {
  const consumer: KafkaRawConsumer = {
    connect: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
    commitOffsets: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  return consumer;
}

function message(frame: unknown, offset = "7", topic = "battery-raw-metrics") {
  return { topic, partition: 0, message: { offset, value: Buffer.from(JSON.stringify(frame)) } };
}

describe("raw telemetry ingestion", () => {
  it("validates, session-tags, preserves signed values, and stores the raw payload", async () => {
    const fake = fakeDb();
    const result = await ingestRawMetricsFrame(fake.pool, mode1Frame);

    expect(result.kind).toBe("accepted");
    expect(result.attribution).toMatchObject({ sessionId: "session-1", batteryId: "battery-1" });
    const insert = fake.queries.find((query) => query.text.toLowerCase().includes("insert into telemetry_metric"));
    expect(insert?.values.slice(4, 13)).toEqual([
      3.82, -1.25, -4.775, 36.8, 38.1, null, 420, null, 81,
    ]);
    expect(insert?.values[18]).toBe("ABSOLUTE_GAUGE");
    expect(insert?.values[19]).toEqual(mode1Frame);
    expect(insert?.values[20]).toBeNull();
    expect(fake.latest.get("battery-1")?.toISOString()).toBe(mode1Frame.timestamp);
  });

  it("stores the ambient temperature in its own column", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, temp_ambient: 24.5 });

    const insert = fake.queries.find((query) => query.text.toLowerCase().includes("insert into telemetry_metric"));
    expect(insert?.text).toContain("temp_ambient");
    expect(insert?.values[20]).toBe(24.5);

    const latest = fake.queries.find((query) => query.text.toLowerCase().includes("insert into battery_latest"));
    expect(latest?.text).toContain("temp_ambient = excluded.temp_ambient");
    expect(latest?.values[9]).toBe(24.5);
  });

  it("clears the latest ambient temperature when a newer frame has none", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, mode1Frame);

    const latest = fake.queries.find((query) => query.text.toLowerCase().includes("insert into battery_latest"));
    // Keeping a stale room temperature would pair it with a fresh surface reading.
    expect(latest?.values[9]).toBeNull();
  });

  it("keeps a frame with null attribution when no session is active", async () => {
    const fake = fakeDb({ activeSession: null, auditCreatedAt: "2026-09-14T05:00:00.500Z" });
    const result = await ingestRawMetricsFrame(fake.pool, mode1Frame);

    expect(result.kind).toBe("accepted");
    expect(result.attribution).toEqual({ sessionId: null, batteryId: null, hardwareProfile: null, sessionStartedAt: null });
    expect(result.unassignedEvent).toMatchObject({ reason: "NO_ACTIVE_SESSION", deviceId: "device-1", actualMode: 1 });
    expect(result.unassignedEvent?.occurredAt.toISOString()).toBe("2026-09-14T05:00:00.500Z");
    expect(result.unassignedEvent?.measuredAt.toISOString()).toBe(mode1Frame.timestamp);
    expect(fake.auditEvents).toEqual([{ resource: "device-1", reason: "NO_ACTIVE_SESSION", created_at: "2026-09-14T05:00:00.500Z" }]);
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("insert into battery_latest"))).toBe(false);
  });

  it("commits poison messages explicitly so a permanent payload cannot wedge the partition", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const logger = vi.fn();
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, logger });

    await consumer.handleMessage(message({ version: 999 }));
    await consumer.handleMessage(message(mode1Frame, "8", "other-topic"));
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);
    expect(kafka.commitOffsets).toHaveBeenNthCalledWith(1, [{ topic: "battery-raw-metrics", partition: 0, offset: "8" }]);
    expect(kafka.commitOffsets).toHaveBeenNthCalledWith(2, [{ topic: "other-topic", partition: 0, offset: "9" }]);
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it("keeps DB failures retryable while poison handling remains skippable", async () => {
    const fake = fakeDb({ failOn: "latest" });
    const kafka = fakeKafka();
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, logger: vi.fn() });

    await expect(consumer.handleMessage(message(mode1Frame))).rejects.toThrow("latest update failed");
    expect(kafka.commitOffsets).not.toHaveBeenCalled();
    expect(fake.queries.some((query) => query.text.toLowerCase() === "rollback")).toBe(true);
    expect(fake.deviceStatus).toBe("OFFLINE");
    expect(fake.deviceLastSeenAt).toBeNull();
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("update device as d"))).toHaveLength(1);
  });

  it("does not advance liveness when the telemetry insert fails", async () => {
    const fake = fakeDb({ failOn: "telemetry" });

    await expect(ingestRawMetricsFrame(fake.pool, mode1Frame)).rejects.toThrow("telemetry insert failed");

    expect(fake.deviceStatus).toBe("OFFLINE");
    expect(fake.deviceLastSeenAt).toBeNull();
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("update device as d"))).toHaveLength(0);
  });

  it("rolls back liveness when the durable unassigned audit write fails", async () => {
    const fake = fakeDb({ activeSession: null, failOn: "audit" });

    await expect(ingestRawMetricsFrame(fake.pool, mode1Frame)).rejects.toThrow("audit insert failed");

    expect(fake.deviceStatus).toBe("OFFLINE");
    expect(fake.deviceLastSeenAt).toBeNull();
    expect(fake.queries.some((query) => query.text.toLowerCase() === "rollback")).toBe(true);
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("update device as d"))).toHaveLength(1);
  });

  it("marks a registered device online and keeps last_seen_at monotonic", async () => {
    const fake = fakeDb({ activeSession: null });

    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const firstSeenAt = fake.deviceLastSeenAt;
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T03:59:59.900Z" });

    expect(fake.deviceStatus).toBe("ONLINE");
    expect(firstSeenAt).not.toBeNull();
    expect(fake.deviceLastSeenAt).not.toBeNull();
    expect(fake.deviceLastSeenAt!.getTime()).toBeGreaterThan(firstSeenAt!.getTime());
    expect(fake.deviceLastSeenAt?.toISOString()).toBe("2026-09-14T04:10:00.001Z");
    const livenessQueries = fake.queries.filter((query) => query.text.toLowerCase().includes("update device as d"));
    expect(livenessQueries).toHaveLength(2);
    expect(livenessQueries[0].text).toContain("clock_timestamp()");
    expect(livenessQueries[0].text).not.toContain("$2");
    expect(livenessQueries[0].values).toEqual(["device-1"]);
  });

  it("does not revive or advance a device when an old duplicate is replayed after OFFLINE", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const lastSeenAt = fake.deviceLastSeenAt;
    fake.setDeviceState("OFFLINE", lastSeenAt);

    const replay = await ingestRawMetricsFrame(fake.pool, mode1Frame);

    expect(replay.kind).toBe("duplicate");
    expect(fake.deviceStatus).toBe("OFFLINE");
    expect(fake.deviceLastSeenAt?.toISOString()).toBe(lastSeenAt?.toISOString());
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("update device as d"))).toHaveLength(1);
  });

  it("does not invent a device row for an unknown device", async () => {
    const fake = fakeDb({ activeSession: null, registeredDevice: false });
    const result = await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, device_id: "unknown-device" });

    expect(result.attribution).toEqual({ sessionId: null, batteryId: null, hardwareProfile: null, sessionStartedAt: null });
    expect(result.unassignedEvent).toMatchObject({ reason: "NO_ACTIVE_SESSION", deviceId: "unknown-device" });
    expect(fake.deviceExists).toBe(false);
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("update device as d"))).toBe(false);
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("insert into device"))).toBe(false);
  });

  it("records one durable UNASSIGNED_DATA transition instead of one audit row per frame", async () => {
    const options: FakeOptions = { activeSession: null };
    const fake = fakeDb(options);

    const first = await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const second = await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:00.200Z" });
    options.activeSession = { id: "session-1", battery_id: "battery-1", target_mode: 1, battery_target_mode: 1 };
    const assigned = await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:00.300Z" });
    options.activeSession = null;
    const transition = await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:00.400Z" });

    expect(first.unassignedEvent).not.toBeNull();
    expect(second.unassignedEvent).toBeNull();
    expect(assigned.attribution.batteryId).toBe("battery-1");
    expect(transition.unassignedEvent).not.toBeNull();
    expect(fake.auditEvents).toHaveLength(2);
  });

  it("does not wedge offsets when the post-commit unassigned broadcast fails", async () => {
    const fake = fakeDb({ activeSession: null });
    const kafka = fakeKafka();
    const logger = vi.fn();
    const onUnassignedData = vi.fn().mockRejectedValue(new Error("broadcast unavailable"));
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onUnassignedData, logger });

    await consumer.handleMessage(message(mode1Frame, "7"));
    await consumer.handleMessage(message({ ...mode1Frame, timestamp: "2026-09-14T04:00:00.200Z" }, "8"));

    expect(onUnassignedData).toHaveBeenCalledOnce();
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalledWith("unassigned-data broadcast failed after durable audit", expect.any(Object));
  });

  it("keeps a mode-mismatched active session unassigned", async () => {
    const fake = fakeDb({
      activeSession: {
        id: "session-mode-1",
        battery_id: "battery-1",
        target_mode: 1,
        battery_target_mode: 1,
        hardware_profile: "MODE1_EXTERNAL_CELL_V1",
      },
    });

    const result = await ingestRawMetricsFrame(fake.pool, mode2Frame);
    const insert = fake.queries.find((query) => query.text.toLowerCase().includes("insert into telemetry_metric"));

    expect(result.attribution).toEqual({ sessionId: null, batteryId: null, hardwareProfile: null, sessionStartedAt: null });
    expect(result.unassignedEvent).toMatchObject({ reason: "MODE_MISMATCH", actualMode: 2, sessionTargetMode: 1, batteryTargetMode: 1 });
    expect(insert?.values[0]).toBeNull();
    expect(insert?.values[1]).toBeNull();
    expect(fake.queries.some((query) => query.text.toLowerCase().includes("insert into battery_latest"))).toBe(false);
  });

  it("treats a replay as a successful no-op and does not rewrite latest", async () => {
    const fake = fakeDb();
    const first = await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const second = await ingestRawMetricsFrame(fake.pool, mode1Frame);

    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("duplicate");
    expect(fake.queries.filter((query) => query.text.toLowerCase().includes("insert into battery_latest"))).toHaveLength(1);
  });

  it("reuses the persisted attribution when a replay arrives after a session change", async () => {
    const options: FakeOptions = {
      activeSession: { id: "session-1", battery_id: "battery-1", hardware_profile: "MODE1_EXTERNAL_CELL_V1" },
    };
    const fake = fakeDb(options);
    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    options.activeSession = { id: "session-2", battery_id: "battery-2", hardware_profile: "COMBINED_EXISTING_PARTS_V1" };

    const replay = await ingestRawMetricsFrame(fake.pool, mode1Frame);

    expect(replay.kind).toBe("duplicate");
    expect(replay.attribution).toMatchObject({ sessionId: "session-1", batteryId: "battery-1", hardwareProfile: "MODE1_EXTERNAL_CELL_V1" });
  });

  it("protects battery_latest from an older accepted frame", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T03:59:59.900Z", voltage_v: 3.7 });

    expect(fake.latest.get("battery-1")?.toISOString()).toBe(mode1Frame.timestamp);
    const latestQuery = fake.queries.find((query) => query.text.toLowerCase().includes("insert into battery_latest"));
    expect(latestQuery?.text).toContain("excluded.measured_at > battery_latest.measured_at");
  });

  it("keeps mode 1 and mode 2 nullable fields and SOC basis distinct", async () => {
    const mode1 = fakeDb();
    await ingestRawMetricsFrame(mode1.pool, mode1Frame);
    const mode1Insert = mode1.queries.find((query) => query.text.toLowerCase().includes("insert into telemetry_metric"));
    expect(mode1Insert?.values[9]).toBeNull();
    expect(mode1Insert?.values[10]).toBe(420);
    expect(mode1Insert?.values[18]).toBe("ABSOLUTE_GAUGE");

    const mode2 = fakeDb({ activeSession: { id: "session-2", battery_id: "battery-2", target_mode: 2, battery_target_mode: 2, hardware_profile: "COMBINED_EXISTING_PARTS_V1" } });
    await ingestRawMetricsFrame(mode2.pool, mode2Frame);
    const mode2Insert = mode2.queries.find((query) => query.text.toLowerCase().includes("insert into telemetry_metric"));
    expect(mode2Insert?.values[7]).toBeNull();
    expect(mode2Insert?.values[10]).toBeNull();
    expect(mode2Insert?.values[18]).toBe("RELATIVE_SESSION_START");
  });

  it("serializes safety hooks by battery and shuts down Kafka cleanly", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const kafka = fakeKafka();
    let active = 0;
    let maximum = 0;
    const onDurableFrame = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onDurableFrame, logger: vi.fn() });

    await consumer.start();
    await Promise.all([
      consumer.handleMessage(message(mode1Frame, "7")),
      consumer.handleMessage(message(mode1Frame, "8")),
    ]);
    await consumer.stop();

    expect(maximum).toBe(1);
    expect(onDurableFrame).toHaveBeenCalledTimes(2);
    expect(kafka.run).toHaveBeenCalledWith(expect.objectContaining({ autoCommit: false }));
    expect(kafka.stop).toHaveBeenCalledOnce();
    expect(kafka.disconnect).toHaveBeenCalledOnce();
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);
  });

  it("does not commit a later same-battery frame past a failed safety hook", async () => {
    const fake = fakeDb();
    await ingestRawMetricsFrame(fake.pool, mode1Frame);
    const kafka = fakeKafka();
    const onDurableFrame = vi.fn()
      .mockRejectedValueOnce(new Error("safety failed"))
      .mockResolvedValue(undefined);
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onDurableFrame, logger: vi.fn() });

    const outcomes = await Promise.allSettled([
      consumer.handleMessage(message(mode1Frame, "7")),
      consumer.handleMessage(message(mode1Frame, "8")),
    ]);

    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect(kafka.commitOffsets).not.toHaveBeenCalled();
  });

  it("mode1은 세션 시작 10초 구간의 DB 중앙값으로 pressure baseline을 고정한다", async () => {
    const fake = fakeDb({ activeSession: { started_at: "2026-09-14T04:00:00.000Z" } });
    const beforeWindowEnd = await ingestRawMetricsFrame(fake.pool, {
      ...mode1Frame,
      timestamp: "2026-09-14T04:00:02.000Z",
      pressure_raw: 600,
    });
    await ingestRawMetricsFrame(fake.pool, {
      ...mode1Frame,
      timestamp: "2026-09-14T04:00:09.000Z",
      pressure_raw: 800,
    });
    const afterWindow = await ingestRawMetricsFrame(fake.pool, {
      ...mode1Frame,
      timestamp: "2026-09-14T04:00:10.100Z",
      pressure_raw: 1100,
    });

    expect(beforeWindowEnd.safetySample?.pressureBaseline).toBeNull();
    expect(afterWindow.safetySample?.pressureBaseline).toBe(700);
    expect(fake.baselineRows.get("session-1")).toEqual({ baseline_raw: 700, status: "VALID" });
    expect(fake.domainEvents).toHaveLength(0);
  });

  it("baseline 500 미만은 세션당 한 번 이벤트로 남기고 압력 차단을 끈다", async () => {
    const fake = fakeDb({ activeSession: { started_at: "2026-09-14T04:00:00.000Z" } });
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:02.000Z", pressure_raw: 300 });
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:09.000Z", pressure_raw: 400 });
    const frame = { ...mode1Frame, timestamp: "2026-09-14T04:00:10.100Z", pressure_raw: 5000 };
    const result = await ingestRawMetricsFrame(fake.pool, frame);
    await ingestRawMetricsFrame(fake.pool, frame);

    expect(result.safetySample?.pressureBaseline).toBeNull();
    expect(fake.baselineRows.get("session-1")).toEqual({ baseline_raw: 350, status: "ATTACHMENT_INVALID" });
    expect(fake.domainEvents).toEqual([expect.objectContaining({
      event_type: "PRESSURE_SENSOR_ATTACHMENT_INVALID",
      dedupe_key: "pressure-baseline-invalid:session-1",
      params: { baselineRaw: 350, minimumBaselineRaw: 500 },
    })]);
  });

  it("새 세션은 이전 세션의 baseline을 재사용하지 않는다", async () => {
    const options: FakeOptions = { activeSession: { started_at: "2026-09-14T04:00:00.000Z" } };
    const fake = fakeDb(options);
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:02.000Z", pressure_raw: 900 });
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:10.100Z", pressure_raw: 1000 });
    options.activeSession = { id: "session-2", started_at: "2026-09-14T04:00:20.000Z" };
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:22.000Z", pressure_raw: 1200 });
    const secondSession = await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:30.100Z", pressure_raw: 1400 });

    expect(secondSession.attribution.sessionId).toBe("session-2");
    expect(secondSession.safetySample?.pressureBaseline).toBe(1200);
    expect(fake.baselineRows.get("session-1")?.baseline_raw).toBe(900);
    expect(fake.baselineRows.get("session-2")?.baseline_raw).toBe(1200);
  });

  it("older accepted frame is stored but excluded from the safety hook", async () => {
    const fake = fakeDb({ activeSession: { started_at: "2026-09-14T04:00:00.000Z" } });
    const kafka = fakeKafka();
    const onDurableFrame = vi.fn(async () => undefined);
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onDurableFrame, logger: vi.fn() });

    await consumer.handleMessage(message({ ...mode1Frame, timestamp: "2026-09-14T04:00:10.100Z" }, "7"));
    await consumer.handleMessage(message({ ...mode1Frame, timestamp: "2026-09-14T04:00:09.900Z" }, "8"));

    expect(onDurableFrame).toHaveBeenCalledOnce();
    expect(fake.queries.filter((query) => query.text.trimStart().toLowerCase().startsWith("insert into telemetry_metric"))).toHaveLength(2);
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);
  });

  it("duplicate latest replay rebuilds a durable Fail-Safe sample; older duplicates do not", async () => {
    const fake = fakeDb({ activeSession: { started_at: "2026-09-14T04:00:00.000Z" } });
    const newest = { ...mode1Frame, timestamp: "2026-09-14T04:00:10.100Z" };
    const first = await ingestRawMetricsFrame(fake.pool, newest);
    const replay = await ingestRawMetricsFrame(fake.pool, newest);
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp: "2026-09-14T04:00:10.200Z" });
    const oldReplay = await ingestRawMetricsFrame(fake.pool, newest);

    expect(first.safetySample).not.toBeNull();
    expect(replay.kind).toBe("duplicate");
    expect(replay.safetySample).toEqual(first.safetySample);
    expect(oldReplay.kind).toBe("duplicate");
    expect(oldReplay.safetySample).toBeNull();
  });

  it("duplicate natural-key conflict evaluates the committed raw row, not replacement sensor values", async () => {
    const fake = fakeDb({ activeSession: { started_at: "2026-09-14T04:00:00.000Z" } });
    const timestamp = "2026-09-14T04:00:10.100Z";
    await ingestRawMetricsFrame(fake.pool, { ...mode1Frame, timestamp });
    const replay = await ingestRawMetricsFrame(fake.pool, {
      ...mode1Frame,
      timestamp,
      temp_contact: 99,
      temp_ir_surface: 88,
      temp_points: { contact: [99, 35.2, 34.1], ir: [88, 35.9] },
      pressure_raw: 99_999,
    });

    expect(replay.kind).toBe("duplicate");
    expect(replay.safetySample).toMatchObject({ tempContact: 36.8, tempIrSurface: 38.1, pressureRaw: 420 });
  });

  it("MODE2_FULL keeps only IR, slope, and gas in the durable sample", async () => {
    const fake = fakeDb({ activeSession: {
      id: "session-mode2",
      battery_id: "battery-mode2",
      started_at: "2026-09-14T04:00:00.000Z",
      hardware_profile: "MODE2_FULL",
      target_mode: 2,
      battery_target_mode: 2,
    } });
    const result = await ingestRawMetricsFrame(fake.pool, {
      ...mode2Frame,
      gas_raw: 900,
      pressure_raw: null,
      temp_contact: null,
    });

    expect(result.attribution.hardwareProfile).toBe("MODE2_FULL");
    expect(result.safetySample).toMatchObject({ tempContact: null, pressureRaw: null, gasRaw: 900 });
  });

  it("synthetic raw frame reaches Fail-Safe, one committed cut, outbox Kafka publish, and one relay.autoCut without AI", async () => {
    const fake = fakeDb();
    const kafka = fakeKafka();
    const trace: string[] = [];
    let relay = {
      batteryId: "battery-1",
      state: "CLOSED" as "CLOSED" | "OPEN",
      interlockEngaged: false,
      interlockCondition: null as string | null,
      reasonCode: null as string | null,
      reason: null as string | null,
      changedAt: "",
      changedBy: "SYSTEM",
    };
    const auditLog: Array<{ action: string; resource: string }> = [];
    const domainEvents: Array<{ eventType: string; batteryId: string; triggerCode: string }> = [];
    let durableCommand: { eventId: string; dedupeKey: string; payload: unknown } | null = null;
    const onDurableFrame = vi.fn(async ({ batteryId, hardwareProfile, safetySample }) => {
      expect(fake.queries.some(({ text }) => text.trim().toLowerCase() === "commit")).toBe(true);
      expect(safetySample.tempIrSurface).toBe(60);
      expect(hardwareProfile).toBe("MODE1_EXTERNAL_CELL_V1");
      const alreadyCut = relay.interlockEngaged;
      const verdict = await evaluateFailsafe({
        relayByBattery: async () => ({ ...relay }),
        engageFailsafe: async (id, triggerCode, condition) => {
          if (relay.interlockEngaged) return { relay: { ...relay }, newlyEngaged: false };
          relay = {
            ...relay,
            batteryId: id,
            state: "OPEN",
            interlockEngaged: true,
            interlockCondition: condition,
            reasonCode: triggerCode,
            changedAt: "2026-09-14T04:10:00.000Z",
          };
          auditLog.push({ action: "RELAY_AUTO_CUT", resource: id });
          domainEvents.push({ eventType: "RELAY_AUTO_CUT", batteryId: id, triggerCode });
          durableCommand = {
            eventId: "evt_failsafe_cut_1",
            dedupeKey: `failsafe-relay-cut:${id}:${triggerCode}:${condition}`,
            payload: { version: 1, code: "RELAY_CUT", params: { batteryId: id, reasonCode: triggerCode } },
          };
          trace.push("postgres.commit");
          return { relay: { ...relay }, newlyEngaged: true };
        },
        relayCut: async () => undefined,
        // PostgreSQL evaluation must not broadcast before the outbox delivery boundary.
        onAutoCut: () => undefined,
      }, batteryId, hardwareProfile, safetySample, {
        tempContactCapC: 0,
        tempIrCapC: 60,
        tempRiseRateCPerMin: 0,
        pressureRisePct: 0,
        gasRaw: 0,
      });
      if (alreadyCut) expect(verdict).toBeNull();
      else expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
    });
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onDurableFrame, logger: vi.fn() });

    const trippingFrame = { ...mode1Frame, temp_ir_surface: 60, temp_points: { ...mode1Frame.temp_points, ir: [60, 35.9] } };
    await consumer.handleMessage(message(trippingFrame, "7"));
    await consumer.handleMessage(message(trippingFrame, "8"));

    expect(relay).toMatchObject({ state: "OPEN", interlockEngaged: true, reasonCode: "FAILSAFE_TEMP_IR_OVER_CAP" });
    expect(auditLog).toEqual([{ action: "RELAY_AUTO_CUT", resource: "battery-1" }]);
    expect(domainEvents).toEqual([{ eventType: "RELAY_AUTO_CUT", batteryId: "battery-1", triggerCode: "FAILSAFE_TEMP_IR_OVER_CAP" }]);
    expect(trace).toEqual(["postgres.commit"]);
    expect(onDurableFrame).toHaveBeenCalledTimes(2);
    expect(kafka.commitOffsets).toHaveBeenCalledTimes(2);

    type FakeOutboxRow = {
      id: number;
      topic: string;
      partition_key: string;
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
    const command = durableCommand!;
    const outboxRow: FakeOutboxRow = {
      id: 1,
      topic: "battery-events",
      partition_key: "battery-1",
      payload: command.payload,
      event_id: command.eventId,
      dedupe_key: command.dedupeKey,
      created_at: new Date("2026-09-14T04:10:00.000Z"),
      sent_at: null,
      attempts: 0,
      last_error: null,
      next_attempt_at: new Date(Date.now() - 1),
      claimed_by: null,
      claim_token: null,
      claimed_at: null,
      lease_until: null,
      dead_at: null,
    };
    const outboxQuery = async <Row = Record<string, unknown>>(text: string, values: unknown[] = []) => {
      const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] as Row[] };
      if (normalized.startsWith("with eligible as")) {
        if (outboxRow.sent_at || outboxRow.dead_at || outboxRow.claimed_by) return { rows: [] as Row[] };
        outboxRow.attempts = 1;
        outboxRow.claimed_by = String(values[1]);
        outboxRow.claim_token = String(values[2]);
        outboxRow.claimed_at = new Date();
        outboxRow.lease_until = new Date(Date.now() + Number(values[3]));
        return { rows: [{ ...outboxRow }] as Row[] };
      }
      if (normalized.startsWith("update outbox set sent_at")) {
        outboxRow.sent_at = new Date();
        outboxRow.claimed_by = null;
        outboxRow.claim_token = null;
        outboxRow.claimed_at = null;
        outboxRow.lease_until = null;
        trace.push("outbox.sent");
        return { rows: [{ id: "1" }] as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[] };
    };
    const outboxClient: OutboxDbClient = { query: outboxQuery, release: vi.fn() };
    const outboxDb: OutboxDbPool = { query: outboxQuery, connect: async () => outboxClient };
    const publisher: KafkaDeviceCommandPublisher = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      publish: vi.fn(async (event, eventId, route) => {
        trace.push("kafka.publish");
        expect(event).toMatchObject({ code: "RELAY_CUT", params: { batteryId: "battery-1" } });
        expect(eventId).toBe(command.eventId);
        expect(route).toEqual({ topic: "battery-events", partitionKey: "battery-1" });
      }),
    };
    const onFailsafeCutOutboxAcknowledged = vi.fn(({ eventId, dedupeKey, batteryId, reasonCode }: FailsafeCutOutboxAcknowledgement) => {
      expect(eventId).toBe(command.eventId);
      expect(dedupeKey).toBe(command.dedupeKey);
      expect(batteryId).toBe("battery-1");
      expect(reasonCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
      trace.push("ws.relay.autoCut");
    });
    const outbox = createOutboxWorker({
      db: outboxDb,
      publisher,
      workerId: "test",
      batchSize: 1,
      leaseMs: 30_000,
      logger: vi.fn(),
      onFailsafeCutOutboxAcknowledged,
    });
    const delivery = await outbox.processOnce();
    const replay = await outbox.processOnce();

    expect(delivery).toMatchObject({ claimed: 1, published: 1, acknowledged: 1, retried: 0, poisoned: 0 });
    expect(replay).toMatchObject({ claimed: 0, published: 0, acknowledged: 0, retried: 0, poisoned: 0 });
    expect(outboxRow.sent_at).toBeInstanceOf(Date);
    expect(onFailsafeCutOutboxAcknowledged).toHaveBeenCalledOnce();
    expect(trace).toEqual(["postgres.commit", "kafka.publish", "outbox.sent", "ws.relay.autoCut"]);
  });
});
