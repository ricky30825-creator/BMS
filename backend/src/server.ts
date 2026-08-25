import { createServer, type IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { corsOrigins, env } from "./config/env.js";
import { demoPasswordMatches, demoUserForToken, issueDemoToken, requireRole, requireSession, revokeDemoToken, setDemoPassword } from "./auth/middleware.js";
import { writeAuditLog } from "./auth/audit.js";
import { detectGradeTransition, gradeForScore, type Grade } from "./realtime/grade.js";
import { createEventLog } from "./realtime/eventLog.js";
import {
  F21_THRESHOLDS,
  abortDiagnosis,
  activeDiagnosis,
  activeSession,
  audits,
  batteries,
  batteryById,
  changeRelay,
  changeOpsStatus,
  changeUserStatus,
  createBattery,
  csvForBattery,
  diagnosisById,
  diagnosesForBattery,
  demoUsers,
  idempotent,
  mode1Health,
  recordAudit,
  relayByBattery,
  rememberIdempotency,
  saveMemo,
  startDiagnosis,
  startSession,
  sessionsForBattery,
  updateBattery,
  userById
} from "./store.js";

const app = express();
const httpServer = createServer(app);
type WsTopic = "metrics" | "anomaly" | "relay" | "alert" | "event" | "session" | "diagnosis";
type WsClient = { socket: Socket; batteryId: string | null; userId: string; role: "USER" | "ADMIN"; topics: Set<WsTopic>; subscribed: boolean };
const wsClients = new Set<WsClient>();
const eventLog = createEventLog(10_000);
let wsSequence = 0;
const wsStreamId = "demo-stream";
const demoPreferences = new Map<string, { theme: "light" | "dark" | "system"; lang: "ko" | "en" }>();
const demoAlertChannels = new Map<string, { KAKAO: boolean; EMAIL: boolean; SMS: boolean; WEBPUSH: boolean }>();

function channelsForAlert(ownerId: string, grade: "WARNING" | "DANGER"): Array<"KAKAO" | "EMAIL" | "SMS" | "WEBPUSH"> {
  const settings = demoAlertChannels.get(ownerId) ?? { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: true };
  const keys = (["KAKAO", "EMAIL", "SMS", "WEBPUSH"] as const).filter((key) => settings[key]);
  return keys.filter((key) => key !== "SMS" || grade === "DANGER");
}

app.use(
  cors({
    origin: [...new Set([...corsOrigins, "http://127.0.0.1:8766", "http://localhost:8766", "http://127.0.0.1:8767", "http://localhost:8767"])],
    credentials: true
  })
);

app.all("/api/auth/*", toNodeHandler(auth));
app.use(express.json({ limit: "64kb" }));

function apiError(res: Response, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

function actorId(req: Request): string {
  return req.appUser?.id ?? req.authSession?.user.id ?? "anonymous";
}

function actorName(req: Request): string {
  return req.appUser?.name ?? req.authSession?.user.name ?? "Unknown";
}

function temperatureStatus(value: number | null): "OK" | "WARN" | "CRIT" | null {
  if (value === null) return null;
  if (value >= 60) return "CRIT";
  if (value >= 55) return "WARN";
  return "OK";
}

function metric(value: number | null, status: "OK" | "WARN" | "CRIT" | null): { value: number | null; status: "OK" | "WARN" | "CRIT" | null } {
  return { value, status };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@", 2);
  if (!local || !domain) return "";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function relayJson(batteryId: string) {
  const relay = relayByBattery(batteryId);
  const changedBy = relay.changedBy === "SYSTEM"
    ? { type: "SYSTEM", systemCode: relay.reasonCode === "FAILSAFE_TEMP_IR_OVER_CAP" ? "FAILSAFE" : "SYSTEM" }
    : { type: "USER", id: relay.changedBy, name: userById(relay.changedBy)?.name ?? relay.changedBy };
  return {
    batteryId: relay.batteryId,
    state: relay.state,
    reason: relay.reason,
    reasonCode: relay.reasonCode,
    changedAt: relay.changedAt,
    changedBy,
    reasonParams: null,
    interlock: {
      engaged: relay.interlockEngaged,
      condition: relay.interlockCondition,
      canRestore: !relay.interlockEngaged
    }
  };
}

function batteryJson(battery: ReturnType<typeof batteryById>) {
  if (!battery) return null;
  const tempCandidates = [battery.latest.tempContact, battery.latest.tempIrSurface].filter((value): value is number => value !== null);
  const representativeTempC = tempCandidates.length ? Math.max(...tempCandidates) : null;
  const representativeTempSource = representativeTempC === null ? null : battery.latest.tempContact === representativeTempC ? "CONTACT" : "IR_SURFACE";
  const hardwareProfile = battery.targetMode === 2 ? "COMBINED_EXISTING_PARTS_V1" : "MODE1_EXTERNAL_CELL_V1";
  const mode2ProfileReady = false;
  return {
    id: battery.id,
    label: battery.label,
    chemistry: battery.chemistry,
    seriesCount: battery.seriesCount,
    maker: battery.maker,
    model: battery.model,
    targetMode: battery.targetMode,
    hardwareProfile,
    capacityWh: battery.capacityWh,
    ratedOutputCurrentA: battery.ratedOutputCurrentA,
    opsStatus: battery.opsStatus,
    adminMemo: battery.adminMemo,
    version: battery.version,
    latest: {
      voltageV: battery.latest.voltageV,
      currentA: battery.latest.currentA,
      powerW: battery.latest.powerW,
      representativeTempC,
      representativeTempSource,
      tempContact: battery.latest.tempContact,
      tempIrSurface: battery.latest.tempIrSurface,
      socPct: battery.targetMode === 2 && !mode2ProfileReady ? null : battery.latest.socPct,
      socBasis: battery.targetMode === 2 ? (mode2ProfileReady ? "RELATIVE_SESSION_START" : null) : "ABSOLUTE_GAUGE",
      score: battery.latest.score,
      grade: gradeForScore(battery.latest.score),
      measuredAt: battery.latest.measuredAt
    },
    memo: battery.memo,
    health: mode1Health(battery),
    diagnosisCapability: battery.targetMode === 2
      ? { executionAllowed: false, reasonCode: "SAFETY_PROFILE_NOT_READY" }
      : { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" }
  };
}

const demoNotices = [
  { id: "notice-maintenance", category: "MAINTENANCE", title: "7월 정기 서버 점검 (무중단)", summary: "WebSocket 순단이 발생할 수 있으나 자동 재연결됩니다.", body: "7/7 00:00~04:00 인프라 점검이 진행됩니다. WebSocket 순단이 발생할 수 있으나 자동 재연결되며, 측정 데이터는 버퍼링 후 복원됩니다.", publishedAt: "2026-07-01T00:00:00.000Z", status: "PUBLISHED", views: 892 },
  { id: "notice-feature", category: "FEATURE", title: "이상 근거(XAI) 패널 정식 오픈", summary: "이상점수 상승에 기여한 특징을 확인할 수 있습니다.", body: "이상 탐지 화면에서 서버가 제공하는 기여 요인을 확인할 수 있습니다.", publishedAt: "2026-06-28T00:00:00.000Z", status: "PUBLISHED", views: 614 },
  { id: "notice-info", category: "INFO", title: "모드 2 진단 안전 프로필 안내", summary: "실측 전까지 보조배터리 진단은 실행 잠금 상태입니다.", body: "현재 연결 부품 프로필은 안전 문턱과 연속 감시가 준비되지 않아 F21 진단을 실행할 수 없습니다.", publishedAt: "2026-06-20T00:00:00.000Z", status: "PUBLISHED", views: 431 }
] as const;

function sessionJson(session: NonNullable<ReturnType<typeof activeSession>>) {
  const battery = batteryById(session.batteryId);
  return { ...session, batteryLabel: battery?.label ?? session.batteryId, mode: session.targetMode, targetMode: session.targetMode };
}

function dashboardMetrics(battery: NonNullable<ReturnType<typeof batteryById>>) {
  const payload = batteryJson(battery)!;
  const latest = payload.latest;
  return {
    voltageV: metric(latest.voltageV, null),
    currentA: metric(latest.currentA, null),
    powerW: metric(latest.powerW, null),
    tempContact: metric(latest.tempContact, temperatureStatus(latest.tempContact)),
    tempIrSurface: metric(latest.tempIrSurface, temperatureStatus(latest.tempIrSurface)),
    representativeTempC: { ...metric(latest.representativeTempC, temperatureStatus(latest.representativeTempC)), source: latest.representativeTempSource },
    socPct: metric(latest.socPct, null),
    socBasis: latest.socBasis,
    measuredAt: latest.measuredAt
  };
}

function anomalyJson(battery: NonNullable<ReturnType<typeof batteryById>>) {
  const score = battery.latest.score;
  return { score, grade: gradeForScore(score), aeScore: null, informerScore: null, evaluatedAt: battery.latest.measuredAt };
}

function quickTrend(battery: NonNullable<ReturnType<typeof batteryById>>, metricName: string) {
  const latest = batteryJson(battery)!.latest;
  const values: Record<string, number | null> = { volt: latest.voltageV, curr: latest.currentA, temp: latest.representativeTempC, soc: latest.socPct };
  const metricKey = metricName === "volt" || metricName === "curr" || metricName === "temp" || metricName === "soc" ? metricName : "temp";
  return { metric: metricKey, points: [{ at: latest.measuredAt, value: values[metricKey] ?? null }] };
}

function dashboardJson(session: NonNullable<ReturnType<typeof activeSession>>, battery: NonNullable<ReturnType<typeof batteryById>>, metricName: string) {
  const payload = batteryJson(battery)!;
  const snapshotCursor = String(Date.now());
  return {
    session: sessionJson(session),
    battery: payload,
    metrics: dashboardMetrics(battery),
    anomaly: anomalyJson(battery),
    relay: relayJson(battery.id),
    notices: demoNotices.slice(0, 3).map(({ body: _body, status: _status, views: _views, ...notice }) => notice),
    quickTrend: quickTrend(battery, metricName),
    sync: { streamId: wsStreamId, snapshotCursor, asOf: new Date().toISOString() },
    snapshotCursor
  };
}

function pageEnvelope<T>(items: T[], page = 1, size = 20) {
  const offset = Math.max(0, (page - 1) * size);
  const paged = items.slice(offset, offset + size);
  return { items: paged, page: { number: page, size, total: items.length, totalPages: items.length ? Math.ceil(items.length / size) : 0 } };
}

function ownerBatteries(req: Request): ReturnType<typeof batteries> {
  return batteries(req.userRole === "ADMIN" ? undefined : actorId(req));
}

function diagnosisJson(diagnosis: NonNullable<ReturnType<typeof diagnosisById>>) {
  const battery = batteryById(diagnosis.batteryId);
  const input = diagnosis.input;
  return {
    id: diagnosis.id,
    batteryId: diagnosis.batteryId,
    batteryLabel: battery?.label,
    sessionId: diagnosis.sessionId,
    kind: diagnosis.kind,
    status: diagnosis.status,
    phase: diagnosis.phase,
    confidence: diagnosis.kind === "QUICK" ? "LOW" : diagnosis.status === "COMPLETED" ? "HIGH" : undefined,
    startedAt: diagnosis.startedAt,
    estimatedEndAt: diagnosis.estimatedEndAt,
    measuredAt: diagnosis.status === "COMPLETED" ? diagnosis.estimatedEndAt : undefined,
    loadTargetA: typeof input.loadTargetA === "number" ? input.loadTargetA : null,
    loadActualA: typeof input.loadActualA === "number" ? input.loadActualA : null,
    socHintLevel: typeof input.socHintLevel === "number" ? input.socHintLevel : null,
    abortReason: diagnosis.result && typeof diagnosis.result.abortReason === "string" ? diagnosis.result.abortReason : null,
    partialMetrics: diagnosis.result?.partialMetrics ?? null,
    result: diagnosis.result,
    quick: null,
    capacity: null
  };
}

function ensureOwner(req: Request, batteryId: string): ReturnType<typeof batteryById> | null {
  const battery = batteryById(batteryId);
  if (!battery) return null;
  if (req.userRole === "ADMIN" || battery.ownerId === actorId(req)) return battery;
  return null;
}

function errorFromDomain(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const mapping: Record<string, [number, string]> = {
    NOT_FOUND: [404, "NOT_FOUND"],
    BATTERY_BLOCKED: [409, "BATTERY_BLOCKED"],
    NO_ACTIVE_SESSION: [409, "NO_ACTIVE_SESSION"],
    NO_STATUS_CHANGE: [409, "NO_STATUS_CHANGE"],
    REASON_REQUIRED: [422, "REASON_REQUIRED"],
    INTERLOCK_LOCKED: [409, "INTERLOCK_LOCKED"],
    MODE_NOT_SUPPORTED: [409, "MODE_NOT_SUPPORTED"],
    SAFETY_PROFILE_NOT_READY: [409, "SAFETY_PROFILE_NOT_READY"],
    DIAGNOSIS_IN_PROGRESS: [409, "DIAGNOSIS_IN_PROGRESS"],
    NO_DIAGNOSIS_IN_PROGRESS: [409, "NO_DIAGNOSIS_IN_PROGRESS"],
    SELF_SUSPEND_FORBIDDEN: [409, "SELF_SUSPEND_FORBIDDEN"],
    REAUTH_REQUIRED: [401, "REAUTH_REQUIRED"],
    INPUT_TOO_LONG: [422, "INPUT_TOO_LONG"],
    VERSION_CONFLICT: [409, "VERSION_CONFLICT"],
    BATTERY_NAME_REQUIRED: [422, "BATTERY_NAME_REQUIRED"],
    CAPACITY_REQUIRED: [422, "CAPACITY_REQUIRED"],
    RATED_CURRENT_REQUIRED: [422, "RATED_CURRENT_REQUIRED"],
    IDEMPOTENCY_CONFLICT: [409, "IDEMPOTENCY_CONFLICT"]
  };
  const [status, mapped] = mapping[code] ?? [500, "INTERNAL_ERROR"];
  apiError(res, status, mapped, code);
}

function requireIdempotency(req: Request, res: Response): string | null {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key) {
    apiError(res, 400, "VALIDATION_FAILED", "Idempotency-Key is required.", { fields: [{ name: "Idempotency-Key", reason: "required" }] });
    return null;
  }
  return key;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", mode: env.DEMO_MODE ? "demo" : "database" });
});

app.post("/api/demo/login", (req, res) => {
  if (!env.DEMO_MODE) {
    apiError(res, 404, "NOT_FOUND", "Demo authentication is disabled.");
    return;
  }
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = demoUsers.find((candidate) => candidate.email === email);
  if (!user || !demoPasswordMatches(user.id, password)) {
    apiError(res, 401, "UNAUTHENTICATED", "Demo credentials are invalid.");
    return;
  }
  if (user.status !== "ACTIVE") {
    apiError(res, 403, "ACCOUNT_SUSPENDED", "The demo account is suspended.");
    return;
  }
  const token = issueDemoToken({ id: user.id, email: user.email, name: user.name, role: user.role, status: user.status });
  recordAudit({ actorId: user.id, action: "ADMIN_LOGIN", resource: "/api/demo/login", result: "SUCCESS", reason: null });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
});

app.post("/api/demo/logout", (req, res) => {
  if (!env.DEMO_MODE) {
    apiError(res, 404, "NOT_FOUND", "Demo authentication is disabled.");
    return;
  }
  const token = req.get("authorization")?.match(/^Demo\s+(.+)$/i)?.[1];
  if (!demoUserForToken(token)) {
    apiError(res, 401, "UNAUTHENTICATED", "The demo token is invalid.");
    return;
  }
  revokeDemoToken(token);
  res.status(204).send();
});

// The repository-backed demo store is intentionally explicit.  A production
// process must not silently serve fabricated telemetry or admin state.
app.use("/api", (_req, res, next) => {
  if (env.DEMO_MODE) {
    next();
    return;
  }
  apiError(res, 503, "RUNTIME_NOT_READY", "The database-backed domain provider is not enabled in this build.");
});

app.post("/api/account/email-lookup", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.normalize("NFKC").trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const user = demoUsers.find((candidate) => candidate.name === name && candidate.phone === phone);
  res.json({ email: user ? maskEmail(user.email) : null });
});

app.get("/api/me", requireSession, (req, res) => {
  const user = req.appUser;
  if (!user) {
    res.json({ user: req.authSession?.user ?? null, activeSession: null, preferences: { theme: "light", lang: "ko" } });
    return;
  }
  const storedUser = userById(user.id);
  const session = activeSession(user.id);
  const sessionBattery = session ? batteryById(session.batteryId) : null;
  const owned = batteries(user.id);
  res.json({
    user: { ...user, ...(storedUser ? { name: storedUser.name, email: storedUser.email, phone: storedUser.phone, role: storedUser.role, status: storedUser.status, joinedAt: storedUser.joinedAt } : {}), loginId: user.id },
    activeSession: session && sessionBattery ? sessionJson(session) : null,
    unreadAlertCount: 0,
    activeAnomalyCount: owned.filter((battery) => (gradeForScore(battery.latest.score) ?? "NORMAL") !== "NORMAL").length,
    preferences: demoPreferences.get(user.id) ?? { theme: "light", lang: "ko" }
  });
});

app.patch("/api/me", requireSession, (req, res) => {
  const user = userById(actorId(req));
  if (!user) { apiError(res, 404, "NOT_FOUND", "User was not found."); return; }
  const allowed = new Set(["name", "email", "phone"]);
  const unknown = Object.keys(req.body ?? {}).filter((key) => !allowed.has(key));
  if (unknown.length) { apiError(res, 400, "VALIDATION_FAILED", "Only profile fields may be changed.", { fields: unknown.map((name) => ({ name, reason: "not_allowed" })) }); return; }
  const name = req.body?.name === undefined ? user.name : typeof req.body.name === "string" ? req.body.name.normalize("NFKC").trim() : "";
  const email = req.body?.email === undefined ? user.email : typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = req.body?.phone === undefined ? user.phone : typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  if (!name || !email.includes("@") || !phone) { apiError(res, 400, "VALIDATION_FAILED", "Profile fields are invalid."); return; }
  user.name = name;
  user.email = email;
  user.phone = phone;
  recordAudit({ actorId: actorId(req), action: "USER_UPDATE", resource: user.id, result: "SUCCESS", reason: null });
  res.json({ id: user.id, name: user.name, loginId: user.id, email: user.email, phone: user.phone, role: user.role, status: user.status, joinedAt: user.joinedAt });
});

app.post("/api/me/password", requireSession, (req, res) => {
  const userId = actorId(req);
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!demoPasswordMatches(userId, currentPassword)) { apiError(res, 401, "REAUTH_REQUIRED", "Current password is invalid."); return; }
  if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(newPassword)) { apiError(res, 422, "VALIDATION_FAILED", "New password does not meet policy."); return; }
  setDemoPassword(userId, newPassword);
  res.status(204).send();
});

