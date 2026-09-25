import {
  KAFKA_CONTRACT_VERSION,
  KAFKA_EVENT_ID_HEADER,
  KAFKA_EVENT_METADATA_RULES,
  KAFKA_PARTITION_KEY_RULES,
  KAFKA_TOPICS,
  batteryAnomalyAlertSchema,
  batteryRawMetricsSchema,
  backendOutboundCommandEventSchema,
  parseKafkaMessage,
  parseBackendOutboundCommandEvent,
  partitionKeyFor,
  partitionKeyForBackendOutboundCommandEvent,
} from "./kafka.js";

const rawFrame = {
  version: KAFKA_CONTRACT_VERSION,
  device_id: "rpi5-01",
  mode: 1,
  timestamp: "2026-09-14T04:00:00.100Z",
  voltage_v: 3.82,
  current_a: -1.25,
  power_w: -4.78,
  soc_pct: 81,
  temp_contact: 36.8,
  temp_ir_surface: 38.1,
  temp_points: { contact: [34.1, 36.8, 35.2], ir: [38.1, 35.9] },
  gas_raw: null,
  pressure_raw: 420,
  acoustic_raw: null,
  age_ms: { soc_pct: 640, temp_contact: 310, temp_ir_surface: 40 },
};

const anomalyAlert = {
  version: KAFKA_CONTRACT_VERSION,
  device_id: "rpi5-01",
  evaluated_at: "2026-09-14T04:00:01.000Z",
  score: 0.82,
  ae_score: 0.79,
  informer_score: 0.86,
  contributions: [{ feature: "dT_dt", contribution: 0.41 }],
  model_version: "ae-1.3+informer-0.9",
  temp_kalman: 38.2,
  temp_cell_estimated: 39.1,
};

