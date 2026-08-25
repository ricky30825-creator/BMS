export type WsTopic = "metrics" | "anomaly" | "relay" | "alert" | "event" | "session" | "diagnosis";

export type StoredEnvelope = {
  sequence: bigint;
  topic: WsTopic;
  batteryId: string | null;
  envelope: Record<string, unknown>;
};

export type ReplayResult = { expired: true } | { expired: false; events: StoredEnvelope[] };

export function createEventLog(capacity: number) {
  const buffer: StoredEnvelope[] = [];
  let evictedThrough: bigint | null = null;

  function record(entry: StoredEnvelope): void {
    buffer.push(entry);
    while (buffer.length > capacity) {
      const removed = buffer.shift();
      if (removed) evictedThrough = removed.sequence;
    }
  }

  function replay(afterCursor: string): ReplayResult {
    let after: bigint;
    try {
      after = BigInt(afterCursor);
    } catch {
      return { expired: true };
    }
    if (evictedThrough !== null && after < evictedThrough) return { expired: true };
    return { expired: false, events: buffer.filter((item) => item.sequence > after) };
  }

  return { record, replay };
}

export type EventLog = ReturnType<typeof createEventLog>;
