import { describe, expect, it } from "vitest";
import { appendDashboardTrendPoint, rightAlignTrend } from "../dashboardTrend";
import { trendPdfQuery, trendSeriesValue } from "../pages/UserPages";
import type { DashboardMetrics } from "../types";

describe("trendSeriesValue", () => {
  it("takes the magnitude of the current series so charge and discharge plot on the same side of zero", () => {
    expect(trendSeriesValue("curr", -2.4)).toBe(2.4);
    expect(trendSeriesValue("curr", 1.2)).toBe(1.2);
  });

  it("keeps a null current sample null rather than turning it into 0", () => {
    expect(trendSeriesValue("curr", null)).toBeNull();
  });

  it("leaves voltage, temperature, and SOC signed as-is", () => {
    expect(trendSeriesValue("volt", 11.9)).toBe(11.9);
    expect(trendSeriesValue("temp", -3)).toBe(-3);
    expect(trendSeriesValue("soc", 78)).toBe(78);
  });
});

describe("trend PDF query", () => {
  it("omits batteryIds when no comparison is selected so the server uses the active session", () => {
    const query = trendPdfQuery("7d", []);

    expect(query.get("period")).toBe("7d");
    expect(query.get("metrics")).toBe("volt,curr,temp,soc,anomaly");
    expect(query.has("batteryIds")).toBe(false);
  });

  it("includes selected batteries for an explicit comparison", () => {
    const query = trendPdfQuery("30d", ["b_pack_001", "b_pack_002"]);

    expect(query.get("batteryIds")).toBe("b_pack_001,b_pack_002");
  });
});

describe("dashboard trend alignment", () => {
  it("keeps the first samples on the right side of the fixed window", () => {
    const points = rightAlignTrend(
      [
        { at: "2026-09-12T14:00:01.000Z", value: 30 },
        { at: "2026-09-12T14:00:02.000Z", value: 31 },
      ],
      "2026-09-12T14:00:00.000Z",
    );

    expect(points).toHaveLength(24);
    expect(points.slice(0, -2).every((point) => point.value === null)).toBe(true);
    expect(points.slice(-2).map((point) => point.value)).toEqual([30, 31]);
  });

  it("drops samples from before the active session when appending a live tick", () => {
    const metrics = {
      voltageV: { value: 11.9, status: "OK" },
      currentA: { value: 2.4, status: "OK" },
      tempContact: { value: 31.2, status: "OK" },
      tempIrSurface: { value: 31.4, status: "OK" },
      representativeTempC: { value: 31.2, status: "OK", source: "CONTACT" },
      tempAmbientC: { value: 24.5, status: null },
      heatRiseC: { value: 6.7, status: null },
      socPct: { value: 78, status: "OK" },
      measuredAt: "2026-09-12T14:00:02.000Z",
    } satisfies DashboardMetrics;

    const next = appendDashboardTrendPoint(
      { metric: "temp", points: [{ at: "2026-09-12T13:59:59.000Z", value: 99 }] },
      metrics,
      "temp",
      "2026-09-12T14:00:00.000Z",
    );

    expect(next?.points).toEqual([{ at: "2026-09-12T14:00:02.000Z", value: 31.2 }]);
  });
});
