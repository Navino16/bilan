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

  // Uploads a real (synthetic, non-sensitive) PDF — exercises the pdfjs worker
  // path end-to-end so a bundling regression (PARSE_FAILED) is caught in CI.
  test("upload a PDF → preview → validate → see an imported transaction", async ({ page }) => {
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse(
      (r) => r.url().includes("/api/import/pdf") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/statement.pdf");
    const res = await uploaded;
    expect(res.ok()).toBe(true);

    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
      timeout: 15_000,
    });

    const committed = page.waitForResponse(
      (r) => r.url().includes("/commit") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /valider l'import/i }).click();
    await committed;
    await page.getByRole("link", { name: /voir les transactions/i }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/transactions/, { timeout: 30_000 });
    await page.goto("/fr/transactions?search=acme");

    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: "ACME STORE" }).first(),
    ).toBeVisible();

    // Undo it, so a rerun doesn't meet its rows as duplicates (nothing to import).
    await page.goto("/fr/import");
    const row = page.locator('[data-slot="import-history-row"]', { hasText: "statement.pdf" });
    await expect(async () => {
      await row.first().getByRole("button").click();
      await page.getByRole("menuitem", { name: /annuler l'import/i }).click({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: /supprimer les transactions/i }).click();
    await expect(row.first()).toContainText("Annulé", { timeout: 15_000 });
  });

  test("legacy /import/pdf redirects to the unified wizard", async ({ page }) => {
    await page.goto("/fr/import/pdf");
    await expect(page).toHaveURL(/\/import$/);
  });
});

test("unauthenticated /import redirects to login", async ({ page }) => {
  await page.goto("/fr/import");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Fimport$/);
});
