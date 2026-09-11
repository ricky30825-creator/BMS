import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(email === "lee@lab.io" ? /\/admin$/ : /\/battery$/);
}

async function connectBattery(page: Page, label: string) {
  const card = page.locator("section.battery-card").filter({ hasText: label });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "연결하고 측정" }).click();
  const dialog = page.getByRole("dialog", { name: `${label}을(를) 측정할까요?` });
  await dialog.getByRole("button", { name: "연결하고 측정" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function enableMockFault(page: Page, fault: string) {
  await page.evaluate(async (value) => {
    const response = await fetch("/api/__test/fault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fault: value }) });
    if (!response.ok) throw new Error("failed to configure the mock fault");
  }, fault);
}

test.describe("frontend review regressions", () => {
  test("does not expose the local demo admin control in ordinary development login", async ({ page }) => {
    await page.goto("/login?mock=1");
    await expect(page.getByRole("button", { name: "관리자 콘솔" })).toHaveCount(0);
  });

  test("uses the active session label and renders an honest empty notification state", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-003");
    await expect(page.locator(".topbar-subtitle")).toHaveText("PACK-003 · 세션 진행 중");
    await expect(page.locator(".connection-pill")).toHaveText("장비 연결 대기");
    await expect(page.locator(".connection-pill")).not.toContainText("측정 중");
    await expect(page.getByRole("heading", { name: "아직 측정 데이터가 없습니다." })).toBeVisible();
    await page.getByRole("button", { name: "알림 열기" }).click();
    await expect(page.locator(".notification-popover")).toContainText("새 알림이 없습니다.");
    await expect(page.locator(".notification-popover")).not.toContainText("PACK-001");
  });

  test("renders a dashboard unavailable state for a malformed snapshot", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await enableMockFault(page, "dashboard-shape");
    await connectBattery(page, "PACK-001");
    await expect(page.getByText("대시보드 데이터를 사용할 수 없습니다.")).toBeVisible();
  });

  test("keeps alert settings disabled after GET failure and offers retry", async ({ page }) => {
    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/settings/alerts") patches.push(request.url());
    });
    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-001");
    await enableMockFault(page, "alert-settings");
    await page.getByRole("link", { name: "설정" }).click();
    await expect(page.getByRole("heading", { name: "설정" })).toBeVisible();
    await expect(page.getByText("알림 설정을 불러오지 못했습니다.", { exact: false })).toBeVisible();
    await expect(page.locator(".toggle-row input").first()).toBeDisabled();
    expect(patches).toHaveLength(0);
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });

  test("distinguishes an admin API failure from an empty user result", async ({ page }) => {
    await signIn(page, "lee@lab.io");
    await enableMockFault(page, "admin-users");
    await page.getByRole("button", { name: "유저 관리" }).click();
    await expect(page.getByText("유저 관리 API를 불러오지 못했습니다.")).toBeVisible();
    await expect(page.getByText("조건에 맞는 유저가 없습니다.")).toHaveCount(0);
  });
});
