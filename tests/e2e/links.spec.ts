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

  test("accepts a suggested pair and persists an ignore", async ({ page }) => {
    const stamp = Date.now();
    const exp = `Sugg exp ${stamp}`;
    const ref = `Sugg ref ${stamp}`;
    // A per-run unique amount so exactly one +X/-X pair exists on the dev DB
    // (runs accumulate rows) — after ignoring, the +X leg has no other -X to
    // re-pair with, so the suggestion truly disappears.
    const amt = 10000 + (stamp % 80000) + stamp / 1e13; // e.g. 4XXXX.xx, distinct
    const uniq = amt.toFixed(2);
    for (const [label, amount] of [
      [exp, `-${uniq}`],
      [ref, uniq],
    ] as const) {
      await page.goto("/fr/transactions");
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-04-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Navigate to the suggestions route, retrying the load: a freshly
    // (re)started dev server can transiently 404 the new segment before
    // Turbopack compiles it.
    await expect(async () => {
      await page.goto("/fr/transactions/suggestions");
      await expect(page.getByRole("heading", { name: /suggestions de liens/i })).toBeVisible();
    }).toPass({ timeout: 30_000 });
    // Match this run's pair by its unique per-run label (the row shows both legs'
    // labels), not by amount — pairs accumulate across runs on the dev DB.
    const row = page.locator('[data-slot="suggestion-row"]').filter({ hasText: ref }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /ignorer/i }).click();
    // After ignoring, that pair no longer appears on reload.
    await expect(async () => {
      await page.goto("/fr/transactions/suggestions");
      await expect(
        page.locator('[data-slot="suggestion-row"]').filter({ hasText: ref }),
      ).toHaveCount(0);
    }).toPass({ timeout: 30_000 });
  });
});
