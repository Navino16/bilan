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
      .getByRole("button", { name: /modifier/i })
      .click();
    await page.fill('input[name="name"]', `${name} edited`);
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(
      page
        .locator('[data-slot="category-row"]')
        .filter({ hasText: `${name} edited` })
        .first(),
    ).toBeVisible();

    page.on("dialog", (d) => d.accept());
    await page
      .locator('[data-slot="category-row"]')
      .filter({ hasText: `${name} edited` })
      .first()
      .getByRole("button", { name: /supprimer/i })
      .click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: `${name} edited` }),
    ).toHaveCount(0);
  });
});

test("unauthenticated /categories redirects to login", async ({ page }) => {
  await page.goto("/fr/categories");
  await expect(page).toHaveURL(/\/login$/);
});
