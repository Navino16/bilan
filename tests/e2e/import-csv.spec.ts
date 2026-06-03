import { test, expect } from "@playwright/test";

test.describe("CSV import (wizard)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("upload → preview → validate → see imported transactions", async ({ page }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit
07/03/2026;CB IMPORT ${stamp};19,99;
08/03/2026;VIR IMPORT ${stamp};;100,00`;

    await page.goto("/fr/import");
    // Wait for the upload response so a cold route compile doesn't race the assertion.
    const uploaded = page.waitForResponse(
      (r) => r.url().includes("/api/import/csv") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await uploaded;

    // Preview appears with the enriched rows.
    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /valider l'import/i }).click();
    await page.getByRole("link", { name: /voir les transactions/i }).click();

    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: `CB IMPORT ${stamp}` })
        .first(),
    ).toBeVisible();
  });
});
