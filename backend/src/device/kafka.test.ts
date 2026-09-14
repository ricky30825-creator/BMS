import { describe, expect, it, vi } from "vitest";

import {
  KAFKA_EVENT_ID_HEADER,
  createKafkaDeviceCommandPort,
  publishKafkaBackendCommand,
  type KafkaDeviceProducer,
} from "./kafka.js";

function fakeProducer() {
  const producer: KafkaDeviceProducer = {
    connect: vi.fn(async () => undefined),
    send: vi.fn(async () => []),
    disconnect: vi.fn(async () => undefined),
  } as unknown as KafkaDeviceProducer;
  return producer;
}

describe("Kafka DeviceCommandPort", () => {
  it("publishes the version-1 relay payload with battery key and durable event header", async () => {
    const producer = fakeProducer();
    const port = createKafkaDeviceCommandPort({ producer });

    await port.publish({
      version: 1,
      code: "RELAY_CUT",
      params: { batteryId: "PACK-001", reasonCode: "FAILSAFE_GAS" },
    }, "evt_001");

    expect(producer.connect).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledTimes(1);
    const record = (producer.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      topic: string;
      messages: Array<{ key: string; value: string; headers?: Record<string, string | Buffer> }>;
    };
    expect(record.topic).toBe("battery-events");
    expect(record.messages[0].key).toBe("PACK-001");
    expect(JSON.parse(record.messages[0].value)).toEqual({
      version: 1,
      code: "RELAY_CUT",
      params: { batteryId: "PACK-001", reasonCode: "FAILSAFE_GAS" },
    });
    expect(record.messages[0].headers?.[KAFKA_EVENT_ID_HEADER]).toEqual(Buffer.from("evt_001"));
  });

  it("keeps the event methods on the four-command DeviceCommandPort contract", async () => {
    const producer = fakeProducer();
    const port = createKafkaDeviceCommandPort({ producer });

    await port.relayRestore("PACK-001");
    await port.sessionStarted("ses-1", "PACK-001", 2);
    await port.sessionEnded("ses-1", "PACK-001", "BLOCKED");

    const records = (producer.send as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]) as Array<{
      messages: Array<{ key: string; value: string }>;
    }>;
    expect(records.map((record) => JSON.parse(record.messages[0].value))).toEqual([
      { version: 1, code: "RELAY_RESTORE", params: { batteryId: "PACK-001" } },
      { version: 1, code: "SESSION_STARTED", params: { sessionId: "ses-1", batteryId: "PACK-001", targetMode: 2 } },
      { version: 1, code: "SESSION_ENDED", params: { sessionId: "ses-1", batteryId: "PACK-001", endReason: "BLOCKED" } },
    ]);
    expect(records.every((record) => record.messages[0].key === "PACK-001")).toBe(true);
  });

  it("rejects invalid payloads and partition keys before send", async () => {
    const producer = fakeProducer();
    await expect(publishKafkaBackendCommand(producer, {
      version: 1,
      code: "RELAY_RESTORE",
      params: { batteryId: "PACK-001" },
    }, "evt-1", { partitionKey: "PACK-002" })).rejects.toThrow("KAFKA_PARTITION_KEY_MISMATCH");
    await expect(publishKafkaBackendCommand(producer, {
      version: 1,
      code: "NOT_A_COMMAND",
      params: {},
    }, "evt-2")).rejects.toThrow();
    expect(producer.send).not.toHaveBeenCalled();
  });

  it("does not accept a real producer without explicit broker/client configuration", () => {
    expect(() => createKafkaDeviceCommandPort({ brokers: [], clientId: "", topic: "battery-events" }))
      .toThrow("KAFKA_PRODUCER_CONFIG_INVALID");
    expect(() => createKafkaDeviceCommandPort({ brokers: ["", "  "], clientId: "cellguard", topic: "battery-events" }))
      .toThrow("KAFKA_PRODUCER_CONFIG_INVALID");
  });

  it("connects and disconnects exactly once across repeated lifecycle calls", async () => {
    const producer = fakeProducer();
    const port = createKafkaDeviceCommandPort({ producer });
    await port.connect();
    await port.connect();
    await port.disconnect();
    await port.disconnect();
    expect(producer.connect).toHaveBeenCalledTimes(1);
    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