app.get("/api/settings/preferences", requireSession, (req, res) => {
  res.json(demoPreferences.get(actorId(req)) ?? { theme: "light", lang: "ko" });
});

app.patch("/api/settings/preferences", requireSession, (req, res) => {
  const theme = req.body?.theme;
  const lang = req.body?.lang;
  if (!["light", "dark", "system"].includes(theme) || !["ko", "en"].includes(lang)) { apiError(res, 400, "VALIDATION_FAILED", "Unsupported preferences."); return; }
  const preferences = { theme: theme as "light" | "dark" | "system", lang: lang as "ko" | "en" };
  demoPreferences.set(actorId(req), preferences);
  res.json(preferences);
});

app.get("/api/settings/alerts", requireSession, (req, res) => {
  res.json({ channels: demoAlertChannels.get(actorId(req)) ?? { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: true }, policy: { sendOn: ["DANGER", "WARNING"], smsOnlyDanger: true, dedupeWindowMinutes: 5 } });
});

app.patch("/api/settings/alerts", requireSession, (req, res) => {
  const channels = req.body?.channels;
  const keys = ["KAKAO", "EMAIL", "SMS", "WEBPUSH"] as const;
  if (!channels || keys.some((key) => typeof channels[key] !== "boolean")) { apiError(res, 400, "VALIDATION_FAILED", "All alert channels are required."); return; }
  const next = Object.fromEntries(keys.map((key) => [key, channels[key]])) as { KAKAO: boolean; EMAIL: boolean; SMS: boolean; WEBPUSH: boolean };
  demoAlertChannels.set(actorId(req), next);
  res.json({ channels: next, policy: { sendOn: ["DANGER", "WARNING"], smsOnlyDanger: true, dedupeWindowMinutes: 5 } });
});

