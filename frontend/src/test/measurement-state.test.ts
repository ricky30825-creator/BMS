import { describe, expect, it } from "vitest";
import { isMeasuringSession, measurementPhaseFor, measurementPhaseLabel } from "../measurementState";

describe("measurement state", () => {
  const startedAt = "2026-09-11T00:00:00.000Z";

  it.each([
    [null, "WAITING_FOR_MEASUREMENT"],
    ["2026-09-10T23:59:59.999Z", "WAITING_FOR_MEASUREMENT"],
    [startedAt, "WAITING_FOR_MEASUREMENT"],
    ["2026-09-11T00:00:00.001Z", "MEASURING"],
  ] as const)("requires a sensor timestamp after the session start (%s)", (measuredAt, expected) => {
    expect(measurementPhaseFor(startedAt, measuredAt)).toBe(expected);
  });

  it("maps the state to the honest user-facing labels", () => {
    expect(measurementPhaseLabel("WAITING_FOR_MEASUREMENT")).toBe("장비 연결 대기");
    expect(measurementPhaseLabel("MEASURING")).toBe("연결됨 · 측정 중");
  });

  it("treats only MEASURING sessions as connected", () => {
    expect(isMeasuringSession({ measurementPhase: "WAITING_FOR_MEASUREMENT" })).toBe(false);
    expect(isMeasuringSession({ measurementPhase: "MEASURING" })).toBe(true);
    expect(isMeasuringSession(null)).toBe(false);
  });
});
