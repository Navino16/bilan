import { test, expect } from "@playwright/test";

test.describe("categories", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create, edit and delete a category", async ({ page }) => {
    const name = `Cat ${Date.now()}`;
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /^créer$/i }).click();
    const row = page.locator('[data-slot="category-row"]').filter({ hasText: name });
    await expect(row.first()).toBeVisible();

    await row
      .first()
      .getByRole("button", { name: /actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await page.fill('input[name="name"]', `${name} edited`);
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(
      page
        .locator('[data-slot="category-row"]')
        .filter({ hasText: `${name} edited` })
        .first(),
    ).toBeVisible();

    await page
      .locator('[data-slot="category-row"]')
      .filter({ hasText: `${name} edited` })
      .first()
      .getByRole("button", { name: /actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    const dialog = page.locator('[data-slot="category-delete-dialog"]');
    await expect(dialog).toContainText("n'est utilisée nulle part");
    await dialog.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: `${name} edited` }),
    ).toHaveCount(0);
  });

  test("a sub-category can be nested under another sub-category", async ({ page }) => {
    const stamp = Date.now();
    const [root, child, leaf] = [`Root ${stamp}`, `Child ${stamp}`, `Leaf ${stamp}`];
    await page.goto("/fr/categories");
    for (const [name, parent] of [
      [root, null],
      [child, root],
      [leaf, child],
    ] as const) {
      await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
      await page.fill('input[name="name"]', name);
      if (parent) {
        const select = page.locator("#cat-parent");
        const value = await select.locator("option", { hasText: parent }).getAttribute("value");
        await select.selectOption(value!);
      }
      await page.getByRole("button", { name: /^créer$/i }).click();
      await expect(
        page.locator('[data-slot="category-row"]').filter({ hasText: name }),
      ).toBeVisible();
    }

    await page
      .locator('[data-slot="category-row"]')
      .filter({ hasText: root })
      .getByRole("button", { name: /actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    const dialog = page.locator('[data-slot="category-delete-dialog"]');
    await expect(dialog).toContainText("2 sous-catégories");
    await dialog.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: String(stamp) }),
    ).toHaveCount(0);
  });
});

test("unauthenticated /categories redirects to login", async ({ page }) => {
  await page.goto("/fr/categories");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Fcategories$/);
});