app.get("/api/batteries", requireSession, (req, res) => {
  const mode = req.query.mode === "1" || req.query.mode === "2" ? Number(req.query.mode) : null;
  const list = batteries(req.userRole === "ADMIN" ? undefined : actorId(req)).filter((battery) => !mode || battery.targetMode === mode);
  const connectedBatteryId = activeSession(actorId(req))?.batteryId;
  res.json({ items: list.map((battery) => ({ ...batteryJson(battery), isConnected: battery.id === connectedBatteryId })), page: { number: 1, size: list.length || 20, total: list.length, totalPages: list.length ? 1 : 0 } });
});

app.post("/api/batteries", requireSession, (req, res) => {
  const targetMode = req.body?.targetMode === 1 || req.body?.targetMode === 2 ? req.body.targetMode : null;
  const chemistry = req.body?.chemistry === "LI_ION" || req.body?.chemistry === "LI_PO" ? req.body.chemistry : null;
  if (!targetMode || !chemistry) { apiError(res, 400, "VALIDATION_FAILED", "targetMode and chemistry are required."); return; }
  try {
    const battery = createBattery(actorId(req), { label: String(req.body?.label ?? ""), maker: req.body?.maker ?? null, model: req.body?.model ?? null, targetMode, chemistry, seriesCount: req.body?.seriesCount == null ? null : Number(req.body.seriesCount), capacityWh: req.body?.capacityWh == null ? null : Number(req.body.capacityWh), ratedOutputCurrentA: req.body?.ratedOutputCurrentA == null ? null : Number(req.body.ratedOutputCurrentA) });
    recordAudit({ actorId: actorId(req), action: "BATTERY_CREATE", resource: battery.id, result: "SUCCESS", reason: null });
    res.status(201).json(batteryJson(battery));
  } catch (error) { errorFromDomain(res, error); }
});

