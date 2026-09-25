import { describe, expect, it } from "vitest";
import { heatRiseC, representativeTemperature } from "./temperature";

describe("representativeTemperature", () => {
  it("takes the larger valid battery temperature and names its source", () => {
    expect(representativeTemperature(36.8, 38.1)).toEqual({ valueC: 38.1, source: "IR_SURFACE" });
    expect(representativeTemperature(40, 38.1)).toEqual({ valueC: 40, source: "CONTACT" });
    expect(representativeTemperature(null, 34.2)).toEqual({ valueC: 34.2, source: "IR_SURFACE" });
    expect(representativeTemperature(null, null)).toEqual({ valueC: null, source: null });
  });
});

describe("heatRiseC", () => {
  it("is the representative temperature minus the room temperature", () => {
    expect(heatRiseC(38.1, 24.6)).toBe(13.5);
  });

  it("keeps a negative rise instead of clamping it to zero", () => {
    // A room warmer than the battery is a real signal (ambient drift), not noise.
    expect(heatRiseC(24.1, 26.35)).toBe(-2.25);
  });

  it("is null when either side is missing and never falls back to the surface temperature", () => {
    expect(heatRiseC(38.1, null)).toBeNull();
    expect(heatRiseC(null, 24.6)).toBeNull();
    expect(heatRiseC(null, null)).toBeNull();
  });

  it("rounds away binary floating-point noise to 0.01 °C", () => {
    expect(heatRiseC(38.3, 24.1)).toBe(14.2);
  });
});
