export * from "./store/types.js";
export type { CellGuardStore, CreateBatteryInput, IdempotencyResult, UpdateBatteryInput } from "./store/contract.js";

import { createMemoryStore } from "./store/memory.js";

// DATA_MODE=postgres는 server.ts:356의 가드가 /api/* 전체를 503으로 막으므로
// 여기까지 오지 않는다. PostgreSQL 구현체가 생기면(B1 2단계) 그때 분기한다.
const active = createMemoryStore();

export const demoUsers = active.demoUsers;

// 이름을 유지하는 위임 함수. 호출부는 `await`만 붙이면 되고 함수명은 그대로다.
export const userById = active.userById.bind(active);
export const users = active.users.bind(active);
export const batteryById = active.batteryById.bind(active);
export const batteries = active.batteries.bind(active);
export const activeSession = active.activeSession.bind(active);
export const sessionById = active.sessionById.bind(active);
export const sessionsForBattery = active.sessionsForBattery.bind(active);
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
export const idempotent = active.idempotent.bind(active);
export const rememberIdempotency = active.rememberIdempotency.bind(active);
export const mode1Health = active.mode1Health.bind(active);
export const csvForBattery = active.csvForBattery.bind(active);