app.patch("/api/batteries/:id", requireSession, (req, res) => {
  const current = ensureOwner(req, req.params.id);
  if (!current) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  const allowed = new Set(["label", "maker", "model", "seriesCount", "memo"]);
  const unknown = Object.keys(req.body ?? {}).filter((key) => !allowed.has(key));
  if (unknown.length) { apiError(res, 400, "VALIDATION_FAILED", "Battery identity and mode cannot be changed."); return; }
  try {
    const updated = updateBattery(current.ownerId, current.id, {
      label: req.body?.label,
      maker: req.body?.maker,
      model: req.body?.model,
      seriesCount: req.body?.seriesCount == null ? req.body?.seriesCount : Number(req.body.seriesCount),
      memo: req.body?.memo
    });
    res.json(batteryJson(updated));
  } catch (error) { errorFromDomain(res, error); }
});

app.get("/api/batteries/:id", requireSession, (req, res) => {
  const battery = ensureOwner(req, req.params.id);
  if (!battery) {
    apiError(res, 404, "NOT_FOUND", "Battery was not found.");
    return;
  }
  res.json({ ...batteryJson(battery), isConnected: activeSession(actorId(req))?.batteryId === battery.id });
});

app.get("/api/batteries/:id/sessions", requireSession, (req, res) => {
  const battery = ensureOwner(req, req.params.id);
  if (!battery) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  const items = sessionsForBattery(battery.id).map((session) => ({
    id: session.id,
    label: battery.label,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    peakScore: battery.latest.score,
    peakGrade: gradeForScore(battery.latest.score),
    status: session.status
  }));
  res.json(pageEnvelope(items, Number(req.query.page) || 1, Number(req.query.size) || 20));
});

app.post("/api/sessions", requireSession, (req, res) => {
  try {
    const battery = ensureOwner(req, req.body?.batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    const session = startSession(actorId(req), battery.id);
    recordAudit({ actorId: actorId(req), action: "SESSION_START", resource: session.id, result: "SUCCESS", reason: null });
    res.status(201).json(sessionJson(session));
  } catch (error) {
    errorFromDomain(res, error);
  }
});

app.get("/api/dashboard", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const battery = session ? batteryById(session.batteryId) : null;
  if (!session || !battery) {
    apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required.");
    return;
  }
  res.json(dashboardJson(session, battery, typeof req.query.metric === "string" ? req.query.metric : "temp"));
});

app.get("/api/relay", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const requestedBatteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : null;
  const batteryId = session?.batteryId;
  if (!batteryId || (requestedBatteryId && requestedBatteryId !== batteryId) || !ensureOwner(req, batteryId)) {
    apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required.");
    return;
  }
  res.json(relayJson(batteryId));
});

async function relayMutation(req: Request, res: Response, action: "cut" | "restore"): Promise<void> {
  const key = requireIdempotency(req, res);
  if (!key) return;
  const batteryId = typeof req.body?.batteryId === "string" ? req.body.batteryId : activeSession(actorId(req))?.batteryId;
  const battery = batteryId ? ensureOwner(req, batteryId) : null;
  const session = activeSession(actorId(req));
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!battery || !session || session.batteryId !== battery.id) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  if (!reason) { apiError(res, 422, "REASON_REQUIRED", "A reason is required."); return; }
  if (!demoPasswordMatches(actorId(req), password)) { apiError(res, 401, "REAUTH_REQUIRED", "Password re-authentication is required."); return; }
  const requestBody = { batteryId, reason, password, action };
  const prior = idempotent(actorId(req), key, requestBody);
  if (prior.kind === "conflict") { apiError(res, 409, "IDEMPOTENCY_CONFLICT", "The idempotency key was reused with a different request."); return; }
  if (prior.kind === "replay") { res.status(prior.status ?? 200).json(prior.body); return; }
  try {
    const relay = changeRelay(actorId(req), battery.id, action, reason);
    const response = { decision: "APPROVED", requestId: `relay_${randomUUID()}`, relay: relayJson(battery.id) };
    rememberIdempotency(actorId(req), key, requestBody, 200, response);
    broadcast("relay.changed", relayJson(battery.id), response.requestId, battery.id);
    res.json(response);
  } catch (error) {
    errorFromDomain(res, error);
  }
}

app.post("/api/relay/cut", requireSession, async (req, res) => relayMutation(req, res, "cut"));
app.post("/api/relay/restore", requireSession, async (req, res) => relayMutation(req, res, "restore"));

