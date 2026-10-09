import { test, expect } from "@playwright/test";

test.describe("categories on a shared account", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("a READ member sees the owner's category, without a picker", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const category = `Cat159 ${stamp}`;
    const account = `Partagé159 ${stamp}`;
    const label = `TX159 ${stamp}`;

    await page.goto("/fr/categories");
    await expect(async () => {
      await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.fill('input[name="name"]', category);
    await page.getByRole("button", { name: /créer la catégorie/i }).click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: category }).first(),
    ).toBeVisible();

    await page.goto("/fr/accounts");
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await page.fill('input[name="name"]', account);
    await page.fill('input[name="initialBalance"]', "0");
    await page.getByRole("button", { name: /créer le compte/i }).click();
    const card = page.locator('[data-slot="card"]').filter({ hasText: account }).last();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /^actions pour/i }).click();
    await page.getByRole("menuitem", { name: /partager/i }).click();
    await page.getByLabel("E2E Shared").selectOption("READ");
    await expect(page.getByLabel("E2E Shared")).toHaveValue("READ");
    await page.keyboard.press("Escape");

    await card.getByRole("button", { name: /saisir une transaction/i }).click();
    await page.fill('input[name="date"]', "2019-07-01");
    await page.fill('input[name="amount"]', "-12");
    await page.fill('input[name="label"]', label);
    await page.locator('[data-slot="category-combobox"]').click();
    await page.getByRole("menuitem", { name: category }).click();
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    try {
      const mp = await memberCtx.newPage();
      await mp.goto(`/fr/transactions?search=${stamp}`);
      const row = mp.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
      await expect(row).toContainText(category, { timeout: 15_000 });

      const readOnly = mp.locator('[data-slot="category-readonly"]');
      await expect(async () => {
        await row.click();
        await expect(readOnly).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      await expect(readOnly).toContainText(category);
      await expect(readOnly).toContainText("lecture seule");
      await expect(mp.locator('[data-slot="category-combobox"]')).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
