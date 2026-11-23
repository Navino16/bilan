import { test, expect } from "@playwright/test";

test.describe("categorization learning", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("recategorizing a transaction offers to create a rule", async ({ page }) => {
    const stamp = Date.now();
    const label = `Leclerc ${stamp}`;
    await page.goto(`/fr/transactions?search=${stamp}`);
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-16");
    await page.fill('input[name="amount"]', "-30");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
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

  test("applies a new rule to existing transactions from the learning dialog", async ({ page }) => {
    const stamp = Date.now();
    const label = `Biocoop ${stamp}`;
    await page.goto(`/fr/transactions?search=${stamp}`);
    for (const amount of ["-21", "-22"]) {
      await page.getByRole("button", { name: /nouvelle transaction/i }).click();
      await page.fill('input[name="date"]', "2026-02-17");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.locator('input[name="label"]')).toHaveCount(0);
    }
    const rows = page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    await expect(rows).toHaveCount(2, { timeout: 15_000 });

    await rows.first().click();
    await page.locator('[data-slot="category-combobox"]').click();
    const choice = page.getByRole("menuitem").nth(1);
    const category = (await choice.innerText()).trim();
    await choice.click();

    await page.getByRole("button", { name: /créer la règle/i }).click();
    await expect(page.getByText("Appliquer aux transactions existantes ?")).toBeVisible();
    await expect(page.locator('[data-slot="rule-apply-manual"]')).toContainText(
      /1\s*catégorisée à la main/,
    );
    await page.getByRole("button", { name: /reclasser 1 transaction/i }).click();
    await expect(page.getByText("Appliquer aux transactions existantes ?")).toHaveCount(0);

    await page.goto(`/fr/transactions?search=${stamp}`);
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    for (const row of await rows.all()) await expect(row).toContainText(category);
  });

  test("the rule prompt survives its transaction leaving the filtered list (#351)", async ({
    page,
  }) => {
    const stamp = Date.now();
    const label = `Zorblax ${stamp}`;
    await page.goto(`/fr/transactions?search=${stamp}`);
    for (const amount of ["-11", "-12"]) {
      await page.getByRole("button", { name: /nouvelle transaction/i }).click();
      await page.fill('input[name="date"]', "2026-02-18");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.locator('input[name="label"]')).toHaveCount(0);
    }

    await page.goto(`/fr/transactions?search=${stamp}&categoryId=none`);
    const rows = page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    const prompt = page.getByText(/créer une règle pour les transactions/i);

    for (const remaining of [1, 0]) {
      await rows.first().click();
      await page.locator('[data-slot="category-combobox"]').click();
      await page.getByRole("menuitem").nth(1).click();
      await expect(rows).toHaveCount(remaining);
      await expect(prompt).toBeVisible();
      await page.getByRole("button", { name: "Non merci" }).click();
      await expect(prompt).toHaveCount(0);
    }

    await page.locator('[data-slot="category-filter-label"]').click();
    await page.getByRole("menuitem", { name: "Toutes les catégories" }).click();
    await expect(rows).toHaveCount(2);
    await expect(prompt).toHaveCount(0);
  });
});