function sessionBattery(req: Request): { session: NonNullable<ReturnType<typeof activeSession>>; battery: NonNullable<ReturnType<typeof batteryById>> } | null {
  const session = activeSession(actorId(req));
  const battery = session ? batteryById(session.batteryId) : undefined;
  return session && battery ? { session, battery } : null;
}

function eventItems(req: Request) {
  const owned = new Set(ownerBatteries(req).map((battery) => battery.id));
  return audits()
    .filter((audit) => ["RELAY_CUT", "RELAY_RESTORE", "RELAY_AUTO_CUT"].includes(audit.action) && owned.has(audit.resource))
    .map((audit) => {
      const battery = batteryById(audit.resource);
      const autoCut = audit.action === "RELAY_AUTO_CUT";
      return {
        id: audit.id,
        occurredAt: audit.at,
        type: autoCut ? "RELAY_AUTO_CUT" : audit.action,
        batteryId: battery?.id ?? null,
        batteryLabel: battery?.label ?? null,
        score: null,
        grade: null,
        severity: autoCut ? "CUT" : "CUT",
        source: autoCut ? "SYSTEM" : "USER",
        causeCode: autoCut ? audit.reason : undefined,
        causeParams: undefined,
        actionCode: autoCut ? "AUTO_CUT_AND_NOTIFY" : audit.action,
        actionParams: {}
      } as const;
    });
}

app.get("/api/anomaly/summary", requireSession, (req, res) => {
  const scoped = sessionBattery(req);
  if (!scoped) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  const owned = ownerBatteries(req);
  const distribution = { NORMAL: 0, CAUTION: 0, WARNING: 0, DANGER: 0 };
  for (const battery of owned) distribution[gradeForScore(battery.latest.score) ?? "NORMAL"] += 1;
  res.json({ activeCount: owned.filter((battery) => (gradeForScore(battery.latest.score) ?? "NORMAL") !== "NORMAL").length, todayCount: 0, peakScore: scoped.battery.latest.score, peakAt: scoped.battery.latest.measuredAt, model: { status: "DEGRADED", lastInferenceAt: scoped.battery.latest.measuredAt, version: "demo-fixture-no-provider" }, riskDistribution: distribution });
});

app.get("/api/anomaly/evidence", requireSession, (req, res) => {
  const scoped = sessionBattery(req);
  if (!scoped) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  if (typeof req.query.batteryId === "string" && req.query.batteryId !== scoped.battery.id) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  res.json({ batteryId: scoped.battery.id, score: scoped.battery.latest.score, evaluatedAt: scoped.battery.latest.measuredAt, contributions: [] });
});

app.get("/api/anomaly/events", requireSession, (req, res) => {
  const scoped = sessionBattery(req);
  if (!scoped) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  res.json(pageEnvelope(eventItems(req), Number(req.query.page) || 1, Number(req.query.size) || 20));
});

app.get("/api/events", requireSession, (req, res) => {
  const severity = typeof req.query.severity === "string" ? req.query.severity.split(",") : [];
  const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
  const batteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : null;
  const items = eventItems(req).filter((event) => (!severity.length || severity.includes(event.severity)) && (!batteryId || event.batteryId === batteryId) && (!q || (event.batteryLabel ?? "").toLowerCase().includes(q)));
  res.json(pageEnvelope(items, Number(req.query.page) || 1, Number(req.query.size) || 20));
});

function trendForBattery(battery: NonNullable<ReturnType<typeof batteryById>>, period: "24h" | "7d" | "30d") {
  const count = period === "24h" ? 25 : period === "30d" ? 30 : 7;
  const stepMs = period === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const end = new Date(battery.latest.measuredAt).getTime();
  const buckets = Array.from({ length: count }, (_, index) => new Date(end - (count - index - 1) * stepMs).toISOString());
  const point = (value: number | null) => [...Array<number | null>(count - 1).fill(null), value];
  return { buckets, series: [
    { batteryId: battery.id, batteryLabel: battery.label, metric: "volt", unit: "V", points: point(battery.latest.voltageV) },
    { batteryId: battery.id, batteryLabel: battery.label, metric: "curr", unit: "A", points: point(battery.latest.currentA) },
    { batteryId: battery.id, batteryLabel: battery.label, metric: "temp", unit: "°C", points: point(Math.max(battery.latest.tempContact ?? -Infinity, battery.latest.tempIrSurface ?? -Infinity) === -Infinity ? null : Math.max(battery.latest.tempContact ?? -Infinity, battery.latest.tempIrSurface ?? -Infinity)) },
    { batteryId: battery.id, batteryLabel: battery.label, metric: "soc", unit: "%", points: point(battery.targetMode === 2 ? null : battery.latest.socPct) }
  ] };
}

app.get("/api/trends", requireSession, (req, res) => {
  const period = req.query.period === "24h" || req.query.period === "30d" ? req.query.period : "7d";
  const requested = typeof req.query.batteryIds === "string" ? req.query.batteryIds.split(",").filter(Boolean).slice(0, 5) : [];
  const candidates = requested.length ? requested.map((id) => ensureOwner(req, id)).filter((battery): battery is NonNullable<ReturnType<typeof batteryById>> => Boolean(battery)) : (() => { const scoped = sessionBattery(req); return scoped ? [scoped.battery] : []; })();
  if (requested.length && candidates.length !== requested.length) { apiError(res, 404, "NOT_FOUND", "One or more batteries were not found."); return; }
  const first = candidates[0];
  if (!first) { res.json({ period, buckets: [], series: [] }); return; }
  const base = trendForBattery(first, period);
  const series = candidates.flatMap((battery) => trendForBattery(battery, period).series);
  res.json({ period, buckets: base.buckets, series });
});

const demoAlerts: Array<Record<string, unknown>> = [];
app.get("/api/alerts/summary", requireSession, (_req, res) => {
  res.json({ unacknowledgedCount: demoAlerts.filter((alert) => alert.severity === "DANGER" && alert.acknowledgedAt === null).length, today: { DANGER: 0, WARNING: 0, NORMAL_OR_CHECK: 0 } });
});

app.get("/api/alerts", requireSession, (_req, res) => {
  res.json(pageEnvelope(demoAlerts, Number(_req.query.page) || 1, Number(_req.query.size) || 20));
});

app.post("/api/alerts/ack-all", requireSession, (_req, res) => {
  let acknowledgedCount = 0;
  for (const alert of demoAlerts) {
    if (alert.severity === "DANGER" && alert.acknowledgedAt === null) { alert.acknowledgedAt = new Date().toISOString(); acknowledgedCount += 1; }
  }
  res.json({ acknowledgedCount });
});

app.post("/api/alerts/:id/ack", requireSession, (req, res) => {
  const alert = demoAlerts.find((item) => item.id === req.params.id);
  if (!alert) { apiError(res, 404, "NOT_FOUND", "Alert was not found."); return; }
  alert.acknowledgedAt = alert.acknowledgedAt ?? new Date().toISOString();
  res.json(alert);
});