describe("Kafka wire contracts", () => {
  it("pins the three topic names and version", () => {
    expect(KAFKA_TOPICS).toEqual({
      rawMetrics: "battery-raw-metrics",
      anomalyAlerts: "battery-anomaly-alerts",
      events: "battery-events",
    });
    expect(KAFKA_CONTRACT_VERSION).toBe(1);
    expect(KAFKA_EVENT_METADATA_RULES).toEqual({
      eventIdHeader: KAFKA_EVENT_ID_HEADER,
      partitionKey: "params.batteryId",
    });
  });

  it("validates the raw sensor schema and preserves signed current/power", () => {
    const parsed = batteryRawMetricsSchema.parse(rawFrame);
    expect(parsed.current_a).toBe(-1.25);
    expect(parsed.power_w).toBe(-4.78);
  });

  it("rejects a raw frame without the version or with an edge-unknown battery_id", () => {
    expect(batteryRawMetricsSchema.safeParse({ ...rawFrame, version: 2 }).success).toBe(false);
    expect(batteryRawMetricsSchema.safeParse({ ...rawFrame, battery_id: "PACK-001" }).success).toBe(false);
  });

  it("enforces peak temperature invariants and mode sensor nullability", () => {
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      temp_ir_surface: 37,
    }).success).toBe(false);
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      gas_raw: 12,
    }).success).toBe(false);

    const mode2 = batteryRawMetricsSchema.parse({
      ...rawFrame,
      mode: 2,
      temp_contact: null,
      temp_points: { contact: null, ir: [32.4, null, 33.1] },
      temp_ir_surface: 33.1,
      gas_raw: 420,
      pressure_raw: null,
      soc_pct: 88,
    });
    expect(mode2.mode).toBe(2);
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      mode: 1,
      temp_points: { contact: null, ir: rawFrame.temp_points.ir },
    }).success).toBe(false);
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      mode: 2,
      temp_contact: null,
      temp_points: { contact: [null, null, null], ir: [32.4, null, 33.1] },
      temp_ir_surface: 33.1,
      gas_raw: 420,
      pressure_raw: null,
      soc_pct: 88,
    }).success).toBe(false);
  });

  it("accepts an optional nullable ambient temperature outside temp_points in both modes", () => {
    // Absent key stays valid so edges that predate temp_ambient keep flowing.
    expect(batteryRawMetricsSchema.parse(rawFrame).temp_ambient).toBeUndefined();
    expect(batteryRawMetricsSchema.parse({ ...rawFrame, temp_ambient: 24.5 }).temp_ambient).toBe(24.5);
    expect(batteryRawMetricsSchema.parse({ ...rawFrame, temp_ambient: null }).temp_ambient).toBeNull();
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      mode: 2,
      temp_contact: null,
      temp_points: { contact: null, ir: [33.1] },
      temp_ir_surface: 33.1,
      gas_raw: 420,
      pressure_raw: null,
      temp_ambient: 24.5,
    }).success).toBe(true);
    // Ambient is not a cell-surface point and never takes part in the peak invariant.
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      temp_ambient: 99,
    }).success).toBe(true);
    expect(batteryRawMetricsSchema.safeParse({
      ...rawFrame,
      temp_points: { ...rawFrame.temp_points, ambient: 24.5 },
    }).success).toBe(false);
    expect(batteryRawMetricsSchema.safeParse({ ...rawFrame, temp_ambient: "24.5" }).success).toBe(false);
  });

  it("requires UTC timestamps and rejects non-UTC offsets", () => {
    expect(batteryRawMetricsSchema.safeParse({ ...rawFrame, timestamp: "2026-09-14T13:00:00+09:00" }).success).toBe(false);
    expect(batteryAnomalyAlertSchema.safeParse({ ...anomalyAlert, evaluated_at: "2026-09-14T13:00:01+09:00" }).success).toBe(false);
  });

  it("validates anomaly scores against the database range and fields", () => {
    expect(batteryAnomalyAlertSchema.parse(anomalyAlert)).toEqual(anomalyAlert);
    expect(batteryAnomalyAlertSchema.safeParse({ ...anomalyAlert, score: 1.01 }).success).toBe(false);
    expect(batteryAnomalyAlertSchema.safeParse({ ...anomalyAlert, message: "display text" }).success).toBe(false);
    expect(batteryAnomalyAlertSchema.safeParse({ ...anomalyAlert, battery_id: "PACK-001" }).success).toBe(false);
    expect(batteryAnomalyAlertSchema.safeParse({ ...anomalyAlert, session_id: "ses-001" }).success).toBe(false);
  });

  it.each([
    [{ version: 1, code: "RELAY_CUT", params: { batteryId: "PACK-001", reasonCode: "FAILSAFE_GAS" } }],
    [{ version: 1, code: "RELAY_RESTORE", params: { batteryId: "PACK-001" } }],
    [{ version: 1, code: "SESSION_STARTED", params: { sessionId: "ses-001", batteryId: "PACK-001", targetMode: 2 } }],
    [{ version: 1, code: "SESSION_ENDED", params: { sessionId: "ses-001", batteryId: "PACK-001", endReason: "SUPERSEDED" } }],
  ])("validates event %j without a user-facing message", (event) => {
    expect(backendOutboundCommandEventSchema.parse(event)).toEqual(event);
    expect(backendOutboundCommandEventSchema.safeParse({ ...event, message: "not allowed" }).success).toBe(false);
  });

  it.each(["P7", "S0", "S1A", "S1B", "S1C", "S1D", "S1E", "S1F", "S2", "S3"])("accepts diag_phase %s", (diagPhase) => {
    expect(batteryRawMetricsSchema.safeParse({ ...rawFrame, diag_phase: diagPhase }).success).toBe(true);
  });

  it("requires batteryId on SESSION_ENDED for the battery partition", () => {
    expect(backendOutboundCommandEventSchema.safeParse({
      version: 1,
      code: "SESSION_ENDED",
      params: { sessionId: "ses-001", endReason: "BLOCKED" },
    }).success).toBe(false);
  });

  it("uses the documented partition-key rules", () => {
    expect(KAFKA_PARTITION_KEY_RULES.rawMetrics).toBe("device_id");
    expect(KAFKA_PARTITION_KEY_RULES.anomalyAlerts).toBe("device_id");
    expect(partitionKeyFor(KAFKA_TOPICS.rawMetrics, rawFrame)).toBe("rpi5-01");
    expect(partitionKeyFor(KAFKA_TOPICS.anomalyAlerts, anomalyAlert)).toBe("rpi5-01");
    expect(partitionKeyFor(KAFKA_TOPICS.events, { version: 1, code: "RELAY_CUT", params: { batteryId: "PACK-001", reasonCode: null } })).toBe("PACK-001");
    expect(partitionKeyFor(KAFKA_TOPICS.events, { version: 1, code: "SESSION_STARTED", params: { sessionId: "ses-001", batteryId: "PACK-001", targetMode: 1 } })).toBe("PACK-001");
    expect(partitionKeyFor(KAFKA_TOPICS.events, { version: 1, code: "SESSION_ENDED", params: { sessionId: "ses-001", batteryId: "PACK-001", endReason: "BLOCKED" } })).toBe("PACK-001");
    expect(partitionKeyForBackendOutboundCommandEvent({ version: 1, code: "SESSION_ENDED", params: { sessionId: "ses-001", batteryId: "PACK-001", endReason: "BLOCKED" } })).toBe("PACK-001");
  });

  it("selects the data schema by topic and parses backend outbound events separately", () => {
    expect(parseKafkaMessage(KAFKA_TOPICS.rawMetrics, rawFrame)).toEqual(rawFrame);
    expect(parseKafkaMessage(KAFKA_TOPICS.anomalyAlerts, anomalyAlert)).toEqual(anomalyAlert);
    expect(parseBackendOutboundCommandEvent({
      version: 1,
      code: "SESSION_ENDED",
      params: { sessionId: "ses-001", batteryId: "PACK-001", endReason: "BLOCKED" },
    })).toEqual({
      version: 1,
      code: "SESSION_ENDED",
      params: { sessionId: "ses-001", batteryId: "PACK-001", endReason: "BLOCKED" },
    });
  });
});
