import { test, expect } from "@playwright/test";

// Verifies the Phase-8.3 responsive bottom-sheets: on a mobile viewport the
// account/group create dialogs render as a `Sheet side="bottom"` and open on
// click. Runs on Chromium at a 390px viewport — Playwright's WebKit driver can't
// drive taps in this env (the whole interactive suite is WebKit-skipped), so the
// `mobile` (WebKit) project can only assert non-interactive things; Chromium at a
// mobile viewport gives reliable interaction plus the mobile media query.
test.describe("mobile bottom-sheets", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json", viewport: { width: 390, height: 844 } });
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only mobile-viewport probe");

  async function openViaTrigger(page: import("@playwright/test").Page, triggerName: RegExp) {
    // Retry the first click until the popup mounts (absorbs the hydration race:
    // a click before the island hydrates is a no-op).
    await expect(async () => {
      await page.getByRole("button", { name: triggerName }).click();
      await expect(page.locator('[data-slot="sheet-content"][data-side="bottom"]')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 20_000 });
  }

  test("account create opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/accounts", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouveau compte/i);
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test("group create opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/groups", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouveau foyer/i);
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test("category create opens a bottom sheet with wrapping swatches", async ({ page }) => {
    await page.goto("/fr/categories", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouvelle catégorie/i);
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet.getByRole("radio", { name: "Vert sauge" })).toBeChecked();
    const swatches = sheet.locator('[data-slot="category-color-swatches"]');
    const box = await swatches.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test("category edit from the row menu opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/categories", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const menu = page
      .locator('[data-slot="category-row"]')
      .first()
      .getByRole("button", { name: /actions pour/i });
    await expect(async () => {
      await menu.click();
      await expect(page.getByRole("menuitem", { name: /modifier/i })).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await expect(page.locator('[data-slot="sheet-content"][data-side="bottom"]')).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test("budget create opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/budgets", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouveau budget/i);
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet.locator('input[name="name"]')).toBeVisible();
    await expect(sheet.getByRole("button", { name: /créer le budget/i })).toBeVisible();
  });

  test("rule create opens a bottom sheet that fits 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/fr/categories", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const newRule = page.getByRole("button", { name: /nouvelle règle/i });
    await expect(async () => {
      await page.getByRole("button", { name: /^Règles/ }).click();
      await expect(newRule).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await openViaTrigger(page, /nouvelle règle/i);
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet.getByLabel(/motif/i)).toBeVisible();

    const tops = await Promise.all(
      (await sheet.locator("button[aria-pressed]").all()).map(
        async (b) => (await b.boundingBox())!.y,
      ),
    );
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
    const scope = sheet.locator("#rule-scope");
    if ((await scope.count()) > 0) {
      expect((await scope.boundingBox())!.width).toBeGreaterThan(200);
    }
  });

  test("the rule learning prompt opens as a bottom sheet", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const label = `Sheetprompt ${stamp}`;
    await page.goto(`/fr/transactions?search=${stamp}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await openViaTrigger(page, /nouvelle transaction/i);
    await page.fill('input[name="date"]', "2026-02-16");
    await page.fill('input[name="amount"]', "-30");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const combobox = page.locator('[data-slot="sheet-content"] [data-slot="category-combobox"]');
    await expect(async () => {
      await row.click();
      await expect(combobox).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await combobox.click();
    await page.getByRole("menuitem", { name: "Restaurants", exact: true }).click();

    const prompt = page.locator('[data-slot="sheet-content"][data-side="bottom"]', {
      hasText: /créer une règle pour les transactions/i,
    });
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await prompt.getByRole("button", { name: "Non merci" }).click();
    await expect(prompt).toHaveCount(0);
  });

  test("transaction filters live in a bottom sheet and combine", async ({ page }) => {
    await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
    // Only search + the « Filtres » button stay inline on mobile.
    await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeHidden();
    await openViaTrigger(page, /^filtres/i);

    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.getByRole("button", { name: "Sorties", exact: true }).click();
    await expect(page).toHaveURL(/dir=out/);
    // A period keeps the other filters.
    await sheet.getByRole("button", { name: "Trimestre", exact: true }).click();
    await expect(page).toHaveURL(/from=.*&to=/);
    expect(page.url()).toContain("dir=out");

    await sheet.getByRole("button", { name: /^(voir|aucune)/i }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: /^filtres/i })).toContainText("2");
  });
});