app.get("/api/notices", requireSession, (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const items = demoNotices.filter((notice) => !category || notice.category === category).map(({ body: _body, status: _status, views: _views, ...notice }) => notice);
  res.json(pageEnvelope(items, Number(req.query.page) || 1, Number(req.query.size) || 20));
});

app.get("/api/notices/:id", requireSession, (req, res) => {
  const notice = demoNotices.find((item) => item.id === req.params.id);
  if (!notice) { apiError(res, 404, "NOT_FOUND", "Notice was not found."); return; }
  res.json({ id: notice.id, category: notice.category, title: notice.title, body: notice.body, publishedAt: notice.publishedAt });
});

app.get("/api/admin/event-trend", requireRole("ADMIN"), (_req, res) => {
  res.json({ buckets: ["월", "화", "수", "목", "금", "토", "일"], series: [{ grade: "CAUTION", values: [0, 0, 0, 0, 0, 0, 0] }, { grade: "WARNING", values: [0, 0, 0, 0, 0, 0, 0] }, { grade: "DANGER", values: [0, 0, 0, 0, 0, 0, 0] }] });
});

app.get("/api/admin/notices", requireRole("ADMIN"), (_req, res) => {
  res.json({ items: demoNotices.map(({ id, category, title, status, views, publishedAt }) => ({ id, category, title, status, views, publishedAt })) });
});

app.get("/api/admin/users", requireRole("ADMIN"), (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
  const status = req.query.status === "ACTIVE" || req.query.status === "SUSPENDED" ? req.query.status : null;
  const role = req.query.role === "USER" || req.query.role === "ADMIN" ? req.query.role : null;
  const items = demoUsers.filter((user) => (!status || user.status === status) && (!role || user.role === role) && (!q || `${user.name} ${user.email}`.toLowerCase().includes(q))).map((user) => ({ ...user, loginId: user.id, batteryCount: batteries(user.id).length }));
  res.json({ items, page: { number: 1, size: items.length || 20, total: items.length, totalPages: items.length ? 1 : 0 } });
});

app.get("/api/admin/users/:id", requireRole("ADMIN"), (req, res) => {
  const user = userById(req.params.id);
  if (!user) { apiError(res, 404, "NOT_FOUND", "User was not found."); return; }
  res.json({ ...user, loginId: user.id, batteryCount: batteries(user.id).length });
});

async function userStatusMutation(req: Request, res: Response, status: "ACTIVE" | "SUSPENDED"): Promise<void> {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  try {
    const user = changeUserStatus(actorId(req), req.params.id, status, reason);
    res.json(user);
  } catch (error) {
    errorFromDomain(res, error);
  }
}

app.post("/api/admin/users/:id/suspend", requireRole("ADMIN"), async (req, res) => userStatusMutation(req, res, "SUSPENDED"));
app.post("/api/admin/users/:id/restore", requireRole("ADMIN"), async (req, res) => userStatusMutation(req, res, "ACTIVE"));
app.patch("/api/admin/users/:id", requireRole("ADMIN"), async (req, res) => {
  const status = req.body?.status === "SUSPENDED" ? "SUSPENDED" : req.body?.status === "ACTIVE" ? "ACTIVE" : null;
  if (!status) { apiError(res, 400, "VALIDATION_FAILED", "status must be ACTIVE or SUSPENDED."); return; }
  await userStatusMutation(req, res, status);
});
app.post("/api/admin/users/:id/password-reset", requireRole("ADMIN"), (req, res) => {
  if (!userById(req.params.id)) { apiError(res, 404, "NOT_FOUND", "User was not found."); return; }
  recordAudit({ actorId: actorId(req), action: "USER_PASSWORD_RESET_REQUEST", resource: req.params.id, result: "SUCCESS", reason: null });
  res.status(202).json({ status: "accepted", userId: req.params.id });
});

app.get("/api/admin/batteries", requireRole("ADMIN"), (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
  const status = typeof req.query.opsStatus === "string" ? req.query.opsStatus : null;
  const items = batteries().filter((battery) => (!status || battery.opsStatus === status) && (!q || `${battery.id} ${battery.label} ${battery.ownerId}`.toLowerCase().includes(q))).map((battery) => ({ ...batteryJson(battery), owner: userById(battery.ownerId) }));
  res.json({ items, page: { number: 1, size: items.length || 20, total: items.length, totalPages: items.length ? 1 : 0 } });
});

app.get("/api/admin/batteries/:id", requireRole("ADMIN"), (req, res) => {
  const battery = batteryById(req.params.id);
  if (!battery) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  res.json({ ...batteryJson(battery), owner: userById(battery.ownerId), info: { adminMemo: battery.adminMemo, device: { id: "demo-device-01", label: "진단기 A", status: "ONLINE" } }, opsLogs: audits().filter((audit) => audit.resource === battery.id) });
});

app.patch("/api/admin/batteries/:id/ops-status", requireRole("ADMIN"), (req, res) => {
  const next = req.body?.opsStatus;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  if (!["NORMAL", "WATCH", "BLOCKED"].includes(next)) { apiError(res, 400, "VALIDATION_FAILED", "Invalid ops status."); return; }
  try {
    const version = Number.isInteger(req.body?.version) ? req.body.version : undefined;
    const battery = changeOpsStatus(actorId(req), req.params.id, next as "NORMAL" | "WATCH" | "BLOCKED", reason, version);
    res.json({ opsStatus: battery.opsStatus, version: battery.version, updatedAt: battery.latest.measuredAt, updatedBy: actorName(req) });
  } catch (error) { errorFromDomain(res, error); }
});

app.patch("/api/admin/batteries/:id/memo", requireRole("ADMIN"), (req, res) => {
  if (typeof req.body?.memo !== "string") { apiError(res, 400, "VALIDATION_FAILED", "Memo must be a string."); return; }
  try {
    const version = Number.isInteger(req.body?.version) ? req.body.version : undefined;
    const battery = saveMemo(actorId(req), req.params.id, req.body.memo, version);
    res.json({ memo: battery.adminMemo, version: battery.version, updatedAt: battery.latest.measuredAt, updatedBy: actorName(req) });
  } catch (error) { errorFromDomain(res, error); }
});

app.get("/api/admin/audit-logs", requireRole("ADMIN"), (_req, res) => {
  res.json({ items: audits(), page: { number: 1, size: 100, total: audits().length, totalPages: 1 } });
});

app.get("/api/admin/health", requireRole("ADMIN"), (req, res) => {
  recordAudit({ actorId: actorId(req), action: "ADMIN_ACCESS", resource: "/api/admin/health", result: "SUCCESS", reason: null });
  res.json({ status: "ok", scope: "admin", runtime: "demo", safetyProfile: F21_THRESHOLDS });
});

