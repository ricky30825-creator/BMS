import { describe, expect, it } from "vitest";

import { parseTrendBatteryIds, parseTrendMetrics, parseTrendPeriod } from "./trendQuery.js";

describe("trend query validation", () => {
  it("requires a valid period for PDF and defaults JSON trends to 7d", () => {
    expect(parseTrendPeriod(undefined)).toBe("7d");
    expect(parseTrendPeriod(undefined, true)).toBeNull();
    expect(parseTrendPeriod("24h", true)).toBe("24h");
    expect(parseTrendPeriod("12h", true)).toBeNull();
    expect(parseTrendPeriod(["7d"])).toBeNull();
  });

  it("accepts at most five unique normalized battery ids", () => {
    expect(parseTrendBatteryIds(undefined)).toBeUndefined();
    expect(parseTrendBatteryIds(" pack-1 , pack-2 ")).toEqual(["pack-1", "pack-2"]);
    expect(parseTrendBatteryIds("pack-1,pack-1")).toBeNull();
    expect(parseTrendBatteryIds("pack-1,,pack-2")).toBeNull();
    expect(parseTrendBatteryIds("a,b,c,d,e,f")).toBeNull();
    expect(parseTrendBatteryIds("<script>alert(1)</script>")).toEqual(["<script>alert(1)</script>"]);
  });

  it("accepts a unique subset of known metrics and defaults to all five", () => {
    expect(parseTrendMetrics(undefined)).toEqual(["volt", "curr", "temp", "soc", "anomaly"]);
    expect(parseTrendMetrics("temp,anomaly,volt")).toEqual(["temp", "anomaly", "volt"]);
    expect(parseTrendMetrics("volt,volt")).toBeNull();
    expect(parseTrendMetrics("gas")).toBeNull();
    expect(parseTrendMetrics("anomaly", false)).toBeNull();
    expect(parseTrendMetrics(["volt"])).toBeNull();
  });
});
