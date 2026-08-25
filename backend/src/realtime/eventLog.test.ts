import { describe, expect, it } from "vitest";
import { createEventLog, type StoredEnvelope } from "./eventLog.js";

function entry(sequence: bigint): StoredEnvelope {
  return { sequence, topic: "metrics", batteryId: "PACK-001", envelope: { sequence: String(sequence) } };
}

describe("eventLog", () => {
  it("replays everything after cursor 0 when nothing has been evicted", () => {
    const log = createEventLog(10);
    log.record(entry(1n));
    log.record(entry(2n));
    log.record(entry(3n));
    const result = log.replay("0");
    expect(result.expired).toBe(false);
    if (!result.expired) expect(result.events.map((e) => e.sequence)).toEqual([1n, 2n, 3n]);
  });

  it("replays only events strictly after the given cursor", () => {
    const log = createEventLog(10);
    log.record(entry(1n));
    log.record(entry(2n));
    log.record(entry(3n));
    const result = log.replay("2");
    expect(result.expired).toBe(false);
    if (!result.expired) expect(result.events.map((e) => e.sequence)).toEqual([3n]);
  });

  it("evicts the oldest entry once capacity is exceeded", () => {
    const log = createEventLog(3);
    log.record(entry(1n));
    log.record(entry(2n));
    log.record(entry(3n));
    log.record(entry(4n));
    const result = log.replay("1");
    expect(result.expired).toBe(false);
    if (!result.expired) expect(result.events.map((e) => e.sequence)).toEqual([2n, 3n, 4n]);
  });

  it("reports expired when the cursor predates an eviction", () => {
    const log = createEventLog(2);
    log.record(entry(1n));
    log.record(entry(2n));
    log.record(entry(3n));
    expect(log.replay("0").expired).toBe(true);
  });

  it("does not report expired when the cursor is exactly at the last-evicted sequence", () => {
    const log = createEventLog(2);
    log.record(entry(1n));
    log.record(entry(2n));
    log.record(entry(3n));
    const result = log.replay("1");
    expect(result.expired).toBe(false);
    if (!result.expired) expect(result.events.map((e) => e.sequence)).toEqual([2n, 3n]);
  });

  it("reports expired for a malformed cursor instead of throwing", () => {
    const log = createEventLog(10);
    log.record(entry(1n));
    expect(log.replay("not-a-number").expired).toBe(true);
  });
});
