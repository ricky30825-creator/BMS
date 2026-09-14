import { z } from "zod";

/** Version of the JSON payloads exchanged on the CellGuard Kafka topics. */
export const KAFKA_CONTRACT_VERSION = 1 as const;

export const KAFKA_TOPICS = Object.freeze({
  rawMetrics: "battery-raw-metrics",
  anomalyAlerts: "battery-anomaly-alerts",
  events: "battery-events",
} as const);

/**
 * Durable outbox identity is Kafka record metadata, not part of the version-1
 * JSON payload.  Edge consumers use this header for replay deduplication.
 */
export const KAFKA_EVENT_ID_HEADER = "x-cellguard-event-id" as const;
export const KAFKA_EVENT_METADATA_RULES = Object.freeze({
  eventIdHeader: KAFKA_EVENT_ID_HEADER,
  partitionKey: "params.batteryId",
} as const);

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

const versionSchema = z.literal(KAFKA_CONTRACT_VERSION);
const nonEmptyStringSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const nullableNumberSchema = finiteNumberSchema.nullable();
const timestampSchema = z.string().datetime({ offset: false }).refine((value) => value.endsWith("Z"), {
  message: "timestamp must be an ISO8601 UTC timestamp with a Z suffix",
});
const scoreSchema = finiteNumberSchema.min(0).max(1);

const temperaturePointsSchema = z.object({
  // Mode 1 has three fixed contact probes. Mode 2 has no contact probe at all;
  // its contact field is null rather than a fabricated three-slot array.
  contact: z.union([z.array(nullableNumberSchema).length(3), z.null()]),
  // The current hardware has two IR zones, but the contract deliberately keeps
  // this array extensible for a future IR array sensor.
  ir: z.array(nullableNumberSchema).min(1),
}).strict();

const ageMsSchema = z.record(z.string(), z.number().int().nonnegative());

const diagnosisPhaseSchema = z.enum([
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "CAPACITY",
  "S0",
  "S1A",
  "S1B",
  "S1C",
  "S1D",
  "S1E",
  "S1F",
  "S2",
  "S3",
]).nullable();

function addPeakInvariantIssue(
  ctx: z.RefinementCtx,
  path: string,
  scalar: number | null,
  points: Array<number | null> | null,
): void {
  if (points === null) {
    if (scalar !== null) {
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: `${path} must be null when temperature points are unavailable`,
      });
    }
    return;
  }

  const present = points.filter((point): point is number => point !== null);
  const expected = present.length === 0 ? null : Math.max(...present);
  if (scalar !== expected) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: `${path} must equal the maximum non-null temperature point`,
    });
  }
}

/** Raw edge frame published by a Raspberry Pi to battery-raw-metrics. */
export const batteryRawMetricsSchema = z.object({
  version: versionSchema,
  device_id: nonEmptyStringSchema,
  mode: z.union([z.literal(1), z.literal(2)]),
  timestamp: timestampSchema,
  voltage_v: nullableNumberSchema,
  current_a: nullableNumberSchema,
  power_w: nullableNumberSchema,
  soc_pct: finiteNumberSchema.min(0).max(100).nullable(),
  temp_contact: nullableNumberSchema,
  temp_ir_surface: nullableNumberSchema,
  temp_points: temperaturePointsSchema,
  gas_raw: nullableNumberSchema,
  pressure_raw: nullableNumberSchema,
  acoustic_raw: nullableNumberSchema,
  age_ms: ageMsSchema,
  diag_phase: diagnosisPhaseSchema.optional(),
  load_target_a: nullableNumberSchema.optional(),
}).strict().superRefine((value, ctx) => {
  addPeakInvariantIssue(ctx, "temp_contact", value.temp_contact, value.temp_points.contact);
  addPeakInvariantIssue(ctx, "temp_ir_surface", value.temp_ir_surface, value.temp_points.ir);

  if (value.mode === 1 && value.gas_raw !== null) {
    ctx.addIssue({ code: "custom", path: ["gas_raw"], message: "mode 1 does not have a gas sensor" });
  }
  if (value.mode === 2 && value.pressure_raw !== null) {
    ctx.addIssue({ code: "custom", path: ["pressure_raw"], message: "mode 2 does not have a pressure sensor" });
  }
  if (value.mode === 1 && value.temp_points.contact === null) {
    ctx.addIssue({ code: "custom", path: ["temp_points", "contact"], message: "mode 1 requires exactly three contact temperature points" });
  }
  if (value.mode === 2 && value.temp_points.contact !== null) {
    ctx.addIssue({ code: "custom", path: ["temp_points", "contact"], message: "mode 2 has no contact temperature points" });
  }
  if (value.mode === 2 && value.temp_contact !== null) {
    ctx.addIssue({ code: "custom", path: ["temp_contact"], message: "mode 2 does not have a contact temperature sensor" });
  }
  if (value.acoustic_raw !== null) {
    ctx.addIssue({ code: "custom", path: ["acoustic_raw"], message: "acoustic sensor is not part of the current hardware" });
  }
});

export type BatteryRawMetrics = z.infer<typeof batteryRawMetricsSchema>;

const contributionSchema = z.object({
  feature: nonEmptyStringSchema,
  contribution: finiteNumberSchema,
}).strict();

