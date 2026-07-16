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

  test("opens a budget's detail and shows per-line progress + status", async ({ page }) => {
    const name = `Detail ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await page.fill('input[name="periodEnd"]', "2026-03-31");
    await page.fill('input[name="plannedAmount"]', "250");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    // Open the freshly created budget's detail page.
    await page.getByText(name).first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    // Planned total and a status pill render (spend is 0 → "Dans le budget").
    await expect(page.getByText("250,00", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/dans le budget/i).first()).toBeVisible();
  });
});
