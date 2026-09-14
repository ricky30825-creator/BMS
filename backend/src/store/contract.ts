import type { AnomalyScoreRecord, DemoAudit, DemoBattery, DemoDiagnosis, DemoRelay, DemoSession, DemoStatus, DemoUser, DiagnosisProgress, OpsStatus } from "./types.js";

export type CreateBatteryInput = {
  label: string;
  maker?: string | null;
  model?: string | null;
  targetMode: 1 | 2;
  chemistry: "LI_ION" | "LI_PO";
  seriesCount?: number | null;
  capacityWh?: number | null;
  ratedOutputCurrentA?: number | null;
};

export type UpdateBatteryInput = {
  label?: string;
  maker?: string | null;
  model?: string | null;
  seriesCount?: number | null;
  memo?: string;
};

export type IdempotencyResult = { kind: "new" | "replay" | "conflict"; status?: number; body?: unknown };

// 도메인 저장소 계약. 인메모리와 PostgreSQL 구현체가 이 인터페이스를 공유하며,
// store/contract.test.ts가 두 구현체에 같은 테스트를 돌린다.
//
// 규칙 세 가지:
//  1. 실패는 전부 `throw new Error("<CODE>")`다. CODE는 docs/backend_contract.md
//     §1.10의 목록에 있는 것만 쓴다. server.ts의 errorFromDomain()이 HTTP 상태로
//     옮긴다.
//  2. 반환값은 호출부가 마음대로 고쳐도 저장소가 오염되지 않아야 한다(방어 복사).
//  3. 감사 로그를 함께 남기는 메서드는 원자적이어야 한다 — 계약 §3.4.
//     changeRelay / changeOpsStatus / saveMemo / changeUserStatus / startSession이
//     해당한다. PostgreSQL 구현체는 이들을 한 트랜잭션에 넣어야 한다.
export interface CellGuardStore {
  // 조회
  userById(id: string): Promise<DemoUser | undefined>;
  users(): Promise<DemoUser[]>;
  batteryById(id: string): Promise<DemoBattery | undefined>;
  batteries(ownerId?: string): Promise<DemoBattery[]>;
  activeSession(ownerId?: string): Promise<DemoSession | null>;
  sessionById(id: string): Promise<DemoSession | undefined>;
  sessionsForBattery(batteryId: string): Promise<DemoSession[]>;
  latestAnomaly(batteryId: string): Promise<AnomalyScoreRecord | null>;
  anomalyScoresForBattery(batteryId: string, from?: string, to?: string): Promise<AnomalyScoreRecord[]>;
  activeDiagnosis(batteryId?: string): Promise<DemoDiagnosis | null>;
  diagnosisById(id: string): Promise<DemoDiagnosis | undefined>;
  diagnosesForBattery(batteryId: string): Promise<DemoDiagnosis[]>;
  relayByBattery(id: string): Promise<DemoRelay>;
  audits(): Promise<DemoAudit[]>;

  // 변경
  createBattery(ownerId: string, input: CreateBatteryInput): Promise<DemoBattery>;
  updateBattery(ownerId: string, batteryId: string, input: UpdateBatteryInput): Promise<DemoBattery>;
  recordAudit(input: Omit<DemoAudit, "id" | "at">): Promise<DemoAudit>;
  startSession(ownerId: string, batteryId: string): Promise<DemoSession>;
  changeOpsStatus(actorId: string, batteryId: string, next: OpsStatus, reason: string, expectedVersion?: number): Promise<DemoBattery>;
  saveMemo(actorId: string, batteryId: string, memo: string, expectedVersion?: number): Promise<DemoBattery>;
  changeUserStatus(actorId: string, userId: string, status: DemoStatus, reason: string): Promise<DemoUser>;
  changeRelay(actorId: string, batteryId: string, action: "cut" | "restore", reason: string): Promise<DemoRelay>;
  // 서버 Fail-Safe 전용. 사용자 조작(changeRelay)과 달리 인터락을 **건다**.
  // 지금 저장소에는 interlockEngaged를 런타임에 true로 만드는 경로가 없어서
  // (store/memory.ts:51-62의 픽스처가 유일) B3가 이 메서드를 필요로 한다.
  // 릴레이 상태 전이 + RELAY_AUTO_CUT 감사 기록이 원자적이어야 한다.
  engageFailsafe(batteryId: string, triggerCode: string, condition: string): Promise<DemoRelay>;
  startDiagnosis(ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): Promise<DemoDiagnosis>;
  abortDiagnosis(ownerId: string, batteryId: string): Promise<DemoDiagnosis>;
  advanceDiagnosis(id: string, phase: string, progress: DiagnosisProgress): Promise<DemoDiagnosis>;
  completeDiagnosis(id: string, result: Record<string, unknown>): Promise<DemoDiagnosis>;
  // 안전 중단·세션 종료용. abortDiagnosis와 달리 활성 세션과 소유자를
  // 검사하지 않는다 — 세션이 끝난 뒤에는 그 검사를 통과할 수 없어서
  // 진단이 영원히 RUNNING으로 남는다.
  abortDiagnosisBySystem(batteryId: string, reason: string): Promise<DemoDiagnosis | null>;

  // 멱등성
  idempotent(actorId: string, key: string, body: unknown): Promise<IdempotencyResult>;
  rememberIdempotency(actorId: string, key: string, body: unknown, status: number, response: unknown): Promise<void>;

  // 파생
  mode1Health(battery: DemoBattery): Promise<Record<string, unknown> | null>;
  csvForBattery(batteryId: string, sessionId: string | null, from?: string, to?: string): Promise<string>;
}
