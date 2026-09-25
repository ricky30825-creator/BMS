import { describe, expect, it } from "vitest";
import { ApiShapeError, dashboardMetricKey, dashboardMetricParam, gradeFromScore, normalizeBattery, normalizeDashboard, normalizeDashboardMetrics } from "../api/normalize";

describe("CellGuard contract adapters", () => {
  it("uses the four server grade bands for legacy demo scores", () => {
    expect(gradeFromScore(0.29)).toBe("NORMAL");
    expect(gradeFromScore(0.3)).toBe("CAUTION");
    expect(gradeFromScore(0.6)).toBe("WARNING");
    expect(gradeFromScore(0.8)).toBe("DANGER");
  });

  it("maps the dashboard metric card key to the server's ?metric= query value and back", () => {
    expect(dashboardMetricParam("voltageV")).toBe("volt");
    expect(dashboardMetricParam("currentA")).toBe("curr");
    expect(dashboardMetricParam("representativeTempC")).toBe("temp");
    expect(dashboardMetricParam("socPct")).toBe("soc");
    expect(dashboardMetricKey("volt")).toBe("voltageV");
    expect(dashboardMetricKey("curr")).toBe("currentA");
    expect(dashboardMetricKey("temp")).toBe("representativeTempC");
    expect(dashboardMetricKey("soc")).toBe("socPct");
    expect(dashboardMetricKey(undefined)).toBeNull();
  });

  it("keeps null metrics distinct from zero", () => {
    const battery = normalizeBattery({ id: "b1", label: "PACK-001", targetMode: 2, latest: { score: 0, grade: "NORMAL", voltageV: 0, currentA: 0, representativeTempC: null, socPct: null, measuredAt: null }, health: null, chemistry: "LI_PO", seriesCount: null, maker: null, model: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL" });
    expect(battery.latest?.voltageV).toBe(0);
    expect(battery.latest?.socPct).toBeNull();
    expect(battery.latest?.grade).toBe("NORMAL");
  });

  it("does not invent score, grade, or measurement time for a partial latest value", () => {
    const battery = normalizeBattery({ id: "b2", label: "PACK-002", targetMode: 1, latest: { voltageV: null, currentA: null, representativeTempC: null, socPct: null }, health: null, chemistry: "LI_ION", seriesCount: 3, maker: null, model: null, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL" });
    expect(battery.latest).toMatchObject({ score: null, grade: null, measuredAt: null });
  });

  it("does not derive a safety grade when the server only sends a score", () => {
    const battery = normalizeBattery({ id: "b4", label: "PACK-004", targetMode: 1, latest: { score: 0.91, voltageV: 12, currentA: 1, representativeTempC: 25, socPct: 80, measuredAt: "2026-08-11T00:00:00Z" }, health: null, chemistry: "LI_ION", seriesCount: 3, maker: null, model: null, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL" });
    expect(battery.latest).toMatchObject({ score: 0.91, grade: null });
  });

  it("accepts an explicit unmeasured dashboard snapshot without adding a current timestamp", () => {
    const snapshot = normalizeDashboard({
      session: { id: "s1", batteryId: "b3", batteryLabel: "PACK-003", status: "ACTIVE", startedAt: "2026-08-11T00:00:00Z", measurementPhase: "WAITING_FOR_MEASUREMENT" },
      battery: { id: "b3", label: "PACK-003", targetMode: 1, chemistry: "LI_ION", seriesCount: 3, maker: null, model: null, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: null, health: null },
      metrics: { voltageV: { value: null, status: null }, currentA: { value: null, status: null }, powerW: { value: null, status: null }, tempContact: { value: null, status: null }, tempIrSurface: { value: null, status: null }, representativeTempC: { value: null, source: null, status: null }, tempAmbientC: { value: null, status: null }, heatRiseC: { value: null, status: null }, socPct: { value: null, status: null }, socBasis: null, measuredAt: null },
      anomaly: { score: null, grade: null },
      relay: { batteryId: "b3", state: "CLOSED", changedAt: "2026-08-11T00:00:00Z", changedBy: { type: "SYSTEM", systemCode: "SYSTEM" }, interlock: { engaged: false, condition: null, canRestore: true } },
      notices: [], snapshotCursor: "1",
    });
    expect(snapshot.metrics.measuredAt).toBeNull();
    expect(snapshot.anomaly).toMatchObject({ score: null, grade: null });
  });

  it("requires room temperature and heat rise so a missing field is not shown as no heat", () => {
    const metrics = { voltageV: { value: null, status: null }, currentA: { value: null, status: null }, powerW: { value: null, status: null }, tempContact: { value: null, status: null }, tempIrSurface: { value: 34.2, status: "OK" }, representativeTempC: { value: 34.2, source: "IR_SURFACE", status: "OK" }, tempAmbientC: { value: 24.6, status: null }, heatRiseC: { value: 9.6, status: null }, socPct: { value: null, status: null }, socBasis: null, measuredAt: null };
    expect(normalizeDashboardMetrics(metrics)).toMatchObject({ tempAmbientC: { value: 24.6, status: null }, heatRiseC: { value: 9.6, status: null } });
    const { heatRiseC: _omitted, ...withoutHeatRise } = metrics;
    expect(() => normalizeDashboardMetrics(withoutHeatRise)).toThrow(ApiShapeError);
    const { tempAmbientC: _omittedAmbient, ...withoutAmbient } = metrics;
    expect(() => normalizeDashboardMetrics(withoutAmbient)).toThrow(ApiShapeError);
  });

  it("rejects a dashboard response with missing required fields", () => {
    expect(() => normalizeDashboard({})).toThrow(ApiShapeError);
    expect(() => normalizeDashboard({ session: { id: "s1", batteryId: "b1", batteryLabel: "PACK-001", status: "ACTIVE", startedAt: "2026-08-11T00:00:00Z", measurementPhase: "WAITING_FOR_MEASUREMENT" } })).toThrow(/battery/);
  });
});
