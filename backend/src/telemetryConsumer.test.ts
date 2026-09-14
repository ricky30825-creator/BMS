import { describe, expect, it, vi } from "vitest";

import {
  RawMetricsConsumer,
  createSafetySampleTracker,
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
  };
  const telemetryRows = new Map<string, TelemetryRow>();
  const latest = new Map<string, Date>();
  const telemetryHistory: Array<{ device_id: string; session_id: string | null; battery_id: string | null }> = [];
  const auditEvents: Array<{ resource: string; reason: string | null; created_at: string }> = [];
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
        });
        telemetryHistory.push({
          device_id: String(values[2]),
          session_id: values[0] as string | null,
          battery_id: values[1] as string | null,
        });
        return { rows: [{ device_id: values[2], measured_at: values[3] }] };
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
    expect(fake.latest.get("battery-1")?.toISOString()).toBe(mode1Frame.timestamp);
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
      consumer.handleMessage(message({ ...mode1Frame, timestamp: "2026-09-14T04:00:00.200Z" }, "8")),
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
    const kafka = fakeKafka();
    const onDurableFrame = vi.fn()
      .mockRejectedValueOnce(new Error("safety failed"))
      .mockResolvedValue(undefined);
    const consumer = new RawMetricsConsumer({ db: fake.pool, topic: "battery-raw-metrics", consumer: kafka, onDurableFrame, logger: vi.fn() });

    const outcomes = await Promise.allSettled([
      consumer.handleMessage(message(mode1Frame, "7")),
      consumer.handleMessage(message({ ...mode1Frame, timestamp: "2026-09-14T04:00:00.200Z" }, "8")),
    ]);

    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect(kafka.commitOffsets).not.toHaveBeenCalled();
  });

  it("does not rewind safety slope or pressure baseline for an older accepted frame", () => {
    const tracker = createSafetySampleTracker();
    const attribution = {
      sessionId: "session-1",
      batteryId: "battery-1",
      hardwareProfile: "MODE1_EXTERNAL_CELL_V1" as const,
      sessionStartedAt: "2026-09-14T04:00:00.000Z",
    };
    const result = (timestamp: string, temperature: number, pressure: number) => ({
      kind: "accepted" as const,
      frame: {
        ...mode1Frame,
        timestamp,
        temp_ir_surface: temperature,
        temp_points: { ...mode1Frame.temp_points, ir: [temperature, 35.9] },
        pressure_raw: pressure,
      },
      measuredAt: new Date(timestamp),
      attribution,
      latestCandidate: true,
      unassignedEvent: null,
    });

    expect(tracker.sampleFor(result("2026-09-14T04:00:00.100Z", 30, 100))).toMatchObject({
      tempRiseRateCPerMin: null,
      pressureBaseline: null,
    });
    expect(tracker.sampleFor(result("2026-09-14T04:00:00.050Z", 90, 999))).toMatchObject({
      tempRiseRateCPerMin: null,
      pressureBaseline: null,
    });
    expect(tracker.sampleFor(result("2026-09-14T04:00:10.100Z", 35, 110))).toMatchObject({
      tempRiseRateCPerMin: 30,
      pressureBaseline: 100,
    });
  });
});
