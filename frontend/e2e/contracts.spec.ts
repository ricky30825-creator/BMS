import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
  if (email === "lee@lab.io") {
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "관리자 대시보드" })).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/battery$/);
    await expect(page.getByRole("heading", { name: "배터리 관리" })).toBeVisible();
  }
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
  await expect(dialog).toBeVisible();
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

test.describe("CellGuard contract flows (MSW)", () => {
  test("requires an asset/session before opening monitoring screens", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");

    const dashboard = page.locator("aside").getByRole("button", { name: /대시보드/ });
    await expect(dashboard).toHaveAttribute("aria-disabled", "true");
    await dashboard.click({ force: true });
    await expect(page.getByRole("status")).toHaveText("먼저 배터리를 연결하면 이 화면을 사용할 수 있습니다.");
  });

  test("requires explicit F21 safety acknowledgement before running", async ({ page }) => {
    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-002");

    await page.locator("aside").getByRole("button", { name: "보조배터리 진단" }).click();
    await expect(page).toHaveURL(/\/powerbankDiag$/);
    await expect(page.getByRole("heading", { name: "보조배터리 진단" })).toBeVisible();
    await expect(page.getByText("SAFETY_PROFILE_NOT_READY", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "빠른 진단 시작" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "정밀 용량 테스트 시작" })).toBeDisabled();
    await expect(page.getByLabel("진단 중 이상 알림은 억제되지만 Fail-Safe 자동 차단은 항상 우선함을 확인했습니다.")).toBeEnabled();
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

  test("renders PostgreSQL-shaped event trends and switches period buckets", async ({ page }) => {
    const trendPeriods: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/admin/event-trend") trendPeriods.push(url.searchParams.get("period") ?? "");
    });

    await signIn(page, "lee@lab.io");
    await expect(page.getByText("전체 이벤트", { exact: true })).toBeVisible();
    await expect(page.getByText("위험 이벤트", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "7일", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => trendPeriods).toContain("7d");

    await page.getByRole("tab", { name: "24시간", exact: true }).click();
    await expect(page.getByRole("tab", { name: "24시간", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => trendPeriods).toContain("24h");

    await page.locator("aside").getByRole("button", { name: "이벤트 추이", exact: true }).click();
    await expect(page).toHaveURL(/\/adminEventTrend$/);
    await expect(page.getByRole("heading", { name: "이벤트 추이", exact: true }).first()).toBeVisible();
    await expect(page.getByText("최다 발생", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "30일", exact: true }).click();
    await expect(page.getByRole("tab", { name: "30일", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => trendPeriods).toContain("30d");
  });

  test("downloads the aggregate trend PDF with the period, batteries, and metrics query", async ({ page }) => {
    const trendRequests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/trends/export.pdf") trendRequests.push(url);
    });

    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-004");
    await page.locator("aside").getByRole("button", { name: "추세 차트", exact: true }).click();
    await expect(page).toHaveURL(/\/trend$/);
    await expect(page.getByRole("heading", { name: "추세 차트", exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("trend-report.pdf");
    await expect.poll(() => trendRequests.length).toBe(1);
    expect(trendRequests[0].searchParams.get("period")).toBe("7d");
    expect(trendRequests[0].searchParams.get("batteryIds")).toBe("b_pack_004");
    expect(trendRequests[0].searchParams.get("metrics")).toBe("volt,curr,temp,soc,anomaly");
    expect(trendRequests[0].searchParams.has("sessionId")).toBe(false);
    expect(trendRequests[0].searchParams.has("from")).toBe(false);
    expect(trendRequests[0].searchParams.has("to")).toBe(false);
  });

  test("omits batteryIds when all trend comparison selections are cleared", async ({ page }) => {
    const trendRequests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/trends/export.pdf") trendRequests.push(url);
    });

    await signIn(page, "hong@cellguard.io");
    await connectBattery(page, "PACK-004");
    await page.locator("aside").getByRole("button", { name: "추세 차트", exact: true }).click();
    await expect(page).toHaveURL(/\/trend$/);

    await page.getByRole("button", { name: "비교 추가 (1)", exact: true }).click();
    await page.getByRole("checkbox", { name: "PACK-004", exact: true }).uncheck();
    await expect(page.getByRole("button", { name: "비교 추가 (0)", exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await downloadPromise;
    await expect.poll(() => trendRequests.length).toBe(1);
    expect(trendRequests[0].searchParams.has("batteryIds")).toBe(false);
    expect(trendRequests[0].searchParams.get("period")).toBe("7d");
  });

  test("keeps admin status and memo saves as separate controls", async ({ page }) => {
    await signIn(page, "lee@lab.io");
    await page.locator("aside").getByRole("button", { name: "관리자 대시보드" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "관리자 대시보드" })).toBeVisible();

    await page.locator("aside").getByRole("button", { name: "배터리 운영 관리" }).click();
    await expect(page.getByRole("heading", { name: "배터리 운영 관리" })).toBeVisible();
    const search = page.getByPlaceholder("배터리 · 소유자 검색");
    await search.fill("박테스트");
    const ownerRow = page.getByRole("row").filter({ hasText: "PACK-002" });
    await expect(ownerRow).toContainText("박테스트");
    await expect(page.getByRole("row").filter({ hasText: "PACK-001" })).toHaveCount(0);
    await search.clear();
    await search.fill("PACK-004");
    await expect(page.getByRole("row").filter({ hasText: "PACK-004" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "PACK-001" })).toHaveCount(0);
    await search.clear();
    await page.getByLabel("운영 상태").selectOption("BLOCKED");
    await expect(page.getByText("조건에 맞는 배터리가 없습니다.")).toBeVisible();
    await page.getByLabel("운영 상태").selectOption("all");
    await expect(page.getByRole("row").filter({ hasText: "PACK-003" })).toContainText("측정 없음 · —");
    const row = page.getByRole("row").filter({ hasText: "PACK-001" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "상세" }).click();

    const dialog = page.getByRole("dialog", { name: "PACK-001 운영 상세" });
    await expect(dialog).toBeVisible();
    const status = dialog.getByLabel("다음 상태");
    const statusReason = dialog.getByLabel("상태 변경 사유");
    const memo = dialog.getByLabel("관리자 전용 메모");
    await expect(memo).toHaveValue("기존 관리자 메모");
    await expect(dialog.getByText("3S · 11.1V", { exact: true })).toBeVisible();
    await expect(dialog.getByText("11.9 V", { exact: true })).toBeVisible();
    await expect(dialog.getByText("78 %", { exact: true })).toBeVisible();
    await expect(dialog.locator(".detail-list div").filter({ hasText: "연결 진단기" }).locator("strong")).toHaveText("—");
    await expect(dialog.getByText("운영 로그가 없습니다.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "상태 저장" })).toBeDisabled();

    await memo.fill("내가 작성 중인 초안");
    await page.evaluate(async () => {
      const modulePath = "/src/queryClient.ts";
      const { queryClient } = await import(modulePath);
      const key = ["admin-battery", "b_pack_001"];
      const current = queryClient.getQueryData(key) as { info: { adminMemo: string } };
      queryClient.setQueryData(key, { ...current, info: { ...current.info, adminMemo: "다른 관리자의 최신 메모" } });
    });
    await expect(memo).toHaveValue("내가 작성 중인 초안");
    await expect(dialog.getByText("다른 관리자가 메모를 변경했습니다.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "메모 저장" })).toBeDisabled();
    await dialog.getByRole("button", { name: "서버 메모 불러오기" }).click();
    await expect(memo).toHaveValue("다른 관리자의 최신 메모");

    await status.selectOption("WATCH");
    await statusReason.fill("관찰 상태로 전환");
    await memo.fill("  Ａ 현장 확인 메모  ");
    const [memoRequest, memoResponse, memoRefresh] = await Promise.all([
      page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/admin/batteries/b_pack_001/memo"),
      page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/batteries/b_pack_001/memo"),
      page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/batteries/b_pack_001"),
      dialog.getByRole("button", { name: "메모 저장" }).click(),
    ]);
    expect(memoRequest.postDataJSON()).toEqual({ memo: "  Ａ 현장 확인 메모  " });
    expect(memoResponse.ok()).toBe(true);
    const memoBody = await memoResponse.json();
    expect(memoBody).toMatchObject({ memo: "A 현장 확인 메모" });
    expect(memoBody).not.toHaveProperty("version");
    expect(memoRefresh.ok()).toBe(true);
    await expect(memo).toHaveValue("A 현장 확인 메모");
    await expect(status).toHaveValue("WATCH");
    await expect(statusReason).toHaveValue("관찰 상태로 전환");
    await expect(dialog.getByRole("button", { name: "상태 저장" })).toBeEnabled();

    await memo.fill("저장하지 않은 후속 메모");
    const [statusRequest, statusResponse, statusRefresh] = await Promise.all([
      page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/admin/batteries/b_pack_001/ops-status"),
      page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/batteries/b_pack_001/ops-status"),
      page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/batteries/b_pack_001"),
      dialog.getByRole("button", { name: "상태 저장" }).click(),
    ]);
    expect(statusRequest.postDataJSON()).toEqual({ opsStatus: "WATCH", reason: "관찰 상태로 전환" });
    expect(statusResponse.ok()).toBe(true);
    const statusBody = await statusResponse.json();
    expect(statusBody).toMatchObject({ opsStatus: "WATCH" });
    expect(statusBody).not.toHaveProperty("version");
    expect(statusRefresh.ok()).toBe(true);
    await expect(status).toHaveValue("WATCH");
    await expect(memo).toHaveValue("저장하지 않은 후속 메모");

    await dialog.getByRole("button", { name: "닫기" }).click();
    await row.getByRole("button", { name: "상세" }).click();
    const reopened = page.getByRole("dialog", { name: "PACK-001 운영 상세" });
    await expect(reopened.getByLabel("관리자 전용 메모")).toHaveValue("A 현장 확인 메모");
    await expect(reopened.getByLabel("다음 상태")).toHaveValue("WATCH");

    const limits = await page.evaluate(async () => {
      const memoResult = await fetch("/api/admin/batteries/b_pack_001/memo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo: "가".repeat(2_001) }) });
      const reasonResult = await fetch("/api/admin/batteries/b_pack_001/ops-status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opsStatus: "BLOCKED", reason: "가".repeat(501) }) });
      const statusResult = await fetch("/api/admin/batteries/b_pack_001/ops-status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opsStatus: "INVALID", reason: "잘못된 상태" }) });
      return { memo: { status: memoResult.status, body: await memoResult.json() }, reason: { status: reasonResult.status, body: await reasonResult.json() }, status: { status: statusResult.status, body: await statusResult.json() } };
    });
    expect(limits.memo).toMatchObject({ status: 422, body: { error: { code: "INPUT_TOO_LONG" } } });
    expect(limits.reason).toMatchObject({ status: 422, body: { error: { code: "INPUT_TOO_LONG" } } });
    expect(limits.status).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_FAILED" } } });
  });

  test("keeps a successful admin PATCH value when the detail refresh fails", async ({ page }) => {
    await signIn(page, "lee@lab.io");
    await page.locator("aside").getByRole("button", { name: "배터리 운영 관리" }).click();
    const row = page.getByRole("row").filter({ hasText: "PACK-001" });
    await row.getByRole("button", { name: "상세" }).click();
    const dialog = page.getByRole("dialog", { name: "PACK-001 운영 상세" });
    const memo = dialog.getByLabel("관리자 전용 메모");
    await expect(memo).toHaveValue("기존 관리자 메모");

    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request?.url ?? String(input), window.location.origin);
        const method = init?.method ?? request?.method ?? "GET";
        if (method === "GET" && url.pathname === "/api/admin/batteries/b_pack_001") {
          return new Response(JSON.stringify({ error: { code: "TEMPORARY_FAILURE", message: "refresh failed" } }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    });

    await memo.fill("  Ｂ 저장 성공  ");
    const patchResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/batteries/b_pack_001/memo");
    await dialog.getByRole("button", { name: "메모 저장" }).click();
    expect((await patchResponse).ok()).toBe(true);
    await expect(dialog).toBeVisible();
    await expect(memo).toHaveValue("B 저장 성공");
  });
});
