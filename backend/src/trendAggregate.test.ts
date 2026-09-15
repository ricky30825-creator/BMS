import { describe, expect, it } from "vitest";

import { bucketIndex, emptyTrendResponse, trendBuckets, trendMetricUnit, trendWindow } from "./trendAggregate.js";

const NOW = Date.parse("2026-09-15T12:34:56.789Z");

describe("trend bucket contract", () => {
  it.each([
    ["24h", 25, "2026-09-14T12:00:00.000Z", "2026-09-15T13:00:00.000Z"],
    ["7d", 7, "2026-09-09T00:00:00.000Z", "2026-09-16T00:00:00.000Z"],
    ["30d", 30, "2026-08-17T00:00:00.000Z", "2026-09-16T00:00:00.000Z"],
  ] as const)("uses UTC %s boundaries", (period, count, start, endExclusive) => {
    const window = trendWindow(period, NOW);
    expect(window.count).toBe(count);
    expect(new Date(window.startMs).toISOString()).toBe(start);
    expect(new Date(window.endExclusiveMs).toISOString()).toBe(endExclusive);
    expect(trendBuckets(period, NOW)).toHaveLength(count);
    expect(trendBuckets(period, NOW).at(-1)).toBe(new Date(window.endExclusiveMs - window.stepMs).toISOString());
  });

  it("keeps the lower boundary inclusive and the upper boundary exclusive", () => {
    const window = trendWindow("24h", NOW);
    expect(bucketIndex(window.startMs, window)).toBe(0);
    expect(bucketIndex(window.endExclusiveMs - 1, window)).toBe(24);
    expect(bucketIndex(window.endExclusiveMs, window)).toBe(-1);
    expect(bucketIndex("not-a-timestamp", window)).toBe(-1);
  });

  it("creates null-filled series for an empty period", () => {
    const result = emptyTrendResponse(["pack-1"], new Map([["pack-1", "긴 배터리"]]), "7d", ["volt", "temp", "anomaly"], NOW);
    expect(result.buckets).toHaveLength(7);
    expect(result.series).toHaveLength(3);
    expect(result.series.every((series) => series.points.every((point) => point === null))).toBe(true);
    expect(result.series.map((series) => series.unit)).toEqual(["V", "°C", "score"]);
  });

  it("exposes units for all report metrics", () => {
    expect(trendMetricUnit("volt")).toBe("V");
    expect(trendMetricUnit("curr")).toBe("A");
    expect(trendMetricUnit("temp")).toBe("°C");
    expect(trendMetricUnit("soc")).toBe("%");
    expect(trendMetricUnit("anomaly")).toBe("score");
  });
});
