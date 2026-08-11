import { expect, test, type Page } from "@playwright/test";

const user = { id: "u_cold", name: "Cold User", email: "cold@example.com", role: "USER", status: "ACTIVE" };
const admin = { ...user, id: "a_cold", role: "ADMIN" };
const battery = {
  id: "b_pack_001", label: "PACK-001", chemistry: "LI_ION", seriesCount: 3,
  maker: "CellGuard", model: "Cold fixture", targetMode: 1, capacityWh: null,
  ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: null, health: null,
  diagnosisCapability: { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" },
};

async function signIn(page: Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
}

async function stubColdApi(page: Page, role: "USER" | "ADMIN" = "USER") {
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/me") return json({ user: role === "ADMIN" ? admin : user, activeSession: null, unreadAlertCount: 0, activeAnomalyCount: 0, preferences: { theme: "light", lang: "ko" } });
    if (path === "/api/batteries") return json({ items: [battery], page: { number: 1, size: 1, total: 1, totalPages: 1 } });
    if (path === "/api/batteries/b_pack_001") return json(battery);
    if (path === "/api/batteries/b_pack_001/sessions") return json({ items: [], page: { number: 1, size: 20, total: 0, totalPages: 0 } });
    if (path === "/api/trends") return json({ period: "30d", buckets: [], series: [] });
    if (path === "/api/admin/overview") return json({ users: 1, batteries: 1, activeSessions: 0, blockedBatteries: 0, relayOpen: 0 });
    return json({ error: { code: "NOT_FOUND", message: path } }, 404);
  });
}

test.describe("authentication and cold route gates", () => {
  test("local development login accepts arbitrary non-empty values with Enter", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill("anything");
    await page.getByLabel("비밀번호").fill("anything");
    await page.getByLabel("비밀번호").press("Enter");
    await expect(page).toHaveURL(/\/battery$/);
    await expect(page.getByRole("heading", { name: "배터리 관리" })).toBeVisible();
  });

  for (const path of ["/dashboard", "/anomaly", "/trend", "/events", "/alertHistory", "/notices", "/powerbankDiag", "/relay", "/settings"]) {
    test(`cold navigation redirects a sessionless user from ${path}`, async ({ page }) => {
      await stubColdApi(page);
      await page.goto(`${path}?mock=0`);
      await expect(page).toHaveURL(/\/battery$/);
      await expect(page.getByRole("heading", { name: "배터리 관리" })).toBeVisible();
    });
  }

  test("cold navigation keeps battery detail available without an active session", async ({ page }) => {
    await stubColdApi(page);
    await page.goto("/battery/b_pack_001?mock=0");
    await expect(page).toHaveURL(/\/battery\/b_pack_001(?:\?mock=0)?$/);
    await expect(page.getByRole("heading", { name: "PACK-001" })).toBeVisible();
  });

  test("cold authenticated login route lands an administrator on admin", async ({ page }) => {
    await stubColdApi(page, "ADMIN");
    await page.goto("/login?mock=0");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "관리자 대시보드" })).toBeVisible();
  });
});

test.describe("REST authentication expiry (MSW)", () => {
  test("logs out an authenticated app after a protected REST 401", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await expect(page).toHaveURL(/\/battery$/);

    await page.evaluate(async () => {
      await fetch("/api/auth/sign-out", { method: "POST" });
      const modulePath = "/src/api/client.ts";
      const { api } = await import(modulePath);
      try { await api.me(); } catch { /* listener handles the parsed 401 */ }
    });

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  });

  test("keeps the authenticated app on a REST reauthentication failure", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await expect(page).toHaveURL(/\/battery$/);

    await page.evaluate(async () => {
      const modulePath = "/src/api/client.ts";
      const { api } = await import(modulePath);
      try { await api.changePassword({ currentPassword: "wrong", newPassword: "New-password1!" }); } catch { /* expected */ }
    });

    await expect(page).toHaveURL(/\/battery$/);
    await expect(page.getByRole("heading", { name: "배터리 관리" })).toBeVisible();
  });
});
