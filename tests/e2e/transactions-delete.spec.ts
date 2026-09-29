import { test, expect, type Page } from "@playwright/test";

const row = (page: Page, label: string) =>
  page.locator('[data-slot="transaction-row"]').filter({ hasText: label });

async function addTransaction(page: Page, stamp: number, label: string) {
  await page.goto(`/fr/transactions?search=${stamp}`);
  await expect(async () => {
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await expect(page.locator('input[name="date"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="date"]', "2026-03-03");
  await page.fill('input[name="amount"]', "-12");
  await page.fill('input[name="label"]', label);
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(row(page, label).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("delete transactions", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("deletes a transaction from its detail panel", async ({ page }) => {
    const stamp = Date.now();
    const label = `Suppr ${stamp}`;
    await addTransaction(page, stamp, label);

    await row(page, label).first().click();
    await page.getByRole("button", { name: /supprimer la transaction/i }).click();
    const dialog = page.locator('[data-slot="delete-transactions-dialog"]');
    await expect(dialog.getByText(/sera supprimée définitivement/i)).toBeVisible();
    await dialog.getByRole("button", { name: /^supprimer$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(row(page, label)).toHaveCount(0, { timeout: 15_000 });
  });

  test("deletes the selected transactions", async ({ page }) => {
    const stamp = Date.now();
    const labels = [`Lot un ${stamp}`, `Lot deux ${stamp}`];
    for (const label of labels) await addTransaction(page, stamp, label);

    await expect(async () => {
      await page.getByRole("button", { name: /^sélectionner$/i }).click();
      await expect(page.locator('[data-slot="selection-bar"]')).toBeVisible();
    }).toPass();
    for (const label of labels) await row(page, label).first().click();
    const bar = page.locator('[data-slot="selection-bar"]');
    await expect(bar).toContainText("2 sélectionnées");
    await bar.getByRole("button", { name: /^supprimer$/i }).click();

    const dialog = page.locator('[data-slot="delete-transactions-dialog"]');
    await expect(dialog.getByText(/2 transactions seront supprimées/i)).toBeVisible();
    await dialog.getByRole("button", { name: /^supprimer$/i }).click();

    await expect(bar).toBeHidden();
    for (const label of labels) await expect(row(page, label)).toHaveCount(0, { timeout: 15_000 });
  });
});
