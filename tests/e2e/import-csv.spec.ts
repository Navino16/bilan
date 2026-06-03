import { test, expect } from "@playwright/test";

test.describe("CSV import", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("upload → preview → commit → see imported transactions", async ({ page }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit
07/03/2026;CB IMPORT ${stamp};19,99;
08/03/2026;VIR IMPORT ${stamp};;100,00`;

    await page.goto("/fr/import/csv");
    // Upload via the hidden file input.
    await page.locator('input[type="file"]').setInputFiles({
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    // Preview appears.
    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible();

    await page.getByRole("button", { name: /^importer$/i }).click();
    await page.getByRole("link", { name: /voir les transactions/i }).click();

    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: `CB IMPORT ${stamp}` })
        .first(),
    ).toBeVisible();
  });
});