app.get("/api/admin/overview", requireRole("ADMIN"), (_req, res) => {
  const allBatteries = batteries();
  res.json({ users: demoUsers.length, batteries: allBatteries.length, activeSessions: activeSession() ? 1 : 0, blockedBatteries: allBatteries.filter((item) => item.opsStatus === "BLOCKED").length, relayOpen: allBatteries.filter((item) => relayByBattery(item.id).state === "OPEN").length });
});

app.get("/api/relay/history", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const requestedBatteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : null;
  const batteryId = session?.batteryId;
  if (!batteryId || (requestedBatteryId && requestedBatteryId !== batteryId) || !ensureOwner(req, batteryId)) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  res.json({ items: audits().filter((audit) => audit.resource === batteryId && audit.action.startsWith("RELAY_")).map((audit) => ({
    id: audit.id,
    action: audit.action,
    at: audit.at,
    actor: audit.actorId && userById(audit.actorId) ? { type: "USER", id: audit.actorId, name: userById(audit.actorId)!.name } : { type: "SYSTEM", systemCode: "FAILSAFE" },
    ...(audit.action === "RELAY_AUTO_CUT" ? { reasonCode: audit.reason ?? undefined } : { reason: audit.reason ?? undefined })
  })) });
});

function diagnosisStart(req: Request, res: Response, kind: "QUICK" | "CAPACITY"): void {
  const session = activeSession(actorId(req));
  const batteryId = session?.batteryId;
  if (!batteryId) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  const body = req.body ?? {};
  if (body.acknowledged !== true) { apiError(res, 400, "ACK_REQUIRED", "Safety acknowledgement is required."); return; }
  if (kind === "CAPACITY" && body.fullyChargedConfirmed !== true) { apiError(res, 400, "FULL_CHARGE_REQUIRED", "Full-charge confirmation is required."); return; }
  try {
    const diagnosis = startDiagnosis(actorId(req), kind, batteryId, body);
    recordAudit({ actorId: actorId(req), action: kind === "QUICK" ? "DIAGNOSIS_QUICK_START" : "DIAGNOSIS_CAPACITY_START", resource: diagnosis.id, result: "SUCCESS", reason: null });
    res.status(202).json(diagnosisJson(diagnosis));
  } catch (error) { errorFromDomain(res, error); }
}

app.post("/api/diagnosis/quick", requireSession, (req, res) => diagnosisStart(req, res, "QUICK"));
app.post("/api/diagnosis/capacity", requireSession, (req, res) => diagnosisStart(req, res, "CAPACITY"));
app.get("/api/diagnosis/active", requireSession, (req, res) => {
  const diagnosis = activeDiagnosis(activeSession(actorId(req))?.batteryId ?? undefined);
  res.json(diagnosis ? diagnosisJson(diagnosis) : null);
});
app.delete("/api/diagnosis/active", requireSession, (req, res) => {
  const batteryId = activeSession(actorId(req))?.batteryId;
  if (!batteryId) { apiError(res, 409, "NO_DIAGNOSIS_IN_PROGRESS", "No active diagnosis exists."); return; }
  try {
    const diagnosis = abortDiagnosis(actorId(req), batteryId);
    recordAudit({ actorId: actorId(req), action: "DIAGNOSIS_ABORT", resource: diagnosis.id, result: "SUCCESS", reason: "USER" });
    res.json(diagnosisJson(diagnosis));
  } catch (error) { errorFromDomain(res, error); }
});

app.get("/api/batteries/:id/diagnoses", requireSession, (req, res) => {
  const battery = ensureOwner(req, req.params.id);
  if (!battery) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  const items = diagnosesForBattery(battery.id).map(diagnosisJson).map((diagnosis) => ({
    id: diagnosis.id,
    batteryId: diagnosis.batteryId,
    batteryLabel: diagnosis.batteryLabel,
    kind: diagnosis.kind,
    status: diagnosis.status,
    confidence: diagnosis.confidence,
    measuredAt: diagnosis.measuredAt,
    socHintLevel: diagnosis.socHintLevel,
    summary: diagnosis.kind === "QUICK" ? { regulationKneeA: null, thermalSlopeCPerMin: null, grade: null } : { sohRelPct: null, deliveredWh: null }
  }));
  res.json(pageEnvelope(items, Number(req.query.page) || 1, Number(req.query.size) || 20));
});

app.get("/api/diagnoses/:id", requireSession, (req, res) => {
  const diagnosis = diagnosisById(req.params.id);
  if (!diagnosis || !ensureOwner(req, diagnosis.batteryId)) { apiError(res, 404, "NOT_FOUND", "Diagnosis was not found."); return; }
  res.json(diagnosisJson(diagnosis));
});

app.get("/api/metrics/export.csv", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const requestedBatteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : null;
  const batteryId = session?.batteryId;
  if (!batteryId || (requestedBatteryId && requestedBatteryId !== batteryId) || !ensureOwner(req, batteryId)) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  const csv = csvForBattery(batteryId, session?.id ?? null);
  res.status(200).type("text/csv").setHeader("Content-Disposition", `attachment; filename="${batteryId}-raw.csv"`).send(csv);
});

app.get("/api/trends/export.pdf", requireSession, (_req, res) => {
  apiError(res, 503, "RUNTIME_NOT_READY", "PDF trend export is unavailable until the aggregate export provider is implemented.");
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  apiError(res, 500, "INTERNAL_ERROR", "An internal error occurred.");
});

function wsFrame(text: string, opcode = 0x81): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([opcode, payload.length]), payload]);
  if (payload.length < 65536) return Buffer.concat([Buffer.from([opcode, 126, (payload.length >> 8) & 255, payload.length & 255]), payload]);
  throw new Error("WebSocket payload is too large");
}

function parseClientFrame(input: Buffer): { opcode: number; payload: Buffer } | null {
  if (input.length < 2) return null;
  const opcode = input[0] & 0x0f;
  const masked = (input[1] & 0x80) !== 0;
  let length = input[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (input.length < 4) return null;
    length = input.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    return null;
  }
  if (!masked || input.length < offset + 4 + length) return null;
  const mask = input.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(input.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode, payload };
}

function topicForType(type: string): WsTopic {
  if (type.startsWith("metrics")) return "metrics";
  if (type.startsWith("anomaly")) return "anomaly";
  if (type.startsWith("relay")) return "relay";
  if (type.startsWith("alert")) return "alert";
  if (type.startsWith("session")) return "session";
  if (type.startsWith("diagnosis")) return "diagnosis";
  return "event";
}

function wsEnvelope(type: string, payload: unknown, requestId: string | null = null) {
  const sequence = String(++wsSequence);
  return {
    v: 1,
    type,
    topic: topicForType(type),
    eventId: `evt_${sequence}`,
    streamId: wsStreamId,
    sequence,
    cursor: sequence,
    at: new Date().toISOString(),
    sessionId: null,
    requestId,
    payload
  };
}

