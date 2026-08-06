import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/battery$/);
  await expect(page.getByRole("heading", { name: "배터리 관리" })).toBeVisible();
}

async function connectBattery(page: Page, label: string) {
  const card = page.locator("section.battery-card").filter({ hasText: label });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "연결하고 측정" }).click();

  const dialog = page.getByRole("dialog", { name: `${label}을(를) 측정할까요?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "연결하고 측정" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("CellGuard contract flows (MSW)", () => {
  test("requires an asset/session before opening monitoring screens", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");

    const dashboard = page.locator("aside").getByRole("button", { name: /대시보드/ });
    await expect(dashboard).toHaveAttribute("aria-disabled", "true");
    await dashboard.click({ force: true });
    await expect(page.getByRole("status")).toHaveText("먼저 배터리를 연결하면 이 화면을 사용할 수 있습니다.");
  });

  test("keeps the default F21 safety profile locked", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-002");

    await page.locator("aside").getByRole("button", { name: "보조배터리 진단" }).click();
    await expect(page).toHaveURL(/\/powerbankDiag$/);
    await expect(page.getByRole("heading", { name: "보조배터리 진단" })).toBeVisible();
    await expect(page.getByText("SAFETY_PROFILE_NOT_READY", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "빠른 진단 시작" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "정밀 용량 테스트 시작" })).toBeDisabled();
    await expect(page.getByLabel("진단 중 이상 알림은 억제되지만 Fail-Safe 자동 차단은 항상 우선함을 확인했습니다.")).toBeDisabled();
  });

  test("enters the MSW-only capability=true flow and sends the diagnosis requests", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${url.pathname}`);
    });

    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-004");
    await page.locator("aside").getByRole("button", { name: "보조배터리 진단" }).click();

    await expect(page.getByRole("heading", { name: "보조배터리 진단" })).toBeVisible();
    await expect(page.getByText("SAFETY_PROFILE_NOT_READY", { exact: true })).toHaveCount(0);
    await page.getByLabel("겉면 잔량 힌트").selectOption("3");
    await page.getByLabel("진단 중 이상 알림은 억제되지만 Fail-Safe 자동 차단은 항상 우선함을 확인했습니다.").check();
    await expect(page.getByRole("button", { name: "빠른 진단 시작" })).toBeEnabled();
    await page.getByRole("button", { name: "빠른 진단 시작" }).click();

    await expect(page.getByRole("heading", { name: "진단 진행 중" })).toBeVisible();
    await expect.poll(() => [...new Set(apiRequests)]).toEqual(expect.arrayContaining([
      "POST /api/auth/sign-in/email",
      "GET /api/me",
      "GET /api/batteries",
      "POST /api/sessions",
      "GET /api/batteries/b_pack_004",
      "GET /api/diagnosis/active",
      "GET /api/batteries/b_pack_004/diagnoses",
      "POST /api/diagnosis/quick",
    ]));
  });

  test("keeps admin status and memo saves as separate controls", async ({ page }) => {
    await signIn(page, "lee@lab.io");
    await page.locator("aside").getByRole("button", { name: "관리자 대시보드" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "관리자 대시보드" })).toBeVisible();

    await page.locator("aside").getByRole("button", { name: "배터리 운영 관리" }).click();
    await expect(page.getByRole("heading", { name: "배터리 운영 관리" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "PACK-001" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "상세" }).click();

    const dialog = page.getByRole("dialog", { name: "PACK-001 운영 상세" });
    await expect(dialog).toBeVisible();
    const status = dialog.getByLabel("다음 상태");
    const statusReason = dialog.getByLabel("상태 변경 사유");
    const memo = dialog.getByLabel("관리자 전용 메모");
    await expect(dialog.getByRole("button", { name: "상태 저장" })).toBeDisabled();

    const memoRequest = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/admin/batteries/b_pack_001/memo");
    await memo.fill("현장 확인 메모");
    await dialog.getByRole("button", { name: "메모 저장" }).click();
    await memoRequest;
    await expect(dialog.getByRole("button", { name: "상태 저장" })).toBeDisabled();

    await status.selectOption("WATCH");
    await statusReason.fill("관찰 상태로 전환");
    const statusRequest = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/admin/batteries/b_pack_001/ops-status");
    await dialog.getByRole("button", { name: "상태 저장" }).click();
    await statusRequest;
    await expect(status).toHaveValue("WATCH");
  });
});
