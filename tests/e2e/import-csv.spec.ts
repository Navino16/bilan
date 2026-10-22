import { test, expect } from "@playwright/test";

// A committed row with the same day + amount as an earlier one is a probable duplicate,
// skipped by default: amounts derive from the run's stamp so the persistent e2e DB's
// rows from earlier runs never match.
function runAmount(stamp: number): string {
  const cents = 100 + (stamp % 9_000_000);
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

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
07/03/2026;CB IMPORT ${stamp};${runAmount(stamp)};
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
    await page.getByRole("button", { name: /valider l’import/i }).click();
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
    await page.getByRole("button", { name: /valider l’import/i }).click();
    await committed;

    const dialog = page.locator('[data-slot="revert-import-dialog"]');
    await expect(async () => {
      await page.getByRole("button", { name: /annuler l’import/i }).click();
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
    await expect(page.getByText("Aucune transaction trouvée dans ce fichier.")).toBeVisible({
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
      buffer: Buffer.from(
        `Date;Libellé;Débit;Crédit\n03/06/2019;CB DUP ${stamp};${runAmount(stamp)};`,
        "utf8",
      ),
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
    await page.getByRole("button", { name: /valider l’import/i }).click();
    await committed;
    await expect(page.getByRole("link", { name: /voir les transactions/i })).toBeVisible();

    await upload();
    const box = page
      .locator('[data-slot="import-preview-row"]')
      .locator('input[type="checkbox"]:visible');
    await expect(box).not.toBeChecked();
    await expect(box).toBeDisabled();
    await expect(page.getByRole("button", { name: /valider l’import/i })).toBeDisabled();
    await expect(page.getByText(/rien à importer/i)).toBeVisible();
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("probable duplicates are flagged, skipped by default and imported once ticked", async ({
    page,
  }) => {
    const stamp = Date.now();
    const amount = runAmount(stamp);
    const rows = page.locator('[data-slot="import-preview-row"]');
    const box = (label: string) =>
      rows.filter({ hasText: label }).locator('input[type="checkbox"]:visible');
    const upload = async (name: string, lines: string[]) => {
      await page.goto("/fr/import");
      const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
        timeout: 30_000,
      });
      await page.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: "text/csv",
        buffer: Buffer.from(`Date;Libellé;Montant\n${lines.join("\n")}`, "utf8"),
      });
      await uploaded;
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    };
    const validate = async () => {
      const committed = page.waitForResponse((r) => r.url().includes("/commit"), {
        timeout: 30_000,
      });
      await page.getByRole("button", { name: /valider l’import/i }).click();
      const sent = (await committed).request().postDataJSON();
      await expect(page.getByRole("link", { name: /voir les transactions/i })).toBeVisible();
      return sent;
    };
    const listed = async (label: string) => {
      await page.goto(`/fr/transactions?search=${stamp}`);
      await expect(page.getByRole("heading", { level: 1, name: /transactions/i })).toBeVisible();
      return page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    };

    await upload(`probable-a-${stamp}.csv`, [
      `02/03/2026;CB SHOP ONE ${stamp};-${amount}`,
      `02/03/2026;PRLV OTHER ${stamp};-${amount}`,
    ]);
    await validate();

    const second = [
      `02/03/2026;CB  SHOP ONE ${stamp};-${amount}`,
      `02/03/2026;CB SHOP TWO ${stamp};-${amount}`,
      `02/03/2026;VIR FRESH ${stamp};${amount}`,
    ];
    await upload(`probable-b-${stamp}.csv`, second);
    const probable = page.locator('[data-slot="import-probable"]');
    await expect(probable).toContainText("1 doublon probable à vérifier");
    const two = rows.filter({ hasText: `CB SHOP TWO ${stamp}` });
    await expect(two.getByText("Doublon probable").first()).toBeVisible();
    await expect(
      two.getByText(`Déjà dans le compte : PRLV OTHER ${stamp}`, { exact: true }).first(),
    ).toBeVisible();
    await expect(box(`CB SHOP TWO ${stamp}`)).not.toBeChecked();
    await expect(box(`CB SHOP TWO ${stamp}`)).toBeEnabled();
    expect((await validate()).includedProbableIds).toEqual([]);
    await expect((await listed(`VIR FRESH ${stamp}`)).first()).toBeVisible();
    await expect(await listed(`CB SHOP TWO ${stamp}`)).toHaveCount(0);

    await upload(`probable-c-${stamp}.csv`, second);
    await expect(rows).toHaveCount(3);
    const filtered = page.waitForResponse((r) => r.url().endsWith("/preview"), {
      timeout: 30_000,
    });
    const filters = page.getByRole("group", { name: "Filtrer l'aperçu" });
    await filters.getByRole("button", { name: "Doublons probables (1)" }).click();
    expect((await filtered).request().postDataJSON().filter).toBe("probable");
    await expect(rows).toHaveCount(1);
    await box(`CB SHOP TWO ${stamp}`).check();
    await filters.getByRole("button", { name: "Toutes (3)" }).click();
    await expect(rows).toHaveCount(3);
    await expect(box(`CB SHOP TWO ${stamp}`)).toBeChecked();
    expect((await validate()).includedProbableIds).toHaveLength(1);
    await expect((await listed(`CB SHOP TWO ${stamp}`)).first()).toBeVisible();
  });

  test("a guessed decimal mark is flagged, switchable, and committed as previewed (#187)", async ({
    page,
  }) => {
    const stamp = Date.now();
    // Both mark readings must stay plausible ("n.234", "m,500"): the integer parts and
    // the year vary per run instead (see runAmount).
    const n = 1 + (stamp % 999);
    const m = 1 + (Math.floor(stamp / 1000) % 999);
    const year = 2000 + (Math.floor(stamp / 1_000_000) % 26);
    const csv = `Date;Libellé;Montant
11/03/${year};CB DECIMAL ${stamp};-${n}.234
12/03/${year};VIR DECIMAL ${stamp};${m},500`;
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `decimal-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await uploaded;

    const rows = page.locator('[data-slot="import-preview-row"]');
    const card = rows
      .filter({ hasText: `CB DECIMAL ${stamp}` })
      .locator(":visible")
      .first();
    const vir = rows
      .filter({ hasText: `VIR DECIMAL ${stamp}` })
      .locator(":visible")
      .first();
    const warning = page.locator('[data-slot="import-decimal-guessed"]');
    await expect(warning).toContainText("Séparateur décimal deviné (virgule)", { timeout: 15_000 });
    await expect(card).toContainText(new RegExp(`-${n}\\s234,00\\s€`));
    await expect(vir).toContainText(new RegExp(`${m},50\\s€`));

    const dot = page
      .getByRole("group", { name: "Décimales" })
      .getByRole("button", { name: "Point" });
    await expect(async () => {
      await page.getByRole("button", { name: "Utiliser le point" }).click({ timeout: 2_000 });
      await expect(dot).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(card).toContainText(new RegExp(`-${n},23\\s€`), { timeout: 15_000 });
    await expect(vir).toContainText(new RegExp(`${m}\\s500,00\\s€`));
    await expect(warning).toHaveCount(0);

    const committed = page.waitForResponse((r) => r.url().includes("/commit"), {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /valider l’import/i }).click();
    const sent = (await committed).request().postDataJSON();
    expect(sent.mapping.decimal).toBe(".");
    await expect(page.getByRole("link", { name: /voir les transactions/i })).toBeVisible();

    await page.goto(`/fr/transactions?search=${stamp}`);
    const txRows = page.locator('[data-slot="transaction-row"]');
    await expect(txRows.filter({ hasText: `CB DECIMAL ${stamp}` }).first()).toContainText(
      new RegExp(`${n},23\\s€`),
    );
    await expect(txRows.filter({ hasText: `VIR DECIMAL ${stamp}` }).first()).toContainText(
      new RegExp(`${m}\\s500,00\\s€`),
    );
  });

  test("confirming a guessed decimal mark keeps the amounts and hides the warning (#187)", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `confirm-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(`Date;Libellé;Montant\n13/03/2026;CB CONFIRM ${stamp};-2.500`, "utf8"),
    });
    await uploaded;

    const row = page
      .locator('[data-slot="import-preview-row"]')
      .filter({ hasText: `CB CONFIRM ${stamp}` })
      .locator(":visible")
      .first();
    const warning = page.locator('[data-slot="import-decimal-guessed"]');
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(/-2\s500,00\s€/);

    const confirmed = page.waitForResponse((r) => r.url().endsWith("/preview"), {
      timeout: 30_000,
    });
    await expect(async () => {
      await page.getByRole("button", { name: "C’est correct" }).click({ timeout: 2_000 });
      await expect(warning).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    expect((await confirmed).request().postDataJSON().mapping.decimal).toBe(",");
    await expect(row).toContainText(/-2\s500,00\s€/);
    await expect(
      page.getByRole("group", { name: "Décimales" }).getByRole("button", { name: "Virgule" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("ambiguous dates flag a guessed date order that can be switched (#255)", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `dates-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(`Date;Libellé;Montant\n03/10/2019;CB DATES ${stamp};-2,00`, "utf8"),
    });
    await uploaded;

    const warning = page.locator('[data-slot="import-date-order-guessed"]');
    await expect(warning).toContainText("Ordre des dates deviné (JJ/MM)", { timeout: 15_000 });
    const monthFirst = page
      .getByRole("group", { name: "Ordre des dates" })
      .getByRole("button", { name: "MM/JJ" });
    await expect(async () => {
      await page.getByRole("button", { name: "Utiliser MM/JJ" }).click({ timeout: 2_000 });
      await expect(monthFirst).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(warning).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("a refused remap keeps the mapping and explains why beside it; dates show the year (#225)", async ({
    page,
  }) => {
    const stamp = Date.now();
    const lines = Array.from(
      { length: 60 },
      (_, i) => `${String(1 + (i % 28)).padStart(2, "0")}/05/2019;CB MAP ${stamp} N${i};-1,00`,
    );
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `map-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(`Date;Libellé;Montant\n${lines.join("\n")}`, "utf8"),
    });
    await uploaded;

    const rows = page.locator('[data-slot="import-preview-row"]');
    await expect(rows).toHaveCount(50, { timeout: 15_000 });
    await expect(rows.first()).toContainText("1er mai 2019");
    // Date, Libellé, Montant, Décimales and Ordre des dates are ticked; Débit, Crédit and Type are not.
    const ticks = page.locator('#import-settings [data-slot="field-mapped"]');
    await expect(ticks).toHaveCount(5);

    const date = page.getByLabel("Date", { exact: true });
    const refused = page.waitForResponse((r) => r.url().endsWith("/preview"), {
      timeout: 30_000,
    });
    await date.selectOption("");
    expect((await refused).status()).toBe(400);
    const error = page.locator('[data-slot="import-mapping-error"]');
    await expect(error).toContainText("Choisissez au moins la date");
    await expect(error).toBeInViewport();
    await expect(date).toHaveValue("Date");
    await expect(ticks).toHaveCount(5);
    await expect(rows).toHaveCount(50);
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("unticking auto-categorize drops rule categories and the uncategorized filter (#225, #328)", async ({
    page,
  }) => {
    const pattern = `AUTOCAT${Date.now()}`;
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
    await page.getByRole("button", { name: /nouvelle règle/i }).click();
    await page.getByLabel(/motif/i).fill(pattern);
    await page.locator('[data-slot="category-combobox"]').click();
    await page.getByRole("menuitem").nth(1).click();
    await page.getByRole("button", { name: /enregistrer/i }).click();
    const rule = page.locator('[data-slot="rule-row"]').filter({ hasText: pattern });
    await expect(rule).toHaveCount(1, { timeout: 30_000 });

    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `${pattern}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Date;Libellé;Montant\n14/03/2026;CB ${pattern};-9,00\n15/03/2026;ZQXW KJV ${pattern.slice(7)};-8,00`,
        "utf8",
      ),
    });
    await uploaded;

    const meta = page.locator('[data-slot="import-preview-meta"]');
    const combobox = page
      .locator('[data-slot="import-preview-row"]')
      .first()
      .locator('[data-slot="category-combobox"]:visible');
    await expect(meta).toContainText("1 catégorisée automatiquement", { timeout: 15_000 });
    await expect(combobox).not.toContainText("Sans catégorie");

    const rows = page.locator('[data-slot="import-preview-row"]');
    const filters = page.getByRole("group", { name: "Filtrer l'aperçu" });
    const filtered = page.waitForResponse((r) => r.url().endsWith("/preview"), {
      timeout: 30_000,
    });
    await filters.getByRole("button", { name: "Sans catégorie (1)" }).click();
    expect((await filtered).request().postDataJSON().filter).toBe("uncategorized");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("ZQXW KJV");

    await page.getByRole("button", { name: "Catégoriser automatiquement" }).click();
    await expect(rows).toHaveCount(2);
    await expect(filters).toHaveCount(0);
    await expect(meta).not.toContainText("catégorisée");
    await expect(combobox).toContainText("Sans catégorie");
    await page.getByRole("button", { name: "Annuler", exact: true }).click();

    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
    await rule.getByRole("button", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="confirm-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(rule).toHaveCount(0);
  });

  test("preview rows stay readable from 320 to 1440 px (#224)", async ({ page }) => {
    const stamp = Date.now();
    await page.goto("/fr/import");
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/import/csv"), {
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: `layout-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Date;Libellé;Montant\n18/09/2026;CB MAGASIN AU LIBELLE TRES LONG ${stamp} PARIS;-12345,67`,
        "utf8",
      ),
    });
    await uploaded;

    const card = page.locator('[data-slot="import-preview"]');
    const row = page.locator('[data-slot="import-preview-row"]').first();
    const header = card.getByText("Libellé brut", { exact: true });
    await expect(row).toBeVisible({ timeout: 15_000 });
    for (const width of [320, 768, 1024, 1180, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 768) await expect(header, "column header at 768px").toBeHidden();
      if (width === 1440) await expect(header, "column header at 1440px").toBeVisible();
      const label = row.locator('[data-slot="import-row-label"]:visible');
      const amount = row.locator('[data-slot="import-row-amount"]:visible');
      await expect(label).toHaveCount(1);
      const [c, l, a] = await Promise.all([
        card.boundingBox(),
        label.boundingBox(),
        amount.boundingBox(),
      ]);
      expect(l!.width, `label width at ${width}px`).toBeGreaterThan(100);
      expect(l!.x + l!.width, `label vs amount at ${width}px`).toBeLessThanOrEqual(a!.x);
      expect(a!.x + a!.width, `amount inside the card at ${width}px`).toBeLessThanOrEqual(
        c!.x + c!.width,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `horizontal overflow at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });
});
