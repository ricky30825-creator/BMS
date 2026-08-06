import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlers } from "../mocks/handlers";

const base = "http://localhost";
const safeBattery = { id: "b_pack_002", diagnosisCapability: { executionAllowed: false, reasonCode: "SAFETY_PROFILE_NOT_READY" } };
const capableBattery = { id: "b_pack_004", diagnosisCapability: { executionAllowed: true, reasonCode: null } };
let active: { id: string; kind: string; status: string; socHintLevel?: number | null; loadTargetA?: number } | null = null;
const history = [{ id: "dg_pack_004_001", kind: "CAPACITY", status: "COMPLETED" }];
const nodeScenarioHandlers = [
  http.post(`${base}/api/auth/sign-in/email`, () => HttpResponse.json({ user: { id: "u_hong" } })),
  http.get(`${base}/api/batteries`, () => HttpResponse.json({ items: [safeBattery, capableBattery] })),
  http.post(`${base}/api/sessions`, () => HttpResponse.json({ id: "s_mode2", batteryId: "b_pack_004" }, { status: 201 })),
  http.post(`${base}/api/diagnosis/quick`, async ({ request }) => { const body = await request.json() as { socHintLevel: number | null; acknowledged: boolean }; if (body.acknowledged !== true) return new HttpResponse(null, { status: 400 }); active = { id: "dg_quick", kind: "QUICK", status: "RUNNING", socHintLevel: body.socHintLevel }; return HttpResponse.json(active, { status: 202 }); }),
  http.post(`${base}/api/diagnosis/capacity`, async ({ request }) => { const body = await request.json() as { dischargeCurrentA: number; fullyChargedConfirmed: boolean; acknowledged: boolean }; if (body.acknowledged !== true || body.fullyChargedConfirmed !== true) return new HttpResponse(null, { status: 400 }); active = { id: "dg_capacity", kind: "CAPACITY", status: "RUNNING", loadTargetA: body.dischargeCurrentA }; return HttpResponse.json(active, { status: 202 }); }),
  http.delete(`${base}/api/diagnosis/active`, () => { if (active) history.unshift({ id: active.id, kind: active.kind, status: "ABORTED" }); active = null; return HttpResponse.json({ status: "ABORTED" }); }),
  http.get(`${base}/api/batteries/b_pack_004/diagnoses`, () => HttpResponse.json({ items: history })),
  http.get(`${base}/api/diagnoses/dg_pack_004_001`, () => HttpResponse.json({ id: "dg_pack_004_001", kind: "CAPACITY", status: "COMPLETED" })),
];
const server = setupServer(...handlers, ...nodeScenarioHandlers);

describe("MSW mode 2 capability scenario", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());

  it("keeps the safe profile locked and exercises capability-enabled F21 requests and history", async () => {
    const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", body: JSON.stringify({ email: "hong@cellguard.io", password: "demo-password" }) });
    expect(login.status).toBe(200);
    const batteriesResponse = await fetch(`${base}/api/batteries`);
    const batteries = await batteriesResponse.json() as { items: Array<{ id: string; diagnosisCapability?: { executionAllowed: boolean; reasonCode: string | null } }> };
    expect(batteries.items.find((item) => item.id === "b_pack_002")?.diagnosisCapability).toEqual({ executionAllowed: false, reasonCode: "SAFETY_PROFILE_NOT_READY" });
    expect(batteries.items.find((item) => item.id === "b_pack_004")?.diagnosisCapability).toEqual({ executionAllowed: true, reasonCode: null });

    const session = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ batteryId: "b_pack_004" }) });
    expect(session.status).toBe(201);
    const quick = await fetch(`${base}/api/diagnosis/quick`, { method: "POST", body: JSON.stringify({ socHintLevel: 2, acknowledged: true }) });
    expect(quick.status).toBe(202);
    const running = await quick.json() as { kind: string; status: string; socHintLevel: number };
    expect(running).toMatchObject({ kind: "QUICK", status: "RUNNING", socHintLevel: 2 });

    const stop = await fetch(`${base}/api/diagnosis/active`, { method: "DELETE" });
    expect(stop.status).toBe(200);
    const capacity = await fetch(`${base}/api/diagnosis/capacity`, { method: "POST", body: JSON.stringify({ dischargeCurrentA: 0.8, fullyChargedConfirmed: true, acknowledged: true }) });
    expect(capacity.status).toBe(202);
    const capacityRunning = await capacity.json() as { kind: string; loadTargetA: number };
    expect(capacityRunning).toMatchObject({ kind: "CAPACITY", loadTargetA: 0.8 });
    await fetch(`${base}/api/diagnosis/active`, { method: "DELETE" });

    const history = await fetch(`${base}/api/batteries/b_pack_004/diagnoses`);
    expect(history.status).toBe(200);
    const historyBody = await history.json() as { items: Array<{ id: string; kind: string }> };
    expect(historyBody.items.length).toBeGreaterThanOrEqual(3);
    const detail = await fetch(`${base}/api/diagnoses/dg_pack_004_001`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: "dg_pack_004_001", kind: "CAPACITY", status: "COMPLETED" });
  });
});
