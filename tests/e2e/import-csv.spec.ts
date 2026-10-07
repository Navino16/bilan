import { test, expect } from "@playwright/test";

test.describe("CSV import (wizard)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("a Latin-1 file is read, and remapping a column refreshes the preview", async ({ page }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit;Note
07/03/2026;PRÉLÈVEMENT ÉDF ${stamp};55,00;;A
bad;LIGNE ${stamp};1,00;;B`;
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith("/api/import/csv") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "latin1.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "latin1"),
    });
    await uploaded;
    const rows = page.locator('[data-slot="import-preview-row"]');
    await expect(rows.filter({ hasText: `PRÉLÈVEMENT ÉDF ${stamp}` }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-slot="import-rejected"]')).toContainText(
      "1 ligne illisible ignorée",
    );

    // Mapping the label to the "Note" column re-previews with it.
    const remapped = page.waitForResponse((r) => r.url().endsWith("/preview"), {
      timeout: 30_000,
    });
    await page.getByLabel("Libellé", { exact: true }).selectOption("Note");
    await remapped;
    await expect(rows.filter({ hasText: `PRÉLÈVEMENT ÉDF ${stamp}` })).toHaveCount(0);
    await expect(rows.first()).toContainText("A");
  });

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

    // Exclude the second row (the credit) before validating.
    await page
      .locator('[data-slot="import-preview-row"]')
      .filter({ hasText: `VIR IMPORT ${stamp}` })
      .locator('input[type="checkbox"]:visible')
      .uncheck();

    const committed = page.waitForResponse(
      (r) => r.url().includes("/commit") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /valider l'import/i }).click();
    await committed;
    await page.getByRole("link", { name: /voir les transactions/i }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/transactions/, { timeout: 30_000 });
    await page.goto(`/fr/transactions?search=${stamp}`);

    // The kept row is imported; the excluded one is not.
    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: `CB IMPORT ${stamp}` })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: `VIR IMPORT ${stamp}` }),
    ).toHaveCount(0);
  });

  test("undo a committed import from the summary, then see it in the history", async ({ page }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit
09/03/2026;CB UNDO ${stamp};12,00;
10/03/2026;CB UNDO BIS ${stamp};8,00;`;

    await page.goto("/fr/import");
    const uploaded = page.waitForResponse(
      (r) => r.url().includes("/api/import/csv") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: `undo-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await uploaded;
    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
      timeout: 15_000,
    });

    const committed = page.waitForResponse(
      (r) => r.url().includes("/commit") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /valider l'import/i }).click();
    await committed;

    const dialog = page.locator('[data-slot="revert-import-dialog"]');
    await expect(async () => {
      await page.getByRole("button", { name: /annuler l'import/i }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog).toContainText("2 transactions seront supprimées");
    await dialog.getByRole("button", { name: /supprimer les transactions/i }).click();
    await expect(page.getByText(/import annulé/i)).toBeVisible({ timeout: 15_000 });

    await page.goto(`/fr/transactions?search=${stamp}`);
    await expect(page.getByRole("heading", { level: 1, name: /transactions/i })).toBeVisible();
    await expect(page.locator('[data-slot="transaction-row"]')).toHaveCount(0);

    await page.goto("/fr/import");
    await expect(
      page.locator('[data-slot="import-history-row"]', { hasText: `undo-${stamp}.csv` }),
    ).toContainText("Annulé");
  });

  test("a header-only file is refused with a clear message", async ({ page }) => {
    await page.goto("/fr/import");
    await page.locator('input[type="file"]').setInputFiles({
      name: "header-only.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Date;Libellé;Montant\n", "utf8"),
    });
    await expect(page.getByText("Aucune opération trouvée dans ce fichier.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-slot="import-preview-row"]')).toHaveCount(0);
  });

  test("a dropped long file is previewed page by page", async ({ page }) => {
    const stamp = Date.now();
    const lines = Array.from(
      { length: 60 },
      (_, i) => `${String(1 + (i % 28)).padStart(2, "0")}/05/2019;CB PAGE ${stamp} N${i};1,00;`,
    );
    const csv = `Date;Libellé;Débit;Crédit\n${lines.join("\n")}`;
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    const dataTransfer = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "dropped.csv", { type: "text/csv" }));
      return dt;
    }, csv);
    await page.locator('[data-slot="import-dropzone"]').dispatchEvent("drop", { dataTransfer });
    await uploaded;

    const rows = page.locator('[data-slot="import-preview-row"]');
    await expect(rows).toHaveCount(50, { timeout: 15_000 });
    const pager = page.locator('[data-slot="import-pager"]');
    await expect(pager).toContainText("Lignes 1 à 50 sur 60");
    await pager.getByRole("button", { name: /suivantes/i }).click();
    await expect(pager).toContainText("Lignes 51 à 60 sur 60");
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText(`CB PAGE ${stamp} N50`);
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("re-uploading an imported file locks its duplicates and disables validation", async ({
    page,
  }) => {
    const stamp = Date.now();
    const file = {
      name: `dup-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(`Date;Libellé;Débit;Crédit\n03/06/2019;CB DUP ${stamp};4,00;`, "utf8"),
    };
    const upload = async () => {
      await page.goto("/fr/import");
      const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
        timeout: 30_000,
      });
      await page.locator('input[type="file"]').setInputFiles(file);
      await uploaded;
      await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
        timeout: 15_000,
      });
    };
    await upload();
    const committed = page.waitForResponse((r) => r.url().includes("/commit"), {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /valider l'import/i }).click();
    await committed;
    await expect(page.getByRole("link", { name: /voir les transactions/i })).toBeVisible();

    await upload();
    const box = page
      .locator('[data-slot="import-preview-row"]')
      .locator('input[type="checkbox"]:visible');
    await expect(box).not.toBeChecked();
    await expect(box).toBeDisabled();
    await expect(page.getByRole("button", { name: /valider l'import/i })).toBeDisabled();
    await expect(page.getByText(/rien à importer/i)).toBeVisible();
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });
});
