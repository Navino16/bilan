import { test, expect } from "@playwright/test";

test.describe("transaction links", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven link flow deferred to Phase 8.3",
  );

  test("link two transactions via link mode and see them badged", async ({ page }) => {
    const stamp = Date.now();
    const expense = `Achat ${stamp}`;
    const refund = `Remb ${stamp}`;

    // Seed an expense and its refund.
    for (const [label, amount] of [
      [expense, "-60"],
      [refund, "60"],
    ] as const) {
      await page.goto("/fr/transactions");
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-03-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Enter link mode, select both, confirm.
    await expect(async () => {
      await page.getByRole("button", { name: /mode lien/i }).click();
      await expect(page.getByText(/sélectionnez au moins deux/i)).toBeVisible();
    }).toPass();
    await page
      .locator('[data-slot="transaction-row"]')
      .filter({ hasText: expense })
      .first()
      .click();
    await page.locator('[data-slot="transaction-row"]').filter({ hasText: refund }).first().click();
    await page.getByRole("button", { name: /^lier$/i }).click();

    // The expense row shows the "Liée" badge (the row renders both a desktop and
    // a mobile layout, so the badge appears twice in the DOM — assert the first).
    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: expense })
        .getByText("Liée")
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
