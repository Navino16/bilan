import { test, expect } from "@playwright/test";

test.describe("categorization rules", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("create a rule from the Règles tab, see it listed, then delete it", async ({ page }) => {
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

    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: /supprimer/i }).click();
    await expect(page.locator('[data-slot="rule-row"]').filter({ hasText: pattern })).toHaveCount(
      0,
    );
  });
});
