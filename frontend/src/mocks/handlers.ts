import { http, HttpResponse } from "msw";
import type { AdminBatteryDetail, AdminBatteryListItem, AlertChannels, AlertSettings, Battery, Diagnosis, DiagnosisListItem, Grade, MeResponse, Relay } from "../types";

const now = () => new Date().toISOString();
const randomId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function normalizeAdminInput(value: unknown, maxLength: number, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new Error("VALIDATION_FAILED");
  const normalized = value.normalize("NFKC").trim();
  if (!allowEmpty && !normalized) throw new Error("REASON_REQUIRED");
  if (normalized.length > maxLength) throw new Error("INPUT_TOO_LONG");
  return normalized;
}
const grade = (score: number): Grade => score < .3 ? "NORMAL" : score < .6 ? "CAUTION" : score < .8 ? "WARNING" : "DANGER";
const baseMetric = (score: number, temp: number, soc: number | null) => ({ voltageV: 11.9, currentA: -2.4, powerW: -28.56, representativeTempC: temp, representativeTempSource: "CONTACT" as const, tempContact: temp, tempIrSurface: temp - 1.6, socPct: soc, socBasis: "ABSOLUTE_GAUGE" as const, score, grade: grade(score), measuredAt: now() });
const metricStatus = (value: number | null) => value == null ? null : value >= 60 ? "CRIT" : value >= 55 ? "WARN" : "OK";
const batteries: Battery[] = [
  { id: "b_pack_001", label: "PACK-001", chemistry: "LI_ION", seriesCount: 3, maker: "Samsung SDI", model: "18650", targetMode: 1, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: { ...baseMetric(.18, 31.2, 78) }, health: { source: "BACKEND_BQ27441_AGGREGATE", sohPct: 92, rulCycles: 480, cycleCount: 312, internalResistanceMohm: 18.4 }, diagnosisCapability: { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" } },
  { id: "b_pack_002", label: "PACK-002", chemistry: "LI_PO", seriesCount: null, maker: null, model: "37Wh USB", targetMode: 2, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "WATCH", latest: { ...baseMetric(.58, 47, null), voltageV: 5.1, currentA: -1.2, powerW: -6.12, representativeTempSource: "IR_SURFACE", tempContact: null, tempIrSurface: 47, socBasis: null }, health: null, diagnosisCapability: { executionAllowed: true, reasonCode: null } },
  { id: "b_pack_003", label: "PACK-003", chemistry: "LI_ION", seriesCount: 3, maker: "CellGuard Lab", model: "3S bench pack", targetMode: 1, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: null, health: null, diagnosisCapability: { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" } },
  { id: "b_pack_004", label: "PACK-004", chemistry: "LI_PO", seriesCount: null, maker: "CellGuard Lab", model: "Validated Mode 2", targetMode: 2, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { ...baseMetric(.24, 42, null), voltageV: 5.05, currentA: -1, powerW: -5.05, representativeTempSource: "IR_SURFACE", tempContact: null, tempIrSurface: 42, socBasis: "RELATIVE_SESSION_START" }, health: null, diagnosisCapability: { executionAllowed: true, reasonCode: null } },
];
batteries[0].adminMemo = "기존 관리자 메모";
batteries.forEach((battery) => { battery.adminMemo ??= ""; });
const demoUser: NonNullable<MeResponse["user"]> = { id: "u_hong", loginId: "hong", name: "홍길동", email: "hong@cellguard.io", phone: "010-1234-5678", role: "USER", status: "ACTIVE" };
let currentUser: MeResponse["user"] = null;
let session: MeResponse["activeSession"] = null;
let currentPassword = "demo-password";
let alertChannels: AlertChannels = { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: false };
let activeDiagnosis: Diagnosis | null = null;
const completedCapacityDiagnosis: Diagnosis = { id: "dg_pack_004_001", batteryId: "b_pack_004", batteryLabel: "PACK-004", sessionId: "s_history", kind: "CAPACITY", status: "COMPLETED", confidence: "HIGH", startedAt: "2026-07-28T05:20:00.000Z", measuredAt: "2026-07-28T11:40:00.000Z", socHintLevel: null, loadTargetA: null, loadActualA: null, partialMetrics: null, quick: null, capacity: { deliveredWh: 31.2, ratedWh: 37, baselineWh: 34.8, sohRelPct: 89.7, sohAbsPct: 95.8, assumedEfficiency: 0.88, dischargeCurrentA: 1, isBaseline: false, partial: false } };
const diagnosisHistory: Record<string, Diagnosis[]> = { b_pack_004: [completedCapacityDiagnosis] };
let relay: Relay = { batteryId: "b_pack_001", state: "CLOSED", changedAt: now(), changedBy: { type: "SYSTEM", systemCode: "SYSTEM" }, interlock: { engaged: false, condition: null, canRestore: true } };
const page = <T>(items: T[]) => ({ items, page: { number: 1, size: items.length || 20, total: items.length, totalPages: items.length ? 1 : 0 } });
const currentBattery = () => batteries.find((item) => item.id === session?.batteryId) ?? batteries[0];
const bad = (status: number, code: string, message = code) => HttpResponse.json({ error: { code, message } }, { status });
let testFault: string | null = null;
const hasTestFault = (fault: string) => testFault === fault;
const alertSettings = (): AlertSettings => ({ channels: alertChannels, policy: { sendOn: ["DANGER", "WARNING"], smsOnlyDanger: true, dedupeWindowMinutes: 5 } });
const diagnosisListItem = (diagnosis: Diagnosis): DiagnosisListItem => ({ id: diagnosis.id, batteryId: diagnosis.batteryId, batteryLabel: diagnosis.batteryLabel, kind: diagnosis.kind, status: diagnosis.status, confidence: diagnosis.confidence, measuredAt: diagnosis.measuredAt, startedAt: diagnosis.startedAt, socHintLevel: diagnosis.socHintLevel, summary: diagnosis.kind === "QUICK" ? { regulationKneeA: diagnosis.quick?.regulationKneeA ?? null, thermalSlopeCPerMin: diagnosis.quick?.thermalSlopeCPerMin ?? null, grade: diagnosis.quick?.grade ?? null } : { sohRelPct: diagnosis.capacity?.sohRelPct ?? null, deliveredWh: diagnosis.capacity?.deliveredWh ?? null } });
const allDiagnoses = () => Object.values(diagnosisHistory).flat();
const startDiagnosis = async (kind: "quick" | "capacity", request: Request) => {
  if (!session) return bad(409, "NO_ACTIVE_SESSION");
  const battery = currentBattery();
  if (battery.targetMode !== 2) return bad(409, "MODE_NOT_SUPPORTED");
  if (activeDiagnosis) return bad(409, "DIAGNOSIS_IN_PROGRESS");
  if (battery.diagnosisCapability?.executionAllowed !== true) return bad(409, "SAFETY_PROFILE_NOT_READY");
  if (relay.batteryId === battery.id && relay.state === "OPEN") return bad(409, "RELAY_CUT");
  const body = await request.json() as { socHintLevel?: number | null; dischargeCurrentA?: number; fullyChargedConfirmed?: boolean; acknowledged?: boolean };
  if (body.acknowledged !== true) return bad(400, "ACK_REQUIRED");
  if (kind === "quick" && (!("socHintLevel" in body) || (body.socHintLevel !== null && ![1, 2, 3, 4].includes(body.socHintLevel ?? 0)))) return bad(422, "VALIDATION_FAILED");
  if (kind === "capacity" && (typeof body.dischargeCurrentA !== "number" || body.dischargeCurrentA <= 0)) return bad(422, "VALIDATION_FAILED");
  if (kind === "capacity" && body.fullyChargedConfirmed !== true) return bad(400, "FULL_CHARGE_REQUIRED");
  const diagnosis: Diagnosis = { id: `dg_${randomId()}`, batteryId: battery.id, batteryLabel: battery.label, sessionId: session.id, kind: kind === "quick" ? "QUICK" : "CAPACITY", status: "RUNNING", phase: kind === "quick" ? "P0" : "CAPACITY", startedAt: now(), estimatedEndAt: new Date(Date.now() + (kind === "quick" ? 180_000 : 21_600_000)).toISOString(), loadTargetA: kind === "quick" ? 0.5 : body.dischargeCurrentA ?? 1, loadActualA: kind === "quick" ? 0.48 : body.dischargeCurrentA ?? 1, socHintLevel: kind === "quick" ? body.socHintLevel as 1 | 2 | 3 | 4 | null : null, partialMetrics: kind === "quick" ? { vLightLoadV: 5.06, regulationKneeA: null, thermalSlopeCPerMin: null, specAttainmentPct: null } : { deliveredWh: null, specAttainmentPct: null }, quick: null, capacity: null };
  activeDiagnosis = diagnosis;
  return HttpResponse.json(diagnosis, { status: 202 });
};
const users = [demoUser, { id: "u_admin", loginId: "lee", name: "이연구", email: "lee@lab.io", role: "ADMIN" as const, status: "ACTIVE" as const, phone: "010-3456-7890" }, { id: "u_park", loginId: "parktest", name: "박테스트", email: "park@test.io", role: "USER" as const, status: "SUSPENDED" as const, phone: "010-4567-8901" }];
const batteryOwner = (battery: Battery) => battery.id === "b_pack_002" ? { id: users[2].id, name: users[2].name } : battery.id === "b_pack_003" ? { id: users[1].id, name: users[1].name } : { id: demoUser.id, name: demoUser.name };
const adminBatteryListItem = (battery: Battery): AdminBatteryListItem => ({
  id: battery.id,
  label: battery.label,
  owner: batteryOwner(battery),
  maker: battery.maker,
  model: battery.model,
  chemistry: battery.chemistry,
  seriesCount: battery.seriesCount,
  mode: battery.targetMode,
  score: battery.latest?.score ?? null,
  grade: battery.latest?.grade ?? null,
  opsStatus: battery.opsStatus,
  latest: battery.latest ? { tempC: battery.latest.representativeTempC, voltageV: battery.latest.voltageV, socPct: battery.latest.socPct, measuredAt: battery.latest.measuredAt } : null,
});
const adminBatteryDetail = (battery: Battery): AdminBatteryDetail => ({
  ...adminBatteryListItem(battery),
  info: {
    seriesConfig: battery.seriesCount ? `${battery.seriesCount}S · ${(battery.seriesCount * 3.7).toFixed(1)}V` : "—",
    device: session?.batteryId === battery.id ? { id: "d_demo", label: "진단기 A", status: "ONLINE" } : null,
    adminMemo: battery.adminMemo ?? "",
  },
  opsLogs: [],
});

export const handlers = [
  http.post("/api/__test/fault", async ({ request }) => { testFault = (await request.json() as { fault?: string | null }).fault ?? null; return HttpResponse.json({ ok: true }); }),
  http.post("/api/auth/sign-in/email", async ({ request }) => { const body = await request.json() as { email?: string; password?: string }; const email = body.email?.trim().toLowerCase(); if (!email || !body.password) return bad(401, "UNAUTHENTICATED"); currentUser = email === "lee@lab.io" ? users[1] : users[0]; return HttpResponse.json({ user: currentUser }); }),
  http.post("/api/auth/sign-up/email", () => HttpResponse.json({ ok: true }, { status: 201 })),
  http.post("/api/auth/sign-out", () => { currentUser = null; session = null; return new HttpResponse(null, { status: 204 }); }),
  http.post("/api/account/email-lookup", () => HttpResponse.json({ email: "ho****@cellguard.io" })),
  http.post("/api/auth/forget-password", () => HttpResponse.json({ ok: true })),
  http.get("/api/me", () => currentUser ? HttpResponse.json({ user: currentUser, activeSession: session, unreadAlertCount: 0, activeAnomalyCount: 2, preferences: { theme: "light", lang: "ko" } }) : bad(401, "UNAUTHENTICATED")),
  http.patch("/api/me", async ({ request }) => { currentUser = { ...currentUser!, ...(await request.json() as object) }; return HttpResponse.json(currentUser); }),
  http.post("/api/me/password", async ({ request }) => { const body = await request.json() as { currentPassword?: string; newPassword?: string }; if (body.currentPassword !== currentPassword) return bad(401, "REAUTH_REQUIRED"); if (!body.newPassword || !/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(body.newPassword)) return bad(422, "VALIDATION_FAILED"); currentPassword = body.newPassword; return HttpResponse.json({ ok: true }); }),
  http.patch("/api/settings/preferences", async ({ request }) => HttpResponse.json({ theme: (await request.json() as { theme: "light" | "dark" | "system" }).theme, lang: "ko" })),
  http.get("/api/settings/alerts", () => hasTestFault("alert-settings") ? bad(503, "RUNTIME_NOT_READY") : HttpResponse.json(alertSettings())),
  http.patch("/api/settings/alerts", async ({ request }) => { const body = await request.json() as { channels?: AlertChannels }; if (!body.channels || ["KAKAO", "EMAIL", "SMS", "WEBPUSH"].some((key) => typeof body.channels?.[key as keyof AlertChannels] !== "boolean")) return bad(422, "VALIDATION_FAILED"); alertChannels = { ...body.channels }; return HttpResponse.json(alertSettings()); }),
  http.get("/api/batteries", () => HttpResponse.json(page(batteries.map((item) => ({ ...item, isConnected: item.id === session?.batteryId }))))),
  http.post("/api/batteries", async ({ request }) => { const body = await request.json() as Partial<Battery>; const created: Battery = { id: `b_${randomId()}`, label: body.label ?? "NEW", chemistry: body.chemistry ?? "LI_ION", seriesCount: body.seriesCount ?? null, maker: body.maker ?? null, model: body.model ?? null, targetMode: body.targetMode ?? 1, capacityWh: body.capacityWh ?? null, ratedOutputCurrentA: body.ratedOutputCurrentA ?? null, opsStatus: "NORMAL", latest: null, health: null, diagnosisCapability: { executionAllowed: false, reasonCode: body.targetMode === 2 ? "SAFETY_PROFILE_NOT_READY" : "MODE_NOT_SUPPORTED" } }; batteries.push(created); return HttpResponse.json(created, { status: 201 }); }),
  http.patch("/api/batteries/:id", async ({ params, request }) => { const battery = batteries.find((item) => item.id === params.id); if (!battery) return bad(404, "NOT_FOUND"); Object.assign(battery, await request.json()); return HttpResponse.json(battery); }),
  http.get("/api/batteries/:id", ({ params }) => { const battery = batteries.find((item) => item.id === params.id); return battery ? HttpResponse.json(battery) : bad(404, "NOT_FOUND"); }),
  http.get("/api/batteries/:id/sessions", () => HttpResponse.json(page([]))),
  http.post("/api/sessions", async ({ request }) => { const body = await request.json() as { batteryId?: string }; const battery = batteries.find((item) => item.id === body.batteryId); if (!battery) return bad(404, "NOT_FOUND"); if (battery.opsStatus === "BLOCKED") return bad(409, "BATTERY_BLOCKED"); session = { id: `s_${randomId()}`, batteryId: battery.id, batteryLabel: battery.label, deviceId: "d_demo", mode: battery.targetMode, targetMode: battery.targetMode, status: "ACTIVE", startedAt: now() }; return HttpResponse.json(session, { status: 201 }); }),
  http.get("/api/dashboard", () => {
    if (hasTestFault("dashboard-shape")) return HttpResponse.json({});
    if (!session) return bad(409, "NO_ACTIVE_SESSION");
    const battery = currentBattery();
    const latest = battery.latest;
    const metrics = latest ? {
      voltageV: { value: latest.voltageV, status: null },
      currentA: { value: latest.currentA, status: null },
      powerW: { value: latest.powerW ?? null, status: null },
      tempContact: { value: latest.tempContact ?? null, status: metricStatus(latest.tempContact ?? null) },
      tempIrSurface: { value: latest.tempIrSurface ?? null, status: metricStatus(latest.tempIrSurface ?? null) },
      representativeTempC: { value: latest.representativeTempC, source: latest.representativeTempSource, status: metricStatus(latest.representativeTempC) },
      socPct: { value: latest.socPct, status: null },
      socBasis: latest.socBasis ?? null,
      measuredAt: latest.measuredAt,
    } : {
      voltageV: { value: null, status: null }, currentA: { value: null, status: null }, powerW: { value: null, status: null },
      tempContact: { value: null, status: null }, tempIrSurface: { value: null, status: null }, representativeTempC: { value: null, source: null, status: null },
      socPct: { value: null, status: null }, socBasis: null, measuredAt: null,
    };
    return HttpResponse.json({ session, battery, metrics, anomaly: latest ? { score: latest.score, grade: latest.grade, evaluatedAt: latest.measuredAt ?? undefined } : { score: null, grade: null }, relay, notices: [{ id: "n1", category: "MAINTENANCE", title: "7월 정기 서버 점검 (무중단)", summary: "WebSocket 순단이 발생할 수 있습니다.", publishedAt: "2026-07-01T00:00:00.000Z" }], snapshotCursor: "1" });
  }),
  http.get("/api/relay", () => session ? HttpResponse.json({ ...relay, batteryId: session.batteryId }) : bad(409, "NO_ACTIVE_SESSION")),
  http.get("/api/relay/history", () => HttpResponse.json({ items: [] })),
  http.post("/api/relay/:action", async ({ params, request }) => { if (!session) return bad(409, "NO_ACTIVE_SESSION"); const body = await request.json() as { reason?: string; password?: string }; if (!body.reason) return bad(422, "REASON_REQUIRED"); if (!body.password) return bad(401, "REAUTH_REQUIRED"); const action = params.action === "cut"; relay = { ...relay, batteryId: session.batteryId, state: action ? "OPEN" : "CLOSED", changedAt: now(), changedBy: { type: "USER", id: currentUser!.id, name: currentUser!.name }, interlock: { engaged: false, condition: null, canRestore: true } }; return HttpResponse.json({ decision: "APPROVED", requestId: `r_${randomId()}`, relay }); }),
  http.get("/api/anomaly/summary", () => HttpResponse.json({ activeCount: 2, todayCount: 5, peakScore: .58, peakAt: now(), model: { status: "RUNNING", lastInferenceAt: now(), version: "ae-1.3+informer-0.9" }, riskDistribution: { NORMAL: 1, CAUTION: 1, WARNING: 0, DANGER: 0 } })),
  http.get("/api/anomaly/evidence", () => HttpResponse.json({ batteryId: session?.batteryId ?? batteries[0].id, score: .58, evaluatedAt: now(), contributions: [{ feature: "dT_dt", contribution: .42 }, { feature: "I_smooth", contribution: .28 }, { feature: "V_drop", contribution: .16 }, { feature: "SOC_delta", contribution: .09 }] })),
  http.get("/api/anomaly/events", () => HttpResponse.json(page([]))),
  http.get("/api/events", () => HttpResponse.json(page([]))),
  http.get("/api/trends", ({ request }) => { const url = new URL(request.url); const period = (url.searchParams.get("period") ?? "7d") as "24h" | "7d" | "30d"; const count = period === "24h" ? 25 : period === "30d" ? 30 : 7; const buckets = Array.from({ length: count }, (_, index) => new Date(Date.now() - (count - index) * 86_400_000).toISOString()); return HttpResponse.json({ period, buckets, series: ["volt", "curr", "temp", "soc"].map((metric) => ({ batteryId: session?.batteryId ?? batteries[0].id, batteryLabel: currentBattery().label, metric, unit: metric === "temp" ? "°C" : metric === "soc" ? "%" : metric === "volt" ? "V" : "A", points: buckets.map((_, index) => metric === "temp" ? 31 + index : metric === "soc" ? 78 - index : metric === "volt" ? 11.9 : -2.4) })) } as const); }),
  http.get("/api/alerts/summary", () => HttpResponse.json({ unacknowledgedCount: 0, today: { DANGER: 0, WARNING: 0, NORMAL_OR_CHECK: 0 } })),
  http.get("/api/alerts", () => HttpResponse.json(page([]))),
  http.post("/api/alerts/:id/ack", () => HttpResponse.json({ ok: true })),
  http.post("/api/alerts/ack-all", () => HttpResponse.json({ acknowledgedCount: 1 })),
  http.get("/api/notices", () => HttpResponse.json(page([{ id: "n1", category: "MAINTENANCE", title: "7월 정기 서버 점검 (무중단)", summary: "WebSocket 순단이 발생할 수 있습니다.", publishedAt: "2026-07-01T00:00:00.000Z" }, { id: "n2", category: "FEATURE", title: "이상 근거(XAI) 패널 정식 오픈", summary: "이상점수 상승에 기여한 특징을 확인합니다.", publishedAt: "2026-06-28T00:00:00.000Z" }]))),
  http.get("/api/notices/:id", ({ params }) => HttpResponse.json({ id: params.id, category: "MAINTENANCE", title: "7월 정기 서버 점검 (무중단)", body: "7/7 00:00~04:00 인프라 점검이 진행됩니다. WebSocket 순단이 발생할 수 있으나 자동 재연결됩니다.", publishedAt: "2026-07-01T00:00:00.000Z" })),
  http.get("/api/diagnosis/active", () => HttpResponse.json(activeDiagnosis)),
  http.post("/api/diagnosis/quick", ({ request }) => startDiagnosis("quick", request)),
  http.post("/api/diagnosis/capacity", ({ request }) => startDiagnosis("capacity", request)),
  http.delete("/api/diagnosis/active", () => { if (!activeDiagnosis) return bad(409, "NO_DIAGNOSIS_IN_PROGRESS"); const aborted: Diagnosis = { ...activeDiagnosis, status: "ABORTED", abortReason: "USER" }; diagnosisHistory[aborted.batteryId] = [aborted, ...(diagnosisHistory[aborted.batteryId] ?? [])]; activeDiagnosis = null; return HttpResponse.json(aborted); }),
  http.get("/api/batteries/:id/diagnoses", ({ params }) => { const items = (diagnosisHistory[String(params.id)] ?? []).map(diagnosisListItem); return HttpResponse.json(page(items)); }),
  http.get("/api/diagnoses/:id", ({ params }) => { const diagnosis = allDiagnoses().find((item) => item.id === String(params.id)) ?? (activeDiagnosis?.id === String(params.id) ? activeDiagnosis : undefined); return diagnosis ? HttpResponse.json(diagnosis) : bad(404, "NOT_FOUND"); }),
  http.get("/api/admin/overview", () => HttpResponse.json({ users: 3, batteries: batteries.length, activeSessions: session ? 1 : 0, blockedBatteries: 0, relayOpen: relay.state === "OPEN" ? 1 : 0 })),
  http.get("/api/admin/event-trend", () => HttpResponse.json({ buckets: ["월", "화", "수", "목", "금", "토", "일"], series: [{ grade: "CAUTION", values: [2, 3, 1, 4, 2, 1, 3] }, { grade: "WARNING", values: [1, 2, 1, 2, 1, 0, 2] }, { grade: "DANGER", values: [0, 1, 0, 1, 0, 0, 1] }] })),
  http.get("/api/admin/users", () => hasTestFault("admin-users") ? bad(503, "RUNTIME_NOT_READY") : HttpResponse.json(page(users.map((user) => ({ ...user, batteryCount: user.id === "u_hong" ? 2 : 0 }))))),
  http.patch("/api/admin/users/:id", async ({ params, request }) => { const body = await request.json() as { status: "ACTIVE" | "SUSPENDED" }; const user = users.find((item) => item.id === params.id); if (!user) return bad(404, "NOT_FOUND"); user.status = body.status; return HttpResponse.json(user); }),
  http.get("/api/admin/batteries", ({ request }) => { const query = new URL(request.url).searchParams; const q = query.get("q")?.normalize("NFKC").trim().toLocaleLowerCase() ?? ""; const opsStatus = query.get("opsStatus"); const items = batteries.filter((battery) => { const owner = batteryOwner(battery); return (!q || battery.label.toLocaleLowerCase().includes(q) || owner.name.toLocaleLowerCase().includes(q)) && (!opsStatus || battery.opsStatus === opsStatus); }).map(adminBatteryListItem); return HttpResponse.json(page(items)); }),
  http.get("/api/admin/batteries/:id", ({ params }) => { const battery = batteries.find((item) => item.id === params.id); return battery ? HttpResponse.json(adminBatteryDetail(battery)) : bad(404, "NOT_FOUND"); }),
  http.patch("/api/admin/batteries/:id/ops-status", async ({ params, request }) => { const battery = batteries.find((item) => item.id === params.id); if (!battery) return bad(404, "NOT_FOUND"); const body = await request.json() as { opsStatus?: unknown; reason?: unknown }; if (!body.opsStatus || !["NORMAL", "WATCH", "BLOCKED"].includes(String(body.opsStatus))) return bad(400, "VALIDATION_FAILED"); try { normalizeAdminInput(body.reason, 500, false); } catch (error) { return bad(422, (error as Error).message); } if (body.opsStatus === battery.opsStatus) return bad(409, "NO_STATUS_CHANGE"); battery.opsStatus = body.opsStatus as Battery["opsStatus"]; return HttpResponse.json({ opsStatus: battery.opsStatus, updatedAt: now(), updatedBy: currentUser?.name }); }),
  http.patch("/api/admin/batteries/:id/memo", async ({ params, request }) => { const battery = batteries.find((item) => item.id === params.id); if (!battery) return bad(404, "NOT_FOUND"); const body = await request.json() as { memo?: unknown }; try { battery.adminMemo = normalizeAdminInput(body.memo, 2_000, true); } catch (error) { return bad(422, (error as Error).message); } return HttpResponse.json({ memo: battery.adminMemo, updatedAt: now(), updatedBy: currentUser?.name }); }),
  http.get("/api/admin/audit-logs", () => HttpResponse.json(page([]))),
  http.get("/api/admin/notices", () => HttpResponse.json({ items: [] })),
];
