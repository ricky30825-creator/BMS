import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login?mock=1");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(email === "lee@lab.io" ? /\/admin$/ : /\/battery$/);
}

test.describe("공지사항 production-shaped API flow (MSW)", () => {
  test("관리자가 임시저장·게시·보관하고 사용자는 게시 공지만 조회한다", async ({ page }) => {
    await signIn(page, "lee@lab.io");
    await page.getByRole("button", { name: "공지사항 관리" }).click();
    await expect(page.getByRole("heading", { name: "공지사항 관리" })).toBeVisible();

    await page.getByRole("button", { name: "+ 새 공지 작성" }).click();
    const editor = page.getByRole("dialog", { name: "새 공지 작성" });
    await editor.getByLabel("카테고리").selectOption("FEATURE");
    await editor.getByLabel("노출 대상").selectOption("USER");
    await editor.getByLabel("제목").fill("공지 E2E 제목");
    await editor.getByLabel("내용").fill("공지 E2E 본문");
    await editor.getByRole("button", { name: "임시 저장" }).click();
    await expect(editor).toHaveCount(0);

    const draftRow = page.getByRole("row").filter({ hasText: "공지 E2E 제목" });
    await expect(draftRow).toContainText("임시 저장");
    await draftRow.getByRole("button", { name: "수정" }).click();
    const publishEditor = page.getByRole("dialog", { name: "공지 수정" });
    await publishEditor.getByText("게시와 동시에 웹푸시·카카오 발송 의도 남기기", { exact: false }).click();
    await publishEditor.getByRole("button", { name: "게시" }).click();
    await expect(publishEditor).toHaveCount(0);

    const publishedRow = page.getByRole("row").filter({ hasText: "공지 E2E 제목" });
    await expect(publishedRow).toContainText("게시");
    page.once("dialog", (dialog) => void dialog.accept());
    await publishedRow.getByRole("button", { name: "보관" }).click();
    await expect(page.getByRole("row").filter({ hasText: "공지 E2E 제목" })).toContainText("보관");

    await page.getByRole("button", { name: "로그아웃" }).last().click();
    await signIn(page, "hong@cellguard.io");
    const publicResponse = await page.evaluate(async () => {
      const response = await fetch("/api/notices");
      return { status: response.status, body: await response.json() };
    });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body.items.some((item: { id: string }) => item.id === "n_draft")).toBe(false);
  });
});
