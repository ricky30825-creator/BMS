import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { createPostgresStore } from "./postgres.js";
import type { DiagnosisProgress } from "./types.js";

const battery = {
  id: "b1",
  owner_user_id: "hong",
  label: "Battery 1",
  chemistry: "LI_PO",
  target_mode: 2,
  series_count: null,
  maker: "Maker",
  model: "Model",
  capacity_wh: "37",
  rated_output_current_a: "2",
  ops_status: "NORMAL",
  memo: "memo",
  admin_memo: "admin memo",
  version: 0,
  updated_at: "2026-08-06T01:30:00.000Z",
  latest_measured_at: "2026-08-06T01:30:00.000Z",
  latest_voltage_v: "5.1",
  latest_current_a: "-1.2",
  latest_power_w: "-6.12",
  latest_temp_contact: null,
  latest_temp_ir_surface: "34",
  latest_soc_pct: "64",
  latest_score: "0.33",
  design_capacity_mah: null,
  full_charge_capacity_mah: null,
  cycle_count: null,
  rul_cycles: null,
  internal_resistance_mohm: null,
  health_calculated_at: null,
};

const diagnosis = {
  id: "dg1",
  battery_id: "b1",
  session_id: "ses1",
  kind: "QUICK",
  status: "RUNNING",
  phase: "P0",
  input: { acknowledged: true },
  result: null,
  started_at: "2026-08-06T01:30:00.000Z",
  estimated_end_at: "2026-08-06T01:33:00.000Z",
  completed_at: null,
  progress_snapshot: { loadTargetA: null, windows: [], deliveredWh: 0, tempTrail: [] },
};

type FakeOptions = {
  failAudit?: boolean;
  failSessionUnique?: boolean;
  failDiagnosisUnique?: boolean;
  emptyTelemetry?: boolean;
  missingBattery?: boolean;
  noLatest?: boolean;
};

function fakePool(options: FakeOptions = {}) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  let batteryRow = { ...battery, ...(options.noLatest ? {
    latest_measured_at: null,
    latest_voltage_v: null,
    latest_current_a: null,
    latest_power_w: null,
    latest_temp_contact: null,
    latest_temp_ir_surface: null,
    latest_soc_pct: null,
    latest_score: null,
  } : {}) };
  let diagnosisRow = { ...diagnosis };
  const run = vi.fn(async (text: string, values: unknown[] = []) => {
    queries.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] };
    if (options.failAudit && normalized.includes("insert into audit_log")) throw new Error("audit insert failed");
    if (options.failSessionUnique && normalized.includes("insert into measurement_session")) {
      throw Object.assign(new Error("duplicate active session"), { code: "23505", constraint: "uq_active_session_global" });
    }
    if (options.failDiagnosisUnique && normalized.startsWith("insert into diagnosis")) {
      throw Object.assign(new Error("duplicate active diagnosis"), { code: "23505", constraint: "uq_active_diagnosis_battery" });
    }
    if (normalized.includes("from battery_asset")) return { rows: options.missingBattery ? [] : [batteryRow] };
    if (normalized.startsWith("update battery_asset")) {
      if (normalized.includes("ops_status")) batteryRow = { ...batteryRow, ops_status: values[1], version: 1 };
      return { rows: [] };
    }
    if (normalized.startsWith("insert into measurement_session")) {
      return {
        rows: [{ id: "ses2", battery_id: "b1", owner_user_id: "hong", device_id: "demo-device-01", target_mode: 2, status: "ACTIVE", end_reason: null, started_at: "2026-08-06T01:30:00.000Z", ended_at: null }],
      };
    }
    if (normalized.includes("from measurement_session") && values.length === 2) {
      return {
        rows: [{ id: "ses1", battery_id: "b1", owner_user_id: "hong", device_id: "demo-device-01", target_mode: 2, status: "ACTIVE", end_reason: null, started_at: "2026-08-06T01:30:00.000Z", ended_at: null }],
      };
    }
    if (normalized.includes("from diagnosis")) return { rows: options.failDiagnosisUnique ? [] : [diagnosisRow] };
    if (normalized.startsWith("update diagnosis")) {
      diagnosisRow = { ...diagnosisRow, phase: values[1], progress_snapshot: values[2] };
      return { rows: [diagnosisRow] };
    }
    if (normalized.includes("from telemetry_metric")) {
      if (options.emptyTelemetry) return { rows: [] };
      return {
        rows: [{
          measured_at: "2026-08-06T01:31:00.000Z", device_id: "demo-device-01", battery_id: "b1", session_id: "ses1", mode: 2,
          voltage_v: "5.1", current_a: "-1.2", power_w: "-6.12", temp_contact: null, temp_ir_surface: "34",
          soc_pct: "64", soc_basis: "RELATIVE_SESSION_START", gas_raw: null, pressure_raw: null, acoustic_raw: null,
          age_ms: { voltage_v: 0 },
        }],
      };
    }
    if (normalized.includes("from relay_state")) return { rows: [] };
    if (normalized.includes("from device")) return { rows: [{ id: "demo-device-01", status: "ONLINE" }] };
    if (normalized.includes("insert into audit_log")) {
      return {
        rows: [{ id: 1, actor_user_id: values[0], action: values[1], resource: values[2], result: values[3], reason: values[4], created_at: "2026-08-06T01:30:00.000Z" }],
      };
    }
    return { rows: [] };
  });
  const client = { query: run, release: vi.fn() } as unknown as pg.PoolClient;
  const pool = {
    query: run,
    connect: vi.fn(async () => client),
  } as unknown as pg.Pool;
  return { pool, queries };
}

