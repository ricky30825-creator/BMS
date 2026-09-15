import { describe, expect, it } from "vitest";
import { parseAdminEventTrendPeriod } from "./adminEventTrend.js";

describe("admin event trend period query", () => {
  it("defaults an omitted period to the dashboard's 7-day view", () => {
    expect(parseAdminEventTrendPeriod(undefined)).toBe("7d");
  });

  it("accepts only the three contract periods", () => {
    expect(parseAdminEventTrendPeriod("24h")).toBe("24h");
    expect(parseAdminEventTrendPeriod("7d")).toBe("7d");
    expect(parseAdminEventTrendPeriod("30d")).toBe("30d");
  });

  it("rejects empty, unknown, repeated, and non-string values", () => {
    expect(parseAdminEventTrendPeriod("")).toBeNull();
    expect(parseAdminEventTrendPeriod("1d")).toBeNull();
    expect(parseAdminEventTrendPeriod(["7d", "30d"])).toBeNull();
    expect(parseAdminEventTrendPeriod(null)).toBeNull();
  });
});
