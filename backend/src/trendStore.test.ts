import { afterEach, describe, expect, it, vi } from "vitest";

import { createPostgresStore } from "./store/postgres.js";

describe("PostgreSQL trend aggregate store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps SQL bucket aggregates into the shared UTC response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:34:56.789Z"));
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        if (text.includes("from battery_asset")) return { rows: [{ id: "pack-1", label: "PACK-001" }] };
        if (text.includes("from telemetry_metric")) {
          return {
            rows: [{
              battery_id: "pack-1",
              bucket_at: new Date("2026-09-14T00:00:00.000Z"),
              volt_avg: "3.81",
              curr_avg: "-1.25",
              temp_max: "45.6",
              soc_avg: "72.5",
            }],
          };
        }
        if (text.includes("from anomaly_score")) {
          return { rows: [{ battery_id: "pack-1", bucket_at: new Date("2026-09-14T00:00:00.000Z"), anomaly_max: "0.91" }] };
        }
        throw new Error(`unexpected query: ${text}`);
      }),
    };
    const store = createPostgresStore(pool as never);

    const result = await store.trendForBatteries(["pack-1"], "7d", ["volt", "curr", "temp", "soc", "anomaly"]);
    expect(result.period).toBe("7d");
    expect(result.buckets).toHaveLength(7);
    expect(result.series).toHaveLength(5);
    expect(result.series.find((series) => series.metric === "volt")?.points[5]).toBe(3.81);
    expect(result.series.find((series) => series.metric === "curr")?.points[5]).toBe(-1.25);
    expect(result.series.find((series) => series.metric === "temp")?.points[5]).toBe(45.6);
    expect(result.series.find((series) => series.metric === "soc")?.points[5]).toBe(72.5);
    expect(result.series.find((series) => series.metric === "anomaly")?.points[5]).toBe(0.91);
    expect(queries.some((query) => query.includes("avg(voltage_v)") && query.includes("avg(current_a)") && query.includes("greatest(max(temp_contact), max(temp_ir_surface))") && query.includes("avg(soc_pct)"))).toBe(true);
    expect(queries.some((query) => query.includes("max(score) as anomaly_max"))).toBe(true);
  });

  it("rejects duplicate metric selections before querying PostgreSQL", async () => {
    const pool = { query: vi.fn() };
    const store = createPostgresStore(pool as never);
    await expect(store.trendForBatteries(["pack-1"], "24h", ["volt", "volt"])).rejects.toThrow("VALIDATION_FAILED");
    expect(pool.query).not.toHaveBeenCalled();
  });
});
