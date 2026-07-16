import { test, expect } from "@playwright/test";

test.describe("budgets", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "Dialog flow deferred to Phase 8.3");

  test("create a personal budget with a line and see it listed", async ({ page }) => {
    const name = `Budget ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await page.fill('input[name="periodEnd"]', "2026-03-31");
    await page.fill('input[name="plannedAmount"]', "300");
    await page.getByRole("button", { name: /créer le budget/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });
});
