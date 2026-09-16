import { describe, expect, it } from "vitest";

import { envSchema } from "./env.js";

const required = {
  DATABASE_URL: "postgres://cellguard:cellguard@localhost:5432/cellguard",
  BETTER_AUTH_URL: "http://localhost:3005",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-for-validation",
};

describe("Fail-Safe environment thresholds", () => {
  it("defaults every physical threshold to its disabled zero sentinel", () => {
    const parsed = envSchema.parse(required);
    expect([
      parsed.FAILSAFE_TEMP_CONTACT_CAP_C,
      parsed.FAILSAFE_TEMP_IR_CAP_C,
      parsed.FAILSAFE_TEMP_RISE_RATE_C_PER_MIN,
      parsed.FAILSAFE_PRESSURE_RISE_PCT,
      parsed.FAILSAFE_GAS_RAW,
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  it("parses each approved deployment threshold independently", () => {
    const parsed = envSchema.parse({
      ...required,
      FAILSAFE_TEMP_CONTACT_CAP_C: "61.5",
      FAILSAFE_TEMP_IR_CAP_C: "62.5",
      FAILSAFE_TEMP_RISE_RATE_C_PER_MIN: "4.2",
      FAILSAFE_PRESSURE_RISE_PCT: "35",
      FAILSAFE_GAS_RAW: "900",
    });
    expect([
      parsed.FAILSAFE_TEMP_CONTACT_CAP_C,
      parsed.FAILSAFE_TEMP_IR_CAP_C,
      parsed.FAILSAFE_TEMP_RISE_RATE_C_PER_MIN,
      parsed.FAILSAFE_PRESSURE_RISE_PCT,
      parsed.FAILSAFE_GAS_RAW,
    ]).toEqual([61.5, 62.5, 4.2, 35, 900]);
  });

  it("rejects negative physical thresholds", () => {
    expect(envSchema.safeParse({ ...required, FAILSAFE_GAS_RAW: "-1" }).success).toBe(false);
  });
});
