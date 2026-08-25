import { describe, expect, it } from "vitest";
import { trendSeriesValue } from "../pages/UserPages";

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
