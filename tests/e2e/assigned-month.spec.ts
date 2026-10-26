import { test, expect } from "@playwright/test";

test.describe("assigned month (#341)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("assigns a transaction to another month and back to automatic", async ({ page }) => {
    const stamp = Date.now();
    const label = `Prime ${stamp}`;
    await page.goto("/fr/transactions");
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-27");
    await page.fill('input[name="amount"]', "300");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    await page.goto(`/fr/transactions?search=${stamp}`);
    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
    await row.click();

    await page.getByLabel("Mois d’affectation").fill("2026-03");
    await expect(row.getByText("Compté en mars 2026").first()).toBeVisible();

    await page.getByRole("button", { name: "Revenir en automatique" }).click();
    await expect(row.getByText(/Compté en/)).toHaveCount(0);
  });
});
