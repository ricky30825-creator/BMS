import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(email === "lee@lab.io" ? /\/admin$/ : /\/battery$/);
}

async function markSensorFrame(page: Page, batteryId: string) {
  await page.evaluate(async (id) => {
    const response = await fetch("/api/__test/sensor-frame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batteryId: id }) });
    if (!response.ok) throw new Error("failed to inject a test sensor frame");
    const modulePath = "/src/queryClient.ts";
    const { queryClient } = await import(modulePath);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["me"] }),
      queryClient.refetchQueries({ queryKey: ["batteries"] }),
    ]);
  }, batteryId);
}

async function connectBattery(page: Page, label: string, measuring = true) {
  const card = page.locator("section.battery-card").filter({ hasText: label });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "연결하고 측정" }).click();
  const dialog = page.getByRole("dialog", { name: `${label}을(를) 측정할까요?` });
  await dialog.getByRole("button", { name: "연결하고 측정" }).click();
  await expect(page).toHaveURL(/\/battery$/);
  if (!measuring) return;
  const batteryId = ({ "PACK-001": "b_pack_001", "PACK-002": "b_pack_002", "PACK-003": "b_pack_003", "PACK-004": "b_pack_004" } as Record<string, string>)[label];
  if (!batteryId) throw new Error(`no test battery id for ${label}`);
  await markSensorFrame(page, batteryId);
  await expect(page.locator(".connection-pill")).toHaveText("연결됨 · 측정 중");
  await page.locator("aside").getByRole("button", { name: /대시보드/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function enableMockFault(page: Page, fault: string | null) {
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
    await connectBattery(page, "PACK-003", false);
    await expect(page.locator(".connection-pill")).toHaveText("장비 연결 대기");
    await expect(page.locator(".connection-pill")).not.toContainText("측정 중");
    const card = page.locator("section.battery-card").filter({ hasText: "PACK-003" });
    await expect(card).toHaveClass(/waiting/);
    await expect(card.getByRole("button", { name: "응답 대기 · 다시 시도" })).toBeEnabled();
    const dashboard = page.locator("aside").getByRole("button", { name: /대시보드/ });
    await expect(dashboard).toHaveAttribute("aria-disabled", "true");
    await dashboard.click({ force: true });
    await expect(page.getByRole("status")).toHaveText("장비의 첫 센서 프레임을 기다리는 중입니다. 응답이 없으면 배터리 관리에서 다시 시도하세요.");
    await page.getByRole("button", { name: "알림 열기" }).click();
    await expect(page.locator(".notification-popover")).toContainText("새 알림이 없습니다.");
    await expect(page.locator(".notification-popover")).not.toContainText("PACK-001");
  });

  test("keeps a failed session request retryable", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await enableMockFault(page, "session-timeout");
    const card = page.locator("section.battery-card").filter({ hasText: "PACK-001" });
    await card.getByRole("button", { name: "연결하고 측정" }).click();
    const dialog = page.getByRole("dialog", { name: "PACK-001을(를) 측정할까요?" });
    await dialog.getByRole("button", { name: "연결하고 측정" }).click();
    await expect(dialog).toContainText("진단기가 오프라인이거나 응답하지 않습니다.");
    await expect(dialog.getByRole("button", { name: "연결하고 측정" })).toBeEnabled();
    await enableMockFault(page, null);
    await dialog.getByRole("button", { name: "연결하고 측정" }).click();
    await expect(page).toHaveURL(/\/battery$/);
    await markSensorFrame(page, "b_pack_001");
    await expect(page.locator(".connection-pill")).toHaveText("연결됨 · 측정 중");
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
