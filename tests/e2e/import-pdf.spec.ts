import { test, expect } from "@playwright/test";

test.describe("PDF import", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("PDF tab shows supported banks and an upload affordance", async ({ page }) => {
    await page.goto("/fr/import/csv");
    await page.getByRole("link", { name: /^pdf$/i }).click();
    await expect(page).toHaveURL(/\/import\/pdf$/);
    await expect(page.getByText(/banques prises en charge/i)).toBeVisible();
    await expect(page.getByText(/Revolut/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
  });
});

test("unauthenticated /import/pdf redirects to login", async ({ page }) => {
  await page.goto("/fr/import/pdf");
  await expect(page).toHaveURL(/\/login$/);
});
