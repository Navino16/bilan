import { test, expect } from "@playwright/test";

test.describe("manual entry from accounts", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("adds a transaction from an account card with the account preselected", async ({ page }) => {
    const label = `Loyer ${Date.now()}`;
    await page.goto("/fr/accounts");
    // Open the per-account "add transaction" dialog (first writable account).
    await page
      .getByRole("button", { name: /saisir une transaction/i })
      .first()
      .click();
    await page.fill('input[name="date"]', "2026-03-01");
    await page.fill('input[name="amount"]', "-742");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    // Wait for the create to finish — the dialog closes on success — before
    // navigating, otherwise the goto races/aborts the server action.
    await expect(page.locator('input[name="label"]')).toBeHidden();

    // It lands in the transactions list (allow for a cold /transactions compile).
    await page.goto("/fr/transactions");
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
