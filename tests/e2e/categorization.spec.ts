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
    // Pick the first real category in the row's select.
    await row.locator("select").selectOption({ index: 1 });

    // The "create a rule?" dialog appears.
    await expect(page.getByRole("dialog")).toContainText(/créer une règle/i);
    await page.getByRole("button", { name: /créer la règle/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
