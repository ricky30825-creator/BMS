export * from "./store/types.js";
export type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./store/contract.js";

import { env } from "./config/env.js";
import { closeDb, db } from "./db.js";
import { createMemoryStore } from "./store/memory.js";
import { createPostgresStore } from "./store/postgres.js";

const active = env.DATA_MODE === "postgres" ? createPostgresStore(db) : createMemoryStore();

const REQUIRED_POSTGRES_TABLES = [
  "user",
  "app_user_profile",
  "audit_log",
  "battery_asset",
  "measurement_session",
  "relay_state",
  "telemetry_metric",
  "diagnosis",
  "idempotency_key",
  "device",
  "anomaly_score",
  "battery_latest",
  "battery_health",
  "outbox",
] as const;

// 서버는 listen 전에 스키마와 연결을 확인한다. PostgreSQL 모드에서
// 초기화가 실패하면 fabricated memory data로 대체하지 않고 프로세스를
// 시작하지 않는다.
export async function initializeStore(): Promise<void> {
  if (env.DATA_MODE !== "postgres") return;
  const result = await db.query<{
    table_count: number;
    progress_snapshot: string | null;
    raw_payload: string | null;
    outbox_event_id: string | null;
    outbox_dedupe_key: string | null;
    outbox_next_attempt_at: string | null;
    outbox_claim_token: string | null;
    outbox_lease_until: string | null;
    outbox_dead_at: string | null;
  }>(`
    select
      count(*)::int as table_count,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'diagnosis'
         and column_name = 'progress_snapshot') as progress_snapshot,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'telemetry_metric'
         and column_name = 'raw_payload') as raw_payload,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'event_id') as outbox_event_id,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'dedupe_key') as outbox_dedupe_key,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'next_attempt_at') as outbox_next_attempt_at,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'claim_token') as outbox_claim_token,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'lease_until') as outbox_lease_until,
      (select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'outbox'
         and column_name = 'dead_at') as outbox_dead_at
    from information_schema.tables
    where table_schema = 'public' and table_name = any($1::text[])
  `, [REQUIRED_POSTGRES_TABLES]);
  const schema = result.rows[0];
  if (!schema || Number(schema.table_count) !== REQUIRED_POSTGRES_TABLES.length || !schema.progress_snapshot || !schema.raw_payload || !schema.outbox_event_id || !schema.outbox_dedupe_key || !schema.outbox_next_attempt_at || !schema.outbox_claim_token || !schema.outbox_lease_until || !schema.outbox_dead_at) {
    throw new Error("PostgreSQL schema is not ready; run npm run db:migrate (including 009_outbox_delivery.sql)");
  }
}

export async function closeStore(): Promise<void> {
  await closeDb();
}

// 이름을 유지하는 위임 함수. 호출부는 `await`만 붙이면 되고 함수명은 그대로다.
export const userById = active.userById.bind(active);
export const users = active.users.bind(active);
export const batteryById = active.batteryById.bind(active);
export const batteries = active.batteries.bind(active);
export const activeSession = active.activeSession.bind(active);
export const sessionById = active.sessionById.bind(active);
export const sessionsForBattery = active.sessionsForBattery.bind(active);
export const latestAnomaly = active.latestAnomaly.bind(active);
export const anomalyScoresForBattery = active.anomalyScoresForBattery.bind(active);
export const activeDiagnosis = active.activeDiagnosis.bind(active);
export const diagnosisById = active.diagnosisById.bind(active);
export const diagnosesForBattery = active.diagnosesForBattery.bind(active);
export const relayByBattery = active.relayByBattery.bind(active);
export const audits = active.audits.bind(active);
export const createBattery = active.createBattery.bind(active);
export const updateBattery = active.updateBattery.bind(active);
export const recordAudit = active.recordAudit.bind(active);
export const startSession = active.startSession.bind(active);
export const changeOpsStatus = active.changeOpsStatus.bind(active);
export const saveMemo = active.saveMemo.bind(active);
export const changeUserStatus = active.changeUserStatus.bind(active);
export const changeRelay = active.changeRelay.bind(active);
export const engageFailsafe = active.engageFailsafe.bind(active);
export const startDiagnosis = active.startDiagnosis.bind(active);
export const abortDiagnosis = active.abortDiagnosis.bind(active);
export const advanceDiagnosis = active.advanceDiagnosis.bind(active);
export const completeDiagnosis = active.completeDiagnosis.bind(active);
export const abortDiagnosisBySystem = active.abortDiagnosisBySystem.bind(active);
export const idempotent = active.idempotent.bind(active);
export const rememberIdempotency = active.rememberIdempotency.bind(active);
export const mode1Health = active.mode1Health.bind(active);
export const csvForBattery = active.csvForBattery.bind(active);