function broadcast(type: string, payload: unknown, requestId: string | null = null, batteryId: string | null = null): void {
  const envelope = wsEnvelope(type, payload, requestId);
  const topic = topicForType(type);
  eventLog.record({ sequence: BigInt(envelope.sequence), topic, batteryId, envelope });
  const frame = wsFrame(JSON.stringify(envelope));
  const active = batteryId ? activeSession() : null;
  for (const client of wsClients) {
    const canReceive = Boolean(batteryId && active && active.batteryId === batteryId && active.ownerId === client.userId && client.batteryId === batteryId);
    if (client.subscribed && client.topics.has(topic) && canReceive && !client.socket.destroyed) client.socket.write(frame);
  }
}

function closeUnauthenticated(socket: Socket, code: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clientControlMessage(value: unknown): { type: "subscribe" | "resume" | "ping"; requestId: string | null; topics: WsTopic[]; afterCursor: string | null } | null {
  if (!isRecord(value) || value.v !== 1 || (value.type !== "subscribe" && value.type !== "resume" && value.type !== "ping") || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (value.type === "ping") return Object.keys(payload).length === 0 ? { type: "ping", requestId: null, topics: [], afterCursor: null } : null;
  const topics = payload.topics;
  if (!Array.isArray(topics) || topics.length === 0 || topics.some((topic) => typeof topic !== "string" || !["metrics", "anomaly", "relay", "alert", "event", "session", "diagnosis"].includes(topic))) return null;
  if (typeof payload.requestId !== "string" || payload.requestId.length === 0 || typeof payload.afterCursor !== "string") return null;
  if (value.type === "resume" && payload.lastEventId !== undefined && typeof payload.lastEventId !== "string") return null;
  return { type: value.type, requestId: payload.requestId, topics: [...new Set(topics)] as WsTopic[], afterCursor: payload.afterCursor };
}

httpServer.on("upgrade", async (req: IncomingMessage, socket: Socket) => {
  const key = req.headers["sec-websocket-key"];
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!key || (url.pathname !== "/ws/telemetry" && url.pathname !== "/ws")) {
    socket.destroy();
    return;
  }
  let userId: string;
  let role: "USER" | "ADMIN";
  if (env.DEMO_MODE) {
    const demoUser = demoUserForToken(url.searchParams.get("access_token"));
    if (!demoUser || demoUser.status === "SUSPENDED") { closeUnauthenticated(socket, demoUser ? 403 : 401, demoUser ? "Forbidden" : "Unauthorized"); return; }
    userId = demoUser.id;
    role = demoUser.role;
  } else {
    // Production WebSockets use the Better Auth session cookie. A demo query
    // token is never accepted outside the explicit demo runtime.
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) { closeUnauthenticated(socket, 401, "Unauthorized"); return; }
      // The domain provider is intentionally unavailable while DEMO_MODE is
      // false, so do not expose a fabricated stream in this fail-closed mode.
      socket.destroy();
      return;
    } catch {
      socket.destroy();
      return;
    }
  }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client: WsClient = { socket, batteryId: activeSession(userId)?.batteryId ?? null, userId, role, topics: new Set<WsTopic>(), subscribed: false };
  wsClients.add(client);
  socket.write(wsFrame(JSON.stringify(wsEnvelope("sync", { snapshotCursor: "0", asOf: new Date().toISOString() }))));
  socket.on("data", (chunk) => {
    const frame = parseClientFrame(Buffer.from(chunk));
    if (!frame) return;
    if (frame.opcode === 0x8) { socket.end(); return; }
    if (frame.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0])); return; }
    if (frame.opcode !== 0x1) return;
    try {
      const message = clientControlMessage(JSON.parse(frame.payload.toString()) as unknown);
      if (!message) { socket.destroy(); return; }
      if (message.type === "subscribe" || message.type === "resume") {
        if (!client.batteryId) { socket.destroy(); return; }
        const replay = eventLog.replay(message.afterCursor ?? "0");
        if (replay.expired) {
          socket.write(wsFrame(JSON.stringify(wsEnvelope("resync.required", { requestId: message.requestId, reason: "CURSOR_EXPIRED", latestCursor: String(wsSequence) }, message.requestId))));
          return;
        }
        client.topics = new Set(message.topics);
        client.subscribed = true;
        for (const stored of replay.events) {
          if (!client.topics.has(stored.topic)) continue;
          if (stored.batteryId && stored.batteryId !== client.batteryId) continue;
          socket.write(wsFrame(JSON.stringify(stored.envelope)));
        }
        socket.write(wsFrame(JSON.stringify(wsEnvelope(message.type === "subscribe" ? "subscribed" : "resumed", {
          requestId: message.requestId,
          streamId: wsStreamId,
          replayFrom: message.afterCursor,
          currentCursor: String(wsSequence)
        }, message.requestId))));
      } else if (message.type === "ping") {
        socket.write(wsFrame(JSON.stringify(wsEnvelope("pong", {}, null))));
      }
    } catch (_) {
      socket.destroy();
    }
  });
  socket.on("close", () => wsClients.delete(client));
  socket.on("error", () => wsClients.delete(client));
});

const lastBroadcastGrade = new Map<string, Grade>();

function tickActiveBattery(): void {
  const session = activeSession();
  if (!session) return;
  const battery = batteryById(session.batteryId);
  if (!battery) return;
  broadcast("metrics.tick", dashboardMetrics(battery), null, battery.id);
  const anomaly = anomalyJson(battery);
  broadcast("anomaly.score", anomaly, null, battery.id);
  const previousGrade = lastBroadcastGrade.get(battery.id) ?? null;
  const nextGrade = anomaly.grade;
  if (nextGrade) lastBroadcastGrade.set(battery.id, nextGrade);
  const transition = detectGradeTransition(previousGrade, nextGrade);
  if (!transition) return;
  broadcast("anomaly.gradeChanged", { from: transition.from, to: transition.to, score: anomaly.score, batteryId: battery.id, batteryLabel: battery.label }, null, battery.id);
  if (transition.to !== "WARNING" && transition.to !== "DANGER") return;
  const alert = {
    id: `al_${randomUUID()}`,
    severity: transition.to,
    titleCode: "ANOMALY_GRADE_ESCALATED",
    params: { score: anomaly.score, from: transition.from, to: transition.to },
    batteryId: battery.id,
    batteryLabel: battery.label,
    subjectType: "BATTERY" as const,
    occurredAt: new Date().toISOString(),
    acknowledgedAt: null as string | null,
    channels: channelsForAlert(battery.ownerId, transition.to)
  };
  demoAlerts.unshift(alert);
  broadcast("alert.created", alert, null, battery.id);
}

setInterval(tickActiveBattery, 1000);

httpServer.listen(env.PORT, () => {
  console.log(`CellGuard backend listening on ${env.PORT} (${env.DEMO_MODE ? "demo" : "database"})`);
});
