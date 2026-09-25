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
  latest_temp_ambient: "24.5",
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
  failOutbox?: boolean;
  failDomainEvent?: boolean;
  failSessionUnique?: boolean;
  failDiagnosisUnique?: boolean;
  emptyTelemetry?: boolean;
  missingBattery?: boolean;
  noLatest?: boolean;
  activeSession?: Record<string, unknown>;
  relayState?: Record<string, unknown>;
  anomalyRows?: Record<string, unknown>[];
  domainEventRows?: Record<string, unknown>[];
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
    latest_temp_ambient: null,
    latest_soc_pct: null,
    latest_score: null,
  } : {}) };
  let diagnosisRow = { ...diagnosis };
  let relayState = options.relayState ? { ...options.relayState } : null;
  const outboxRows: Array<{ event_id: string; dedupe_key: string }> = [];
  const domainEventRows: Record<string, unknown>[] = [...(options.domainEventRows ?? [])];
  const run = vi.fn(async (text: string, values: unknown[] = []) => {
    queries.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] };
    if (options.failAudit && normalized.includes("insert into audit_log")) throw new Error("audit insert failed");
    if (options.failOutbox && normalized.includes("insert into outbox")) throw new Error("outbox insert failed");
    if (options.failDomainEvent && normalized.includes("insert into domain_event")) throw new Error("domain event insert failed");
    if (options.failSessionUnique && normalized.includes("insert into measurement_session")) {
      throw Object.assign(new Error("duplicate active session"), { code: "23505", constraint: "uq_active_session_global" });
    }
    if (options.failDiagnosisUnique && normalized.startsWith("insert into diagnosis")) {
      throw Object.assign(new Error("duplicate active diagnosis"), { code: "23505", constraint: "uq_active_diagnosis_battery" });
    }
    if (normalized.includes("from battery_asset")) return { rows: options.missingBattery ? [] : [batteryRow] };
    if (normalized.includes("from anomaly_score")) return { rows: options.anomalyRows ?? [] };
    if (normalized.startsWith("insert into domain_event")) {
      const dedupeKey = String(values[10]);
      if (!domainEventRows.some((row) => row.dedupe_key === dedupeKey)) {
        domainEventRows.push({
          id: String(values[0]), event_type: values[1], severity: values[2], source: values[3],
          device_id: values[4], battery_id: values[5], session_id: values[6], occurred_at: values[7],
          score: values[8], params: values[9], acknowledged_at: null, acknowledged_by: null,
          dedupe_key: dedupeKey, created_at: "2026-09-15T01:30:00.000Z",
        });
      }
      return { rows: [] };
    }
    if (normalized.startsWith("update domain_event")) {
      const row = domainEventRows.find((candidate) => candidate.id === values[0]);
      if (!row) return { rows: [] };
      row.acknowledged_at = row.acknowledged_at ?? "2026-09-15T01:30:01.000Z";
      row.acknowledged_by = row.acknowledged_by ?? values[1];
      return { rows: [row] };
    }
    if (normalized.includes("from domain_event")) {
      if (normalized.includes("where id = $1")) return { rows: domainEventRows.filter((row) => row.id === values[0]) };
      if (normalized.includes("where dedupe_key = $1")) return { rows: domainEventRows.filter((row) => row.dedupe_key === values[0]) };
      return { rows: domainEventRows };
    }
    if (normalized.startsWith("update battery_asset")) {
      if (normalized.includes("ops_status")) batteryRow = { ...batteryRow, ops_status: values[1], version: 1 };
      return { rows: [] };
    }
    if (normalized.startsWith("insert into outbox")) {
      outboxRows.push({ event_id: String(values[0]), dedupe_key: String(values[1]) });
      return { rows: [] };
    }
    if (normalized.startsWith("select event_id") && normalized.includes("from outbox")) {
      return { rows: outboxRows.filter((row) => row.dedupe_key === String(values[0])) };
    }
    if (normalized.startsWith("update relay_state")) {
      if (relayState) {
        if (normalized.includes("interlock_engaged = true")) {
          relayState = { ...relayState, state: "OPEN", interlock_engaged: true, interlock_condition: values[1], reason_code: values[2], reason_params: null, changed_by: "SYSTEM" };
        } else if (normalized.includes("set state = 'open'")) {
          relayState = { ...relayState, state: "OPEN", reason_code: values[1], reason_params: null, changed_by: values[2] };
        } else {
          relayState = { ...relayState, state: values[1], reason_params: { reason: values[2] }, changed_by: values[3] };
        }
      }
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
    if (normalized.includes("from measurement_session") && options.activeSession && values.length <= 1) {
      return { rows: [options.activeSession] };
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
    if (normalized.includes("from relay_state")) return { rows: relayState ? [relayState] : [] };
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
  return { pool, queries, domainEventRows };
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
    expect(first?.latest.tempAmbient).toBe(24.5);
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
      tempAmbient: null,
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

  it("maps persisted anomaly fields and returns defensive copies", async () => {
    const fake = fakePool({ anomalyRows: [{
      device_id: "demo-device-01",
      battery_id: "b1",
      session_id: "ses1",
      evaluated_at: "2026-09-14T04:00:00.100Z",
      score: "0.82",
      ae_score: "0.79",
      informer_score: "0.86",
      contributions: [{ feature: "dT_dt", contribution: 0.41 }],
      model_version: "ae-1.3+informer-0.9",
      temp_kalman: "42.1",
      temp_cell_estimated: "43.5",
    }] });
    const store = createPostgresStore(fake.pool);
    const first = await store.latestAnomaly("b1");
    expect(first).toMatchObject({
      deviceId: "demo-device-01",
      batteryId: "b1",
      sessionId: "ses1",
      score: 0.82,
      aeScore: 0.79,
      informerScore: 0.86,
      modelVersion: "ae-1.3+informer-0.9",
      tempKalman: 42.1,
      tempCellEstimated: 43.5,
      evaluatedAt: "2026-09-14T04:00:00.100Z",
    });
    first!.contributions![0].contribution = 99;
    expect((await store.latestAnomaly("b1"))?.contributions).toEqual([{ feature: "dT_dt", contribution: 0.41 }]);
  });

  it("persists and acknowledges a domain event idempotently", async () => {
    const fake = fakePool();
    const store = createPostgresStore(fake.pool);
    const input = {
      eventType: "ANOMALY_GRADE_CHANGED" as const,
      severity: "WARNING" as const,
      source: "AI" as const,
      deviceId: "demo-device-01",
      batteryId: "b1",
      sessionId: "ses1",
      occurredAt: "2026-09-15T01:00:00.000Z",
      score: 0.61,
      params: { from: "CAUTION", to: "WARNING" },
      dedupeKey: "anomaly-grade:demo-device-01:2026-09-15T01:00:00.000Z",
    };
    const first = await store.recordDomainEvent(input);
    const replay = await store.recordDomainEvent({ ...input, score: 0.7 });
    expect(replay).toEqual(first);
    expect(fake.domainEventRows).toHaveLength(1);
    const acknowledged = await store.acknowledgeDomainEvent("hong", first.id);
    expect(acknowledged.acknowledgedBy).toBe("hong");
    expect((await store.domainEventById(first.id))?.acknowledgedAt).toBe(acknowledged.acknowledgedAt);
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

  it("records SESSION_ENDED before SESSION_STARTED in the same transaction", async () => {
    const fake = fakePool({
      activeSession: {
        id: "ses-old", battery_id: "b1", owner_user_id: "hong", device_id: "demo-device-01",
        target_mode: 2, status: "ACTIVE", end_reason: null,
        started_at: "2026-08-06T01:20:00.000Z", ended_at: null,
      },
    });
    const store = createPostgresStore(fake.pool);
    await store.startSession("hong", "b1");
    const rows = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into outbox"))
      .map(({ values }) => (values[4] as { code: string }).code);
    expect(rows).toEqual(["SESSION_ENDED", "SESSION_STARTED"]);
    expect(fake.queries.map(({ text }) => text.trim().toLowerCase())).toContain("commit");
  });

  it("cuts the previous relay before SUPERSEDED and new session events on a mode switch", async () => {
    const fake = fakePool({
      activeSession: {
        id: "ses-old", battery_id: "old-battery", owner_user_id: "hong", device_id: "demo-device-01",
        target_mode: 1, status: "ACTIVE", end_reason: null,
        started_at: "2026-08-06T01:20:00.000Z", ended_at: null,
      },
      relayState: {
        battery_id: "old-battery", state: "CLOSED", interlock_engaged: false,
        interlock_condition: null, reason_code: null, reason_params: null,
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "SYSTEM",
      },
    });
    const store = createPostgresStore(fake.pool);
    await store.startSession("hong", "b1");
    const rows = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into outbox"))
      .map(({ values }) => (values[4] as { code: string; params: Record<string, unknown> }));
    expect(rows.map((row) => row.code)).toEqual(["RELAY_CUT", "SESSION_ENDED", "SESSION_STARTED"]);
    expect(rows[0].params).toMatchObject({ batteryId: "old-battery", reasonCode: "MODE_SWITCH" });
  });

  it("does not duplicate a relay outbox row or audit on an idempotency replay", async () => {
    const fake = fakePool({
      relayState: {
        battery_id: "b1", state: "CLOSED", interlock_engaged: false,
        interlock_condition: null, reason_code: null, reason_params: null,
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "SYSTEM",
      },
    });
    const store = createPostgresStore(fake.pool);
    await store.changeRelay("hong", "b1", "cut", "manual cut", "key-1");
    await store.changeRelay("hong", "b1", "cut", "manual cut", "key-1");
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("insert into outbox"))).toHaveLength(1);
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("insert into audit_log"))).toHaveLength(1);
  });

  it("records a user relay restore as a version-1 outbox event", async () => {
    const fake = fakePool({
      relayState: {
        battery_id: "b1", state: "OPEN", interlock_engaged: false,
        interlock_condition: null, reason_code: null, reason_params: { reason: "manual cut" },
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "hong",
      },
    });
    const store = createPostgresStore(fake.pool);
    await store.changeRelay("hong", "b1", "restore", "restore after inspection", "key-restore");
    const event = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into outbox"))
      .map(({ values }) => values[4] as { version: number; code: string; params: Record<string, unknown> });
    expect(event).toEqual([{
      version: 1,
      code: "RELAY_RESTORE",
      params: { batteryId: "b1" },
    }]);
  });

  it("rolls back state when outbox insertion fails", async () => {
    const fake = fakePool({ failOutbox: true });
    const store = createPostgresStore(fake.pool);
    await expect(store.startSession("hong", "b1")).rejects.toThrow("INTERNAL_ERROR");
    const commands = fake.queries.map(({ text }) => text.trim().toLowerCase());
    expect(commands).toContain("rollback");
    expect(commands).not.toContain("commit");
  });

  it("records a BLOCKED session end in the same transaction", async () => {
    const fake = fakePool({
      activeSession: {
        id: "ses-active", battery_id: "b1", owner_user_id: "hong", device_id: "demo-device-01",
        target_mode: 2, status: "ACTIVE", end_reason: null,
        started_at: "2026-08-06T01:20:00.000Z", ended_at: null,
      },
    });
    const store = createPostgresStore(fake.pool);
    await store.changeOpsStatus("hong", "b1", "BLOCKED", "safety hold", 0);
    const events = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into outbox"))
      .map(({ values }) => values[4] as { code: string; params: Record<string, unknown> });
    expect(events).toEqual([{
      version: 1,
      code: "SESSION_ENDED",
      params: { sessionId: "ses-active", batteryId: "b1", endReason: "BLOCKED" },
    }]);
    expect(fake.queries.map(({ text }) => text.trim().toLowerCase())).toContain("commit");
  });

  it("persists a Fail-Safe RELAY_CUT beside the auto-cut audit", async () => {
    const fake = fakePool({
      relayState: {
        battery_id: "b1", state: "CLOSED", interlock_engaged: false,
        interlock_condition: null, reason_code: null, reason_params: null,
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "SYSTEM",
      },
    });
    const store = createPostgresStore(fake.pool);
    const engagement = await store.engageFailsafe("b1", "TEMP_ABSOLUTE", "IR_SURFACE");
    expect(engagement.newlyEngaged).toBe(true);
    expect(engagement.relay.interlockEngaged).toBe(true);
    const event = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into outbox"))
      .map(({ values }) => values[4] as { code: string; params: Record<string, unknown> });
    expect(event).toEqual([{
      version: 1,
      code: "RELAY_CUT",
      params: { batteryId: "b1", reasonCode: "TEMP_ABSOLUTE" },
    }]);
    const audit = fake.queries
      .filter(({ text }) => text.toLowerCase().includes("insert into audit_log"))
      .map(({ values }) => values.slice(1, 5));
    expect(audit).toContainEqual(["RELAY_AUTO_CUT", "b1", "SUCCESS", "TEMP_ABSOLUTE"]);
    expect(fake.domainEventRows).toHaveLength(1);
    const transactionCommands = fake.queries.map(({ text }) => text.trim().toLowerCase());
    expect(transactionCommands.indexOf("begin")).toBeLessThan(transactionCommands.findIndex((text) => text.includes("update relay_state")));
    expect(transactionCommands.findIndex((text) => text.includes("insert into audit_log"))).toBeLessThan(transactionCommands.findIndex((text) => text.includes("insert into domain_event")));
    expect(transactionCommands.findIndex((text) => text.includes("insert into domain_event"))).toBeLessThan(transactionCommands.findIndex((text) => text.includes("insert into outbox")));
    expect(transactionCommands.indexOf("commit")).toBeGreaterThan(transactionCommands.findIndex((text) => text.includes("insert into outbox")));

    const replay = await store.engageFailsafe("b1", "TEMP_ABSOLUTE", "IR_SURFACE");
    expect(replay.newlyEngaged).toBe(false);
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("insert into audit_log"))).toHaveLength(1);
    expect(fake.domainEventRows).toHaveLength(1);
    expect(fake.queries.filter(({ text }) => text.toLowerCase().includes("insert into outbox"))).toHaveLength(1);
  });

  it.each([
    ["audit", { failAudit: true }],
    ["domain event", { failDomainEvent: true }],
    ["outbox", { failOutbox: true }],
  ] as const)("rolls back a Fail-Safe engagement when the %s write fails", async (_name, options) => {
    const fake = fakePool({
      ...options,
      relayState: {
        battery_id: "b1", state: "CLOSED", interlock_engaged: false,
        interlock_condition: null, reason_code: null, reason_params: null,
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "SYSTEM",
      },
    });
    const store = createPostgresStore(fake.pool);
    await expect(store.engageFailsafe("b1", "TEMP_ABSOLUTE", "IR_SURFACE")).rejects.toThrow("INTERNAL_ERROR");
    const commands = fake.queries.map(({ text }) => text.trim().toLowerCase());
    expect(commands).toContain("rollback");
    expect(commands).not.toContain("commit");
  });

  it("does not append a second durable cut when the PostgreSQL interlock is already latched", async () => {
    const fake = fakePool({
      relayState: {
        battery_id: "b1", state: "OPEN", interlock_engaged: true,
        interlock_condition: "TEMP_OVER_CAP", reason_code: "TEMP_ABSOLUTE", reason_params: null,
        changed_at: "2026-08-06T01:20:00.000Z", changed_by: "SYSTEM",
      },
    });
    const engagement = await createPostgresStore(fake.pool).engageFailsafe("b1", "TEMP_ABSOLUTE", "IR_SURFACE");

    expect(engagement.newlyEngaged).toBe(false);
    expect(fake.queries.some(({ text }) => text.toLowerCase().includes("insert into audit_log"))).toBe(false);
    expect(fake.domainEventRows).toHaveLength(0);
    expect(fake.queries.some(({ text }) => text.toLowerCase().includes("insert into outbox"))).toBe(false);
  });
});
