import { test, expect } from "@playwright/test";

test.describe("categorization learning", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("recategorizing a transaction offers to create a rule", async ({ page }) => {
    const label = `Leclerc ${Date.now()}`;
    await page.goto("/fr/transactions");
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-16");
    await page.fill('input[name="amount"]', "-30");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    // Open the detail panel, open its category combobox and pick the first real
    // category (menu item 0 is "no category").
    await row.click();
    await page.locator('[data-slot="category-combobox"]').click();
    await page.getByRole("menuitem").nth(1).click();

    // The "create a rule?" learning dialog appears; confirm it.
    await expect(page.getByText(/créer une règle pour les transactions/i)).toBeVisible();
    await page.getByRole("button", { name: /créer la règle/i }).click();
    await expect(page.getByText(/créer une règle pour les transactions/i)).toHaveCount(0);
  });
});
