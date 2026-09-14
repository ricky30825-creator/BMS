import { randomUUID } from "node:crypto";
import { Kafka, type Producer } from "kafkajs";

import {
  KAFKA_CONTRACT_VERSION,
  KAFKA_EVENT_ID_HEADER,
  KAFKA_TOPICS,
  parseBackendOutboundCommandEvent,
  partitionKeyForBackendOutboundCommandEvent,
  type BackendOutboundCommandEvent,
} from "../kafka.js";
import type { DeviceCommandPort } from "./port.js";

/**
 * Kafka header carrying the durable outbox identity.
 *
 * The JSON value deliberately stays the version-1 `code + params` payload.
 * Edge consumers use this header to deduplicate a replay that happens after
 * Kafka accepted a message but before the producer could persist `sent_at`.
 */
export { KAFKA_EVENT_ID_HEADER } from "../kafka.js";

export type KafkaDeviceProducer = Pick<Producer, "connect" | "send" | "disconnect">;

export type KafkaDeviceCommandPortOptions = {
  /** Injected producer is used by unit tests and by the outbox worker. */
  producer?: KafkaDeviceProducer;
  brokers?: string[];
  clientId?: string;
  topic?: string;
  logger?: (message: string, details?: Record<string, unknown>) => void;
};

export type KafkaCommandPublishOptions = {
  topic?: string;
  partitionKey?: string;
};

/** The extra lifecycle/publish surface consumed by OutboxWorker. */
export interface KafkaDeviceCommandPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(
    event: unknown,
    eventId: string,
    options?: KafkaCommandPublishOptions,
  ): Promise<void>;
}

export type KafkaDeviceCommandPort = DeviceCommandPort & KafkaDeviceCommandPublisher;

const DEFAULT_LOGGER = (message: string, details?: Record<string, unknown>): void => {
  console.error(`[device-kafka] ${message}`, details ?? "");
};

function assertProducerConfig(options: Pick<KafkaDeviceCommandPortOptions, "brokers" | "clientId" | "topic">): void {
  if (!options.brokers || options.brokers.length === 0
    || !options.brokers.some((broker) => broker.trim().length > 0)
    || !options.clientId?.trim() || !options.topic?.trim()) {
    throw new Error("KAFKA_PRODUCER_CONFIG_INVALID");
  }
}

function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} must not be empty`);
  // Durable ids are opaque values. Validate surrounding whitespace but do not
  // rewrite the identity before placing it in Kafka metadata.
  return value;
}

/**
 * Publish one already-validated backend command with its durable identity.
 * This helper is exported so tests and future integrations can verify the
 * exact Kafka record contract without invoking a domain command method.
 */
export async function publishKafkaBackendCommand(
  producer: KafkaDeviceProducer,
  eventInput: unknown,
  eventId: string,
  options: KafkaCommandPublishOptions = {},
): Promise<void> {
  const event = parseBackendOutboundCommandEvent(eventInput);
  const durableEventId = nonEmpty(eventId, "eventId");
  const partitionKey = options.partitionKey ?? partitionKeyForBackendOutboundCommandEvent(event);
  if (partitionKey !== partitionKeyForBackendOutboundCommandEvent(event)) {
    throw new Error("KAFKA_PARTITION_KEY_MISMATCH");
  }
  const topic = options.topic ?? KAFKA_TOPICS.events;
  if (!topic.trim()) throw new Error("KAFKA_PRODUCER_CONFIG_INVALID");

  await producer.send({
    topic,
    messages: [{
      key: partitionKey,
      // Keep the wire payload unchanged: no event_id, message, or backend
      // attribution fields are added to the version-1 JSON body.
      value: JSON.stringify(event),
      headers: { [KAFKA_EVENT_ID_HEADER]: Buffer.from(durableEventId, "utf8") },
    }],
  });
}

function commandEvent(
  code: BackendOutboundCommandEvent["code"],
  params: BackendOutboundCommandEvent["params"],
): BackendOutboundCommandEvent {
  return parseBackendOutboundCommandEvent({ version: KAFKA_CONTRACT_VERSION, code, params });
}

/**
 * Kafka-backed implementation of the domain command port.
 *
 * It is intentionally lazy: constructing this object never creates a broker
 * connection.  The server only constructs it in PostgreSQL + Kafka mode, and
 * the worker owns connect/disconnect.  Direct port methods remain useful for
 * non-outbox integrations and generate a fresh non-durable identity for that
 * call; durable outbox delivery always calls `publish(event, eventId, ...)`.
 */
export function createKafkaDeviceCommandPort(
  input: KafkaDeviceCommandPortOptions | KafkaDeviceProducer,
  legacyTopic?: string,
): KafkaDeviceCommandPort {
  const options: KafkaDeviceCommandPortOptions = "send" in input
    ? { producer: input, topic: legacyTopic ?? KAFKA_TOPICS.events }
    : input;
  const topic = options.topic ?? KAFKA_TOPICS.events;
  let producer = options.producer;
  if (!producer) {
    const brokers = options.brokers ?? [];
    const clientId = options.clientId ?? "";
    assertProducerConfig({ brokers, clientId, topic });
    const kafka = new Kafka({ clientId, brokers });
    producer = kafka.producer();
  } else if (!topic.trim()) {
    throw new Error("KAFKA_PRODUCER_CONFIG_INVALID");
  }
  const logger = options.logger ?? DEFAULT_LOGGER;
  let connected = false;

  const connect = async (): Promise<void> => {
    if (connected) return;
    try {
      await producer!.connect();
      connected = true;
    } catch (error) {
      connected = false;
      logger("producer connection failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!connected) return;
    try {
      await producer!.disconnect();
    } finally {
      connected = false;
    }
  };

  const publish = async (
    eventInput: unknown,
    eventId: string,
    publishOptions: KafkaCommandPublishOptions = {},
  ): Promise<void> => {
    const event = parseBackendOutboundCommandEvent(eventInput);
    await connect();
    await publishKafkaBackendCommand(producer!, event, eventId, {
      topic: publishOptions.topic ?? topic,
      partitionKey: publishOptions.partitionKey,
    });
  };

  const direct = async (event: BackendOutboundCommandEvent): Promise<void> => {
    await publish(event, `direct_${randomUUID()}`);
  };

  return {
    connect,
    disconnect,
    publish,
    async relayCut(batteryId, reasonCode) {
      await direct(commandEvent("RELAY_CUT", { batteryId, reasonCode }));
    },
    async relayRestore(batteryId) {
      await direct(commandEvent("RELAY_RESTORE", { batteryId }));
    },
    async sessionStarted(sessionId, batteryId, targetMode) {
      await direct(commandEvent("SESSION_STARTED", { sessionId, batteryId, targetMode }));
    },
    async sessionEnded(sessionId, batteryId, endReason) {
      await direct(commandEvent("SESSION_ENDED", { sessionId, batteryId, endReason }));
    },
  };
}

/**
 * Construct a real KafkaJS producer without connecting it.  Kept separate
 * from the command-port factory for callers that need to inspect lifecycle
 * wiring explicitly.
 */
export function createKafkaDeviceProducer(options: {
  brokers: string[];
  clientId: string;
}): KafkaDeviceProducer {
  assertProducerConfig({ ...options, topic: KAFKA_TOPICS.events });
  return new Kafka({ clientId: options.clientId, brokers: options.brokers }).producer();
}