function progress(phase: string): DiagnosisProgress {
  return {
    loadTargetA: 1.5,
    loadActualA: 1.4,
    partialMetrics: { vLightLoadV: 5.02 },
    windows: [],
    deliveredWh: 0,
    vLightLoadV: 5.02,
    lastElapsedMs: null,
    tempTrail: [],
  };
}

describe("PostgreSQL store query mapping", () => {
  it("maps numeric latest and health columns without leaking DB values", async () => {
    const fake = fakePool();
    const store = createPostgresStore(fake.pool);
    const first = await store.batteryById("b1");
    expect(first?.latest.voltageV).toBe(5.1);
    expect(first?.latest.score).toBe(0.33);
    expect(first?.latest.tempIrSurface).toBe(34);
    first!.latest.voltageV = 99;
    expect((await store.batteryById("b1"))?.latest.voltageV).toBe(5.1);
  });

  it("does not fall back to asset updated_at when no sensor frame exists", async () => {
    const fake = fakePool({ noLatest: true });
    const store = createPostgresStore(fake.pool);
    expect((await store.batteryById("b1"))?.latest).toEqual({
      voltageV: null,
      currentA: null,
      powerW: null,
      tempContact: null,
      tempIrSurface: null,
      socPct: null,
      score: null,
      measuredAt: null,
    });
  });

  it("does not insert a synthetic battery_latest row when creating a battery", async () => {
    const fake = fakePool({ noLatest: true });
    const store = createPostgresStore(fake.pool);
    const created = await store.createBattery("hong", { label: "Fresh battery", targetMode: 1, chemistry: "LI_ION", seriesCount: 3 });
    expect(created.latest.measuredAt).toBeNull();
    expect(fake.queries.some(({ text }) => text.toLowerCase().includes("insert into battery_latest"))).toBe(false);
  });

  it("rejects a session request for another owner's battery before device lookup", async () => {
    const fake = fakePool();
    const store = createPostgresStore(fake.pool);
    await expect(store.startSession("kimeng", "b1")).rejects.toThrow("NOT_FOUND");
    expect(fake.queries.some(({ text }) => text.toLowerCase().includes("from device"))).toBe(false);
  });

  it("does not fabricate a relay for a nonexistent battery", async () => {
    const fake = fakePool({ missingBattery: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.relayByBattery("missing")).rejects.toThrow("NOT_FOUND");
  });

  it("rolls back a state change when its audit insert fails", async () => {
    const fake = fakePool({ failAudit: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.changeOpsStatus("leelab", "b1", "WATCH", "운영 사유")).rejects.toThrow("INTERNAL_ERROR");
    const commands = fake.queries.map(({ text }) => text.trim().toLowerCase());
    expect(commands).toContain("begin");
    expect(commands).toContain("rollback");
    expect(commands).not.toContain("commit");
  });

  it("keeps session creation and SESSION_START audit in one transaction", async () => {
    const fake = fakePool({ failAudit: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.startSession("hong", "b1")).rejects.toThrow("INTERNAL_ERROR");
    const commands = fake.queries.map(({ text }) => text.trim().toLowerCase());
    expect(commands).toContain("rollback");
    expect(commands).not.toContain("commit");
  });

  it("writes a progress snapshot only when the phase changes", async () => {
    const fake = fakePool();
    const store = createPostgresStore(fake.pool);
    await store.advanceDiagnosis("dg1", "P0", progress("P0"));
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("update diagnosis"))).toHaveLength(0);
    await store.advanceDiagnosis("dg1", "P1", progress("P1"));
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("update diagnosis"))).toHaveLength(1);
  });

  it("maps an active-session unique violation to the existing domain code", async () => {
    const fake = fakePool({ failSessionUnique: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.startSession("hong", "b1")).rejects.toThrow("NO_ACTIVE_SESSION");
    expect(fake.queries.map(({ text }) => text.trim().toLowerCase())).toContain("rollback");
  });

  it("reads raw telemetry rows for CSV export", async () => {
    const fake = fakePool();
    const store = createPostgresStore(fake.pool);
    const csv = await store.csvForBattery("b1", "ses1");
    expect(csv).toContain("measured_at,device_id,battery_id,session_id,mode");
    expect(csv).toContain("2026-08-06T01:31:00.000Z,demo-device-01,b1,ses1,2,5.1,-1.2,-6.12");
    expect(csv).toContain('"{""voltage_v"":0}"');
  });

  it("returns header-only CSV when no telemetry row matches", async () => {
    const fake = fakePool({ emptyTelemetry: true });
    const store = createPostgresStore(fake.pool);
    const csv = await store.csvForBattery("b1", "ses1");
    expect(csv).toBe("measured_at,device_id,battery_id,session_id,mode,voltage_v,current_a,power_w,temp_contact,temp_ir_surface,soc_pct,soc_basis,gas_raw,pressure_raw,acoustic_raw,age_ms\n");
  });

  it("maps a diagnosis unique violation to DIAGNOSIS_IN_PROGRESS", async () => {
    const fake = fakePool({ failDiagnosisUnique: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.startDiagnosis("hong", "QUICK", "b1", { acknowledged: true })).rejects.toThrow("DIAGNOSIS_IN_PROGRESS");
  });
});
