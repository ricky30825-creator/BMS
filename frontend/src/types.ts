export type Role = "USER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED";
export type OpsStatus = "NORMAL" | "WATCH" | "BLOCKED";
export type RelayState = "CLOSED" | "OPEN";
export type Grade = "NORMAL" | "CAUTION" | "WARNING" | "DANGER";
export type MetricStatus = "OK" | "WARN" | "CRIT" | null;
export type Mode = 1 | 2;

export type Page = { number: number; size: number; total: number; totalPages: number };

export type ApiUser = {
  id: string;
  name: string;
  loginId?: string;
  email: string;
  phone?: string | null;
  role: Role;
  status: AccountStatus;
  joinedAt?: string;
};

export type ActiveSession = {
  id: string;
  batteryId: string;
  batteryLabel: string;
  deviceId?: string;
  mode?: Mode;
  targetMode?: Mode;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
};

export type Preferences = { theme: "light" | "dark" | "system"; lang: "ko" | "en" };
export type AlertChannels = { KAKAO: boolean; EMAIL: boolean; SMS: boolean; WEBPUSH: boolean };
export type AlertSettings = { channels: AlertChannels; policy?: { sendOn?: string[]; smsOnlyDanger?: boolean; dedupeWindowMinutes?: number } };

export type MeResponse = {
  user: ApiUser | null;
  activeSession: ActiveSession | null;
  unreadAlertCount: number;
  activeAnomalyCount: number;
  preferences: Preferences;
};

export type Scored = { score: number; grade: Grade };

export type LatestMetric = Scored & {
  voltageV: number | null;
  currentA: number | null;
  powerW?: number | null;
  representativeTempC: number | null;
  representativeTempSource?: "CONTACT" | "IR_SURFACE" | null;
  tempContact?: number | null;
  tempIrSurface?: number | null;
  socPct: number | null;
  socBasis?: "ABSOLUTE_GAUGE" | "RELATIVE_SESSION_START" | null;
  measuredAt: string | null;
};

export type BatteryHealth = {
  source?: string;
  confidence?: "LOW" | "HIGH";
  measuredAt?: string;
  sohPct: number | null;
  rulCycles: number | null;
  cycleCount: number | null;
  internalResistanceMohm: number | null;
  capacity?: {
    deliveredWh: number | null;
    ratedWh: number | null;
    baselineWh: number | null;
    sohRelPct: number | null;
    sohAbsPct: number | null;
    assumedEfficiency: number | null;
  } | null;
};

export type DiagnosisCapability = { executionAllowed: boolean; reasonCode: string | null };

export type Battery = {
  id: string;
  label: string;
  chemistry: "LI_ION" | "LI_PO";
  seriesCount: number | null;
  maker: string | null;
  model: string | null;
  targetMode: Mode;
  hardwareProfile?: string;
  capacityWh: number | null;
  ratedOutputCurrentA: number | null;
  opsStatus: OpsStatus;
  memo?: string | null;
  adminMemo?: string;
  version?: number;
  isConnected?: boolean;
  latest: LatestMetric | null;
  health: BatteryHealth | null;
  diagnosisCapability?: DiagnosisCapability;
};

export type AdminBatteryListItem = {
  id: string;
  label: string;
  owner: Pick<ApiUser, "id" | "name">;
  maker: string | null;
  model: string | null;
  chemistry: Battery["chemistry"];
  seriesCount: number | null;
  mode: Mode;
  score: number | null;
  grade: Grade | null;
  opsStatus: OpsStatus;
  latest: { tempC: number | null; voltageV: number | null; socPct: number | null; measuredAt: string | null } | null;
};

export type AdminBatteryDetail = AdminBatteryListItem & {
  info: {
    seriesConfig: string;
    device: { id: string; label: string; status: string } | null;
    adminMemo: string;
  };
  opsLogs: Array<{ at: string; severity: EventSeverity; code: string; params?: Record<string, unknown> }>;
};

export type AdminStatusMutationResponse = {
  opsStatus: OpsStatus;
  updatedAt: string;
  updatedBy: string;
};

export type AdminMemoMutationResponse = { memo: string; updatedAt: string; updatedBy: string };

export type MetricValue = { value: number | null; status: MetricStatus; ageMs?: number; freshness?: "FRESH" | "STALE" };

export type DashboardMetrics = {
  voltageV: MetricValue;
  currentA: MetricValue;
  powerW?: MetricValue;
  tempContact: MetricValue;
  tempIrSurface: MetricValue;
  representativeTempC: MetricValue & { source?: "CONTACT" | "IR_SURFACE" | null };
  socPct: MetricValue;
  socBasis?: "ABSOLUTE_GAUGE" | "RELATIVE_SESSION_START" | null;
  measuredAt: string;
};

export type NoticeSummary = { id: string; category: NoticeCategory; title: string; summary: string; publishedAt: string };
export type NoticeCategory = "IMPORTANT" | "MAINTENANCE" | "FEATURE" | "INFO";

export type Dashboard = {
  session: ActiveSession;
  battery: Battery;
  metrics: DashboardMetrics;
  anomaly: Scored & { aeScore?: number | null; informerScore?: number | null; evaluatedAt?: string };
  relay: Relay;
  notices: NoticeSummary[];
  quickTrend?: { metric: "volt" | "curr" | "temp" | "soc"; points: Array<{ at: string; value: number | null }> };
  snapshotCursor: string;
};

