import { createServer, type IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { corsOrigins, env } from "./config/env.js";
import { requireRole, requireSession } from "./auth/middleware.js";
import { writeAuditLog } from "./auth/audit.js";
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
  demoUsers,
  idempotent,
  mode1Health,
  recordAudit,
  relayByBattery,
  rememberIdempotency,
  saveMemo,
  startDiagnosis,
  startSession,
  userById
} from "./store.js";

const app = express();
const httpServer = createServer(app);
const wsClients = new Set<{ socket: Socket; batteryId: string | null }>();
let wsSequence = 0;
const wsStreamId = "demo-stream";

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
      measuredAt: battery.latest.measuredAt
    },
    health: mode1Health(battery),
    diagnosisCapability: battery.targetMode === 2
      ? { executionAllowed: false, reasonCode: "SAFETY_PROFILE_NOT_READY" }
      : { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" }
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
  const role = req.body?.role === "ADMIN" ? "ADMIN" : "USER";
  const expectedEmail = role === "ADMIN" ? "lee@lab.io" : "hong@cellguard.io";
  if (email !== expectedEmail || !password) {
    apiError(res, 401, "UNAUTHENTICATED", "Demo credentials are invalid.");
    return;
  }
  const user = role === "ADMIN" ? userById("leelab")! : userById("hong")!;
  const token = role === "ADMIN" ? "demo-admin" : "demo-user";
  recordAudit({ actorId: user.id, action: "ADMIN_LOGIN", resource: "/api/demo/login", result: "SUCCESS", reason: null });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
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

app.get("/api/me", requireSession, (req, res) => {
  const user = req.appUser;
  if (!user) {
    res.json({ user: req.authSession?.user ?? null, activeSession: null, preferences: { theme: "light", lang: "ko" } });
    return;
  }
  const session = activeSession(user.id);
  const sessionBattery = session ? batteryById(session.batteryId) : null;
  res.json({
    user: { ...user, loginId: user.id, phone: user.id === "hong" ? "010-1234-5678" : "010-3456-7890" },
    activeSession: session && sessionBattery ? { ...session, batteryLabel: sessionBattery.label } : null,
    unreadAlertCount: 0,
    activeAnomalyCount: 0,
    preferences: { theme: "light", lang: "ko" }
  });
});

app.get("/api/batteries", requireSession, (req, res) => {
  const mode = req.query.mode === "1" || req.query.mode === "2" ? Number(req.query.mode) : null;
  const list = batteries(req.userRole === "ADMIN" ? undefined : actorId(req)).filter((battery) => !mode || battery.targetMode === mode);
  res.json({ items: list.map((battery) => batteryJson(battery)), page: { number: 1, size: list.length || 20, total: list.length, totalPages: list.length ? 1 : 0 } });
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

app.get("/api/batteries/:id", requireSession, (req, res) => {
  const battery = ensureOwner(req, req.params.id);
  if (!battery) {
    apiError(res, 404, "NOT_FOUND", "Battery was not found.");
    return;
  }
  res.json(batteryJson(battery));
});

app.post("/api/sessions", requireSession, (req, res) => {
  try {
    const battery = ensureOwner(req, req.body?.batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    const session = startSession(actorId(req), battery.id);
    recordAudit({ actorId: actorId(req), action: "SESSION_START", resource: session.id, result: "SUCCESS", reason: null });
    res.status(201).json({ ...session, batteryLabel: battery.label });
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
  const payload = batteryJson(battery);
  res.json({ session, battery: payload, metrics: payload?.latest ?? null, snapshotCursor: `${Date.now()}` });
});

app.get("/api/relay", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const batteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : session?.batteryId;
  if (!batteryId || !ensureOwner(req, batteryId)) {
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
  if (!password) { apiError(res, 401, "REAUTH_REQUIRED", "Password re-authentication is required."); return; }
  const requestBody = { batteryId, reason, password, action };
  const prior = idempotent(actorId(req), key, requestBody);
  if (prior.kind === "conflict") { apiError(res, 409, "IDEMPOTENCY_CONFLICT", "The idempotency key was reused with a different request."); return; }
  if (prior.kind === "replay") { res.status(prior.status ?? 200).json(prior.body); return; }
  try {
    const relay = changeRelay(actorId(req), battery.id, action, reason);
    const response = { decision: "APPROVED", requestId: `relay_${randomUUID()}`, relay: relayJson(battery.id) };
    rememberIdempotency(actorId(req), key, requestBody, 200, response);
    broadcast("relay.changed", relayJson(battery.id), response.requestId);
    res.json(response);
  } catch (error) {
    errorFromDomain(res, error);
  }
}

app.post("/api/relay/cut", requireSession, async (req, res) => relayMutation(req, res, "cut"));
app.post("/api/relay/restore", requireSession, async (req, res) => relayMutation(req, res, "restore"));

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
  const batteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : activeSession(actorId(req))?.batteryId;
  if (!batteryId || !ensureOwner(req, batteryId)) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  res.json({ items: audits().filter((audit) => audit.resource === batteryId && audit.action.startsWith("RELAY_")) });
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
    res.status(202).json(diagnosis);
  } catch (error) { errorFromDomain(res, error); }
}

app.post("/api/diagnosis/quick", requireSession, (req, res) => diagnosisStart(req, res, "QUICK"));
app.post("/api/diagnosis/capacity", requireSession, (req, res) => diagnosisStart(req, res, "CAPACITY"));
app.get("/api/diagnosis/active", requireSession, (req, res) => res.json(activeDiagnosis(activeSession(actorId(req))?.batteryId ?? undefined)));
app.delete("/api/diagnosis/active", requireSession, (req, res) => {
  const batteryId = activeSession(actorId(req))?.batteryId;
  if (!batteryId) { apiError(res, 409, "NO_DIAGNOSIS_IN_PROGRESS", "No active diagnosis exists."); return; }
  try {
    const diagnosis = abortDiagnosis(actorId(req), batteryId);
    recordAudit({ actorId: actorId(req), action: "DIAGNOSIS_ABORT", resource: diagnosis.id, result: "SUCCESS", reason: "USER" });
    res.json(diagnosis);
  } catch (error) { errorFromDomain(res, error); }
});

app.get("/api/batteries/:id/diagnoses", requireSession, (req, res) => {
  const battery = ensureOwner(req, req.params.id);
  if (!battery) { apiError(res, 404, "NOT_FOUND", "Battery was not found."); return; }
  const current = activeDiagnosis(battery.id);
  res.json({ items: current ? [current] : [], page: { number: 1, size: current ? 1 : 20, total: current ? 1 : 0, totalPages: current ? 1 : 0 } });
});

app.get("/api/metrics/export.csv", requireSession, (req, res) => {
  const session = activeSession(actorId(req));
  const batteryId = typeof req.query.batteryId === "string" ? req.query.batteryId : session?.batteryId;
  if (!batteryId || !ensureOwner(req, batteryId)) { apiError(res, 409, "NO_ACTIVE_SESSION", "An active session is required."); return; }
  const csv = csvForBattery(batteryId, session?.id ?? null);
  res.status(200).type("text/csv").setHeader("Content-Disposition", `attachment; filename="${batteryId}-raw.csv"`).send(csv);
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

function wsEnvelope(type: string, payload: unknown, requestId: string | null = null) {
  const sequence = String(++wsSequence);
  return {
    v: 1,
    type,
    topic: type.startsWith("metrics") ? "metrics" : "events",
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

function broadcast(type: string, payload: unknown, requestId: string | null = null): void {
  const frame = wsFrame(JSON.stringify(wsEnvelope(type, payload, requestId)));
  for (const client of wsClients) {
    if (!client.socket.destroyed) client.socket.write(frame);
  }
}

httpServer.on("upgrade", (req: IncomingMessage, socket: Socket) => {
  const key = req.headers["sec-websocket-key"];
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!key || (url.pathname !== "/ws/telemetry" && url.pathname !== "/ws")) {
    socket.destroy();
    return;
  }
  if (env.DEMO_MODE && !["demo-user", "demo-admin"].includes(url.searchParams.get("access_token") ?? "")) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { socket, batteryId: url.searchParams.get("batteryId") };
  wsClients.add(client);
  socket.write(wsFrame(JSON.stringify(wsEnvelope("sync", { snapshotCursor: "0", asOf: new Date().toISOString() }))));
  socket.on("data", (chunk) => {
    const frame = parseClientFrame(Buffer.from(chunk));
    if (!frame) return;
    if (frame.opcode === 0x8) { socket.end(); return; }
    if (frame.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0])); return; }
    if (frame.opcode !== 0x1) return;
    try {
      const message = JSON.parse(frame.payload.toString()) as { type?: string; requestId?: string; afterCursor?: string };
      if (message.type === "subscribe" || message.type === "resume") {
        socket.write(wsFrame(JSON.stringify(wsEnvelope(message.type === "subscribe" ? "subscribed" : "resumed", {
          requestId: message.requestId ?? null,
          streamId: wsStreamId,
          replayFrom: message.afterCursor ?? "0",
          currentCursor: String(wsSequence)
        }, message.requestId ?? null))));
      } else if (message.type === "ping") {
        socket.write(wsFrame(JSON.stringify(wsEnvelope("pong", {}, message.requestId ?? null))));
      }
    } catch (_) {
      socket.destroy();
    }
  });
  socket.on("close", () => wsClients.delete(client));
  socket.on("error", () => wsClients.delete(client));
});

httpServer.listen(env.PORT, () => {
  console.log(`CellGuard backend listening on ${env.PORT} (${env.DEMO_MODE ? "demo" : "database"})`);
});
