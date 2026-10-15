import { test, expect } from "@playwright/test";

test.describe("categorization rules", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("create a rule, see its hits grow on a manual entry, then delete it", async ({ page }) => {
    const pattern = `RULE${Date.now()}`;
    await page.goto("/fr/categories");

    await page.getByRole("button", { name: /^Règles/ }).click();
    await page.getByRole("button", { name: /nouvelle règle/i }).click();

    await page.getByLabel(/motif/i).fill(pattern);
    // Pick the first real category in the combobox (skip "Sans catégorie").
    await page.locator('[data-slot="category-combobox"]').click();
    await page.getByRole("menuitem").nth(1).click();
    await page.getByRole("button", { name: /enregistrer/i }).click();

    const row = page.locator('[data-slot="rule-row"]').filter({ hasText: pattern });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("0 utilisation");

    await page.goto(`/fr/transactions?search=${pattern}`);
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-16");
    await page.fill('input[name="amount"]', "-12");
    await page.fill('input[name="label"]', `CB ${pattern}`);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: pattern }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
    await expect(row).toContainText("1 utilisation");

    await row.getByRole("button", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="confirm-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(page.locator('[data-slot="rule-row"]').filter({ hasText: pattern })).toHaveCount(
      0,
    );
  });

  test("« Nouvelle règle » opens blank after a cancel or a save (#227)", async ({ page }) => {
    const pattern = `BLANK${Date.now()}`;
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
    const dialog = page.getByRole("dialog");
    const patternInput = dialog.getByLabel(/motif/i);
    const priority = dialog.getByLabel(/priorité/i);
    const row = page.locator('[data-slot="rule-row"]').filter({ hasText: pattern });

    try {
      await page.getByRole("button", { name: /nouvelle règle/i }).click();
      await patternInput.fill("draft");
      await priority.fill("7");
      await dialog.getByRole("button", { name: /annuler/i }).click();
      await expect(dialog).toBeHidden();

      await page.getByRole("button", { name: /nouvelle règle/i }).click();
      await expect(patternInput).toHaveValue("");
      await expect(priority).toHaveValue("100");
      await patternInput.fill(pattern);
      await dialog.locator('[data-slot="category-combobox"]').click();
      await page.getByRole("menuitem").nth(1).click();
      await dialog.getByRole("button", { name: /enregistrer/i }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toHaveCount(1);

      await page.getByRole("button", { name: /nouvelle règle/i }).click();
      await expect(patternInput).toHaveValue("");
      await expect(dialog.getByRole("button", { name: /enregistrer/i })).toBeDisabled();
      await dialog.getByRole("button", { name: /annuler/i }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await page.keyboard.press("Escape");
      if (await row.count()) {
        await row.getByRole("button", { name: /supprimer/i }).click();
        await page
          .locator('[data-slot="confirm-dialog"]')
          .getByRole("button", { name: /^supprimer$/i })
          .click();
        await expect(row).toHaveCount(0);
      }
    }
  });

  test.describe("on mobile", () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test("the info line shows the priority, without a leading separator (#230)", async ({
      page,
    }) => {
      const pattern = `MOB${Date.now()}`;
      await page.goto("/fr/categories");
      await page.getByRole("button", { name: /^Règles/ }).click();
      await page.getByRole("button", { name: /nouvelle règle/i }).click();
      await page.getByLabel(/motif/i).fill(pattern);
      await page.locator('[data-slot="category-combobox"]').click();
      await page.getByRole("menuitem").nth(1).click();
      await page.getByRole("button", { name: /enregistrer/i }).click();

      const row = page.locator('[data-slot="rule-row"]').filter({ hasText: pattern });
      await expect(row.locator('[data-slot="rule-meta"]')).toHaveText(
        /^Priorité \d+\s·\s\S.*\s·\s0 utilisation$/,
      );

      await row.getByRole("button", { name: /supprimer/i }).click();
      await page
        .locator('[data-slot="confirm-dialog"]')
        .getByRole("button", { name: /^supprimer$/i })
        .click();
      await expect(row).toHaveCount(0);
    });
  });

  test("the scope list only offers foyers where the user may create rules (#223)", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
    await page.getByRole("button", { name: /nouvelle règle/i }).click();
    await expect(page.locator("#rule-scope option", { hasText: "E2E Shared" })).toHaveCount(1);

    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    try {
      const mp = await memberCtx.newPage();
      await mp.goto("/fr/categories");
      await mp.getByRole("button", { name: /^Règles/ }).click();
      await mp.getByRole("button", { name: /nouvelle règle/i }).click();
      await expect(mp.getByLabel(/motif/i)).toBeVisible();
      await expect(mp.locator("#rule-scope option", { hasText: "E2E Shared" })).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
