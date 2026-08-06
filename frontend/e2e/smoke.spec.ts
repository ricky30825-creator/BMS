import { test, expect } from "@playwright/test";

test.describe("CellGuard public shell", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("renders the landing page at the mobile breakpoint", async ({ page }) => {
    await page.goto("/?mock=1");
    await expect(page.getByRole("heading", { name: /배터리의 이상을/ })).toBeVisible();
    await expect(page.locator("body")).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  });
});