export type RelayActor = { type: "SYSTEM"; systemCode?: string } | { type: "USER"; id: string; name: string };
export type Relay = {
  batteryId: string;
  state: RelayState;
  reason?: string | null;
  reasonCode?: string | null;
  reasonParams?: Record<string, unknown> | null;
  changedAt: string;
  changedBy: RelayActor;
  interlock: { engaged: boolean; condition: string | null; canRestore: boolean };
};

export type RelayHistory = {
  id: string;
  action: "RELAY_CUT" | "RELAY_RESTORE" | "RELAY_AUTO_CUT";
  at: string;
  actor: RelayActor;
  reason?: string;
  reasonCode?: string;
  reasonParams?: Record<string, unknown>;
};

export type AnomalySummary = {
  activeCount: number;
  todayCount: number;
  peakScore: number;
  peakAt: string;
  model: { status: "RUNNING" | "DEGRADED" | "STOPPED"; lastInferenceAt: string; version: string };
  riskDistribution: Record<Grade, number>;
};

export type Evidence = { batteryId: string; score: number; evaluatedAt: string; contributions: Array<{ feature: string; contribution: number }> };
export type EventSeverity = "NORMAL" | "CAUTION" | "WARNING" | "DANGER" | "CUT";
export type BatteryEvent = {
  id: string;
  occurredAt: string;
  type: string;
  batteryId: string | null;
  batteryLabel: string | null;
  score: number | null;
  grade: Grade | null;
  severity: EventSeverity;
  source: "SYSTEM" | "AI" | "INGEST" | "USER";
  causeCode?: string;
  causeParams?: Record<string, unknown>;
  actionCode?: string;
  actionParams?: Record<string, unknown>;
};

export type Alert = {
  id: string;
  severity: "DANGER" | "WARNING" | "NORMAL" | "CHECK";
  titleCode: string;
  params?: Record<string, number | string | null>;
  batteryId?: string | null;
  batteryLabel?: string | null;
  subjectType: "BATTERY" | "DEVICE";
  occurredAt: string;
  acknowledgedAt: string | null;
  channels: string[];
  metrics?: Record<string, number | string | null>;
  rawSnapshot?: Record<string, unknown>;
};

export type TrendResponse = {
  period: "24h" | "7d" | "30d";
  buckets: string[];
  series: Array<{ batteryId: string; batteryLabel: string; metric: "volt" | "curr" | "temp" | "soc"; unit: string; points: Array<number | null> }>;
};

export type Diagnosis = {
  id: string;
  batteryId: string;
  batteryLabel?: string;
  sessionId: string;
  kind: "QUICK" | "CAPACITY";
  status: "RUNNING" | "COMPLETED" | "ABORTED" | "FAILED";
  phase?: string;
  confidence?: "LOW" | "HIGH";
  startedAt: string;
  measuredAt?: string;
  estimatedEndAt?: string | null;
  loadTargetA?: number | null;
  loadActualA?: number | null;
  socHintLevel?: 1 | 2 | 3 | 4 | null;
  abortReason?: string | null;
  partialMetrics?: Record<string, number | null> | null;
  result?: Record<string, unknown> | null;
  quick?: {
    regulationKneeA?: number | null;
    thermalSlopeCPerMin?: number | null;
    grade?: string | null;
    [key: string]: unknown;
  } | null;
  capacity?: {
    deliveredWh?: number | null;
    ratedWh?: number | null;
    baselineWh?: number | null;
    sohRelPct?: number | null;
    sohAbsPct?: number | null;
    assumedEfficiency?: number | null;
    dischargeCurrentA?: number | null;
    isBaseline?: boolean | null;
    partial?: boolean | null;
    [key: string]: unknown;
  } | null;
};

export type DiagnosisListItem = Pick<Diagnosis, "id" | "batteryId" | "batteryLabel" | "kind" | "status" | "confidence" | "measuredAt" | "socHintLevel"> & {
  summary?: Record<string, number | string | null> | null;
};

export type AdminOverview = { users: number; batteries: number; activeSessions: number; blockedBatteries: number; relayOpen: number };
export type AuditEntry = { id: string; actorId: string | null; actorName?: string; action: string; resource: string; result: string; reason: string | null; at: string; before?: unknown; after?: unknown };

export type WsEnvelope<T = unknown> = {
  v: number;
  type: string;
  topic?: string;
  eventId?: string;
  streamId?: string;
  sequence?: string;
  cursor?: string;
  at?: string;
  sessionId?: string | null;
  requestId?: string | null;
  payload: T;
};

export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "ACCOUNT_SUSPENDED" | "VALIDATION_FAILED" | "NOT_FOUND" | "NO_STATUS_CHANGE"
  | "BATTERY_BLOCKED" | "NO_ACTIVE_SESSION" | "DEVICE_OFFLINE" | "REASON_REQUIRED" | "INPUT_TOO_LONG"
  | "VERSION_CONFLICT" | "REAUTH_REQUIRED" | "INTERLOCK_LOCKED" | "MODE_NOT_SUPPORTED" | "SAFETY_PROFILE_NOT_READY"
  | "DIAGNOSIS_IN_PROGRESS" | "NO_DIAGNOSIS_IN_PROGRESS" | "ACK_REQUIRED" | "FULL_CHARGE_REQUIRED" | "IDEMPOTENCY_CONFLICT"
  | "BATTERY_NAME_REQUIRED" | "CAPACITY_REQUIRED" | "RATED_CURRENT_REQUIRED" | "RUNTIME_NOT_READY" | "UNKNOWN";
