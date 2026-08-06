import { describe, expect, it } from "vitest";
import { gradeFromScore, normalizeBattery } from "../api/normalize";

describe("CellGuard contract adapters", () => {
  it("uses the four server grade bands for legacy demo scores", () => {
    expect(gradeFromScore(0.29)).toBe("NORMAL");
    expect(gradeFromScore(0.3)).toBe("CAUTION");
    expect(gradeFromScore(0.6)).toBe("WARNING");
    expect(gradeFromScore(0.8)).toBe("DANGER");
  });

  it("keeps null metrics distinct from zero", () => {
    const battery = normalizeBattery({ id: "b1", label: "PACK-001", targetMode: 2, latest: { score: 0, voltageV: 0, currentA: 0, representativeTempC: null, socPct: null, measuredAt: null }, health: null, chemistry: "LI_PO", seriesCount: null, maker: null, model: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL" });
    expect(battery.latest?.voltageV).toBe(0);
    expect(battery.latest?.socPct).toBeNull();
    expect(battery.latest?.grade).toBe("NORMAL");
  });
});