/**
 * Inference result published by the local AI process to battery-anomaly-alerts.
 * The AI process only knows the raw frame's device_id. The Consumer owns
 * battery/session attribution when it persists the result.
 */
export const batteryAnomalyAlertSchema = z.object({
  version: versionSchema,
  device_id: nonEmptyStringSchema,
  evaluated_at: timestampSchema,
  score: scoreSchema,
  ae_score: scoreSchema.nullable(),
  informer_score: scoreSchema.nullable(),
  contributions: z.array(contributionSchema).nullable(),
  model_version: nonEmptyStringSchema.nullable(),
  temp_kalman: nullableNumberSchema,
  temp_cell_estimated: nullableNumberSchema,
}).strict();

export type BatteryAnomalyAlert = z.infer<typeof batteryAnomalyAlertSchema>;

const batteryIdSchema = nonEmptyStringSchema;

/**
 * `battery-events` is a shared topic. These are only the currently defined
 * backend -> edge command/event payloads; edge-originated sensor and DIAG_*
 * events are intentionally not invented or parsed here.
 */
export const backendRelayCutEventSchema = z.object({
  version: versionSchema,
  code: z.literal("RELAY_CUT"),
  params: z.object({
    batteryId: batteryIdSchema,
    reasonCode: nonEmptyStringSchema.nullable(),
  }).strict(),
}).strict();

export const backendRelayRestoreEventSchema = z.object({
  version: versionSchema,
  code: z.literal("RELAY_RESTORE"),
  params: z.object({
    batteryId: batteryIdSchema,
  }).strict(),
}).strict();

export const backendSessionStartedEventSchema = z.object({
  version: versionSchema,
  code: z.literal("SESSION_STARTED"),
  params: z.object({
    sessionId: nonEmptyStringSchema,
    batteryId: batteryIdSchema,
    targetMode: z.union([z.literal(1), z.literal(2)]),
  }).strict(),
}).strict();

export const backendSessionEndedEventSchema = z.object({
  version: versionSchema,
  code: z.literal("SESSION_ENDED"),
  params: z.object({
    sessionId: nonEmptyStringSchema,
    batteryId: batteryIdSchema,
    endReason: nonEmptyStringSchema,
  }).strict(),
}).strict();

export const backendOutboundCommandEventSchema = z.discriminatedUnion("code", [
  backendRelayCutEventSchema,
  backendRelayRestoreEventSchema,
  backendSessionStartedEventSchema,
  backendSessionEndedEventSchema,
]);

export type BackendRelayCutEvent = z.infer<typeof backendRelayCutEventSchema>;
export type BackendRelayRestoreEvent = z.infer<typeof backendRelayRestoreEventSchema>;
export type BackendSessionStartedEvent = z.infer<typeof backendSessionStartedEventSchema>;
export type BackendSessionEndedEvent = z.infer<typeof backendSessionEndedEventSchema>;
export type BackendOutboundCommandEvent = z.infer<typeof backendOutboundCommandEventSchema>;

export type KafkaDataTopic = typeof KAFKA_TOPICS.rawMetrics | typeof KAFKA_TOPICS.anomalyAlerts;
export type KafkaDataMessage = BatteryRawMetrics | BatteryAnomalyAlert;

export function parseBatteryRawMetrics(input: unknown): BatteryRawMetrics {
  return batteryRawMetricsSchema.parse(input);
}

export function parseBatteryAnomalyAlert(input: unknown): BatteryAnomalyAlert {
  return batteryAnomalyAlertSchema.parse(input);
}

export function parseBackendOutboundCommandEvent(input: unknown): BackendOutboundCommandEvent {
  return backendOutboundCommandEventSchema.parse(input);
}

export function partitionKeyForBackendOutboundCommandEvent(input: unknown): string {
  return parseBackendOutboundCommandEvent(input).params.batteryId;
}

/** Parse only the raw-metrics or anomaly-alerts data topics. */
export function parseKafkaMessage(topic: KafkaDataTopic, input: unknown): KafkaDataMessage {
  switch (topic) {
    case KAFKA_TOPICS.rawMetrics:
      return parseBatteryRawMetrics(input);
    case KAFKA_TOPICS.anomalyAlerts:
      return parseBatteryAnomalyAlert(input);
  }
}

/**
 * Partition-key policy. Raw and anomaly messages use device_id because the edge
 * and AI process do not own battery/session attribution. Backend outbound event
 * messages use batteryId, including SESSION_ENDED supplied from the session row
 * when an outbox message is created.
 */
export const KAFKA_PARTITION_KEY_RULES = Object.freeze({
  rawMetrics: "device_id",
  anomalyAlerts: "device_id",
  events: Object.freeze({
    relayCut: "params.batteryId",
    relayRestore: "params.batteryId",
    sessionStarted: "params.batteryId",
    sessionEnded: "params.batteryId",
  }),
} as const);

export function partitionKeyFor(topic: KafkaTopic, input: unknown): string {
  switch (topic) {
    case KAFKA_TOPICS.rawMetrics:
      return parseBatteryRawMetrics(input).device_id;
    case KAFKA_TOPICS.anomalyAlerts: {
      const message = parseBatteryAnomalyAlert(input);
      return message.device_id;
    }
    case KAFKA_TOPICS.events: {
      return partitionKeyForBackendOutboundCommandEvent(input);
    }
  }
}
