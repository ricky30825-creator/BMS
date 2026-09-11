import { describe, expect, it } from "vitest";
import { measurementPhaseFor } from "./measurementState.js";

describe("measurement phase", () => {
  const startedAt = "2026-09-11T00:00:00.000Z";

  it.each([
    [null, "WAITING_FOR_MEASUREMENT"],
    ["2026-09-10T23:59:59.999Z", "WAITING_FOR_MEASUREMENT"],
    [startedAt, "WAITING_FOR_MEASUREMENT"],
    ["2026-09-11T00:00:00.001Z", "MEASURING"],
  ] as const)("uses a post-session sensor timestamp as evidence (%s)", (measuredAt, expected) => {
    expect(measurementPhaseFor(startedAt, measuredAt)).toBe(expected);
  });

  it("fails closed for invalid timestamps", () => {
    expect(measurementPhaseFor("not-a-time", "2026-09-11T00:00:00.001Z")).toBe("WAITING_FOR_MEASUREMENT");
    expect(measurementPhaseFor(startedAt, "not-a-time")).toBe("WAITING_FOR_MEASUREMENT");
  });
});
