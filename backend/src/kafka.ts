import { z } from "zod";

/** Version of the JSON payloads exchanged on the CellGuard Kafka topics. */
export const KAFKA_CONTRACT_VERSION = 1 as const;

export const KAFKA_TOPICS = Object.freeze({
  rawMetrics: "battery-raw-metrics",
  anomalyAlerts: "battery-anomaly-alerts",
  events: "battery-events",
} as const);

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

const versionSchema = z.literal(KAFKA_CONTRACT_VERSION);
const nonEmptyStringSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const nullableNumberSchema = finiteNumberSchema.nullable();
const timestampSchema = z.string().datetime({ offset: true });
const scoreSchema = finiteNumberSchema.min(0).max(1);

const temperaturePointsSchema = z.object({
  contact: z.array(nullableNumberSchema).length(3),
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
  "CAPACITY",
]).nullable();

function addPeakInvariantIssue(
  ctx: z.RefinementCtx,
  path: string,
  scalar: number | null,
  points: Array<number | null>,
): void {
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

/** Inference result published by the local AI process to battery-anomaly-alerts. */
export const batteryAnomalyAlertSchema = z.object({
  version: versionSchema,
  device_id: nonEmptyStringSchema,
  battery_id: nonEmptyStringSchema.nullable(),
  session_id: nonEmptyStringSchema.nullable(),
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

export const relayCutEventSchema = z.object({
  version: versionSchema,
  code: z.literal("RELAY_CUT"),
  params: z.object({
    batteryId: batteryIdSchema,
    reasonCode: nonEmptyStringSchema.nullable(),
  }).strict(),
}).strict();

export const relayRestoreEventSchema = z.object({
  version: versionSchema,
  code: z.literal("RELAY_RESTORE"),
  params: z.object({
    batteryId: batteryIdSchema,
  }).strict(),
}).strict();

export const sessionStartedEventSchema = z.object({
  version: versionSchema,
  code: z.literal("SESSION_STARTED"),
  params: z.object({
    sessionId: nonEmptyStringSchema,
    batteryId: batteryIdSchema,
    targetMode: z.union([z.literal(1), z.literal(2)]),
  }).strict(),
}).strict();

export const sessionEndedEventSchema = z.object({
  version: versionSchema,
  code: z.literal("SESSION_ENDED"),
  params: z.object({
    sessionId: nonEmptyStringSchema,
    endReason: nonEmptyStringSchema,
  }).strict(),
}).strict();

export const batteryEventSchema = z.discriminatedUnion("code", [
  relayCutEventSchema,
  relayRestoreEventSchema,
  sessionStartedEventSchema,
  sessionEndedEventSchema,
]);

export type RelayCutEvent = z.infer<typeof relayCutEventSchema>;
export type RelayRestoreEvent = z.infer<typeof relayRestoreEventSchema>;
export type SessionStartedEvent = z.infer<typeof sessionStartedEventSchema>;
export type SessionEndedEvent = z.infer<typeof sessionEndedEventSchema>;
export type BatteryEvent = z.infer<typeof batteryEventSchema>;

export type KafkaWireMessage = BatteryRawMetrics | BatteryAnomalyAlert | BatteryEvent;

export function parseBatteryRawMetrics(input: unknown): BatteryRawMetrics {
  return batteryRawMetricsSchema.parse(input);
}

export function parseBatteryAnomalyAlert(input: unknown): BatteryAnomalyAlert {
  return batteryAnomalyAlertSchema.parse(input);
}

export function parseBatteryEvent(input: unknown): BatteryEvent {
  return batteryEventSchema.parse(input);
}

/** Parse a payload using the schema assigned to its logical topic. */
export function parseKafkaMessage(topic: KafkaTopic, input: unknown): KafkaWireMessage {
  switch (topic) {
    case KAFKA_TOPICS.rawMetrics:
      return parseBatteryRawMetrics(input);
    case KAFKA_TOPICS.anomalyAlerts:
      return parseBatteryAnomalyAlert(input);
    case KAFKA_TOPICS.events:
      return parseBatteryEvent(input);
  }
}

/**
 * Partition-key policy. Raw frames cannot use battery_id because the edge does
 * not know it; sessionEnded cannot use batteryId because DeviceCommandPort only
 * supplies sessionId and endReason for that command.
 */
export const KAFKA_PARTITION_KEY_RULES = Object.freeze({
  rawMetrics: "device_id",
  anomalyAlerts: "battery_id ?? device_id",
  events: Object.freeze({
    relayCut: "params.batteryId",
    relayRestore: "params.batteryId",
    sessionStarted: "params.batteryId",
    sessionEnded: "params.sessionId",
  }),
} as const);

export function partitionKeyFor(topic: KafkaTopic, input: unknown): string {
  switch (topic) {
    case KAFKA_TOPICS.rawMetrics:
      return parseBatteryRawMetrics(input).device_id;
    case KAFKA_TOPICS.anomalyAlerts: {
      const message = parseBatteryAnomalyAlert(input);
      return message.battery_id ?? message.device_id;
    }
    case KAFKA_TOPICS.events: {
      const message = parseBatteryEvent(input);
      return message.code === "SESSION_ENDED"
        ? message.params.sessionId
        : message.params.batteryId;
    }
  }
}
