import { test, expect } from "@playwright/test";

test.describe("import wizard", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("shows the stepper and an upload affordance", async ({ page }) => {
    await page.goto("/fr/import");
    await expect(page.getByRole("heading", { name: /importer un relevé/i })).toBeVisible();
    await expect(page.getByText(/^Fichier$/)).toBeVisible();
    await expect(page.getByText(/Correspondances/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
  });

  test("legacy /import/pdf redirects to the unified wizard", async ({ page }) => {
    await page.goto("/fr/import/pdf");
    await expect(page).toHaveURL(/\/import$/);
  });
});

test("unauthenticated /import redirects to login", async ({ page }) => {
  await page.goto("/fr/import");
  await expect(page).toHaveURL(/\/login$/);
});
