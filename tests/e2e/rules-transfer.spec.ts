import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

type FileRule = { pattern: string; category: { name: string }[] } & Record<string, unknown>;

test.describe("rules import and export (#291)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  const ruleRow = (page: Page, pattern: string) =>
    page.locator('[data-slot="rule-row"]').filter({ hasText: pattern });

  async function openRules(page: Page) {
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /^Règles/ }).click();
  }

  // Returns the name of the picked category (the nth menu item, 0 being "Sans catégorie").
  async function createRule(page: Page, pattern: string, categoryIndex: number) {
    await page.getByRole("button", { name: /nouvelle règle/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/motif/i).fill(pattern);
    await dialog.locator('[data-slot="category-combobox"]').click();
    const choice = page.getByRole("menuitem").nth(categoryIndex);
    const name = (await choice.innerText()).trim();
    await choice.click();
    await dialog.getByRole("button", { name: /enregistrer/i }).click();
    await expect(dialog).toBeHidden();
    await expect(ruleRow(page, pattern)).toHaveCount(1);
    return name;
  }

  async function addTransaction(page: Page, pattern: string, date: string) {
    await page.goto(`/fr/transactions?search=${pattern}`);
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', date);
    await page.fill('input[name="amount"]', "-8");
    await page.fill('input[name="label"]', `CB ${pattern}`);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: pattern });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    return row;
  }

  async function deleteTransactions(page: Page, pattern: string) {
    await page.goto(`/fr/transactions?search=${pattern}`);
    const rows = page.locator('[data-slot="transaction-row"]').filter({ hasText: pattern });
    while (await rows.count()) {
      const count = await rows.count();
      await rows.first().click();
      await page.getByRole("button", { name: /supprimer la transaction/i }).click();
      await page
        .locator('[data-slot="delete-transactions-dialog"]')
        .getByRole("button", { name: /^supprimer$/i })
        .click();
      await expect(rows).toHaveCount(count - 1, { timeout: 15_000 });
    }
  }

  // With a household, Export opens the scope dialog; without one it downloads directly.
  async function downloadExport(page: Page) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const viaDialog = await Promise.race([
      download.then(() => false),
      dialog.waitFor().then(
        () => true,
        () => false,
      ),
    ]);
    if (viaDialog) await dialog.getByRole("button", { name: "Télécharger" }).click();
    const file = await download;
    if (viaDialog) {
      await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
      await expect(dialog).toBeHidden();
    }
    return file;
  }

  async function deleteRule(page: Page, pattern: string) {
    const row = ruleRow(page, pattern);
    if (!(await row.count())) return;
    await row.getByRole("button", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="confirm-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(row).toHaveCount(0);
  }

  test("a failed export alert clears when the scope changes", async ({ page }) => {
    await page.route("**/api/export/rules**", (route) => route.fulfill({ status: 500 }));
    await openRules(page);
    await page.getByRole("button", { name: "Exporter", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Télécharger" }).click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    await dialog.locator("#rules-export-scope").selectOption({ label: "E2E Shared" });
    await expect(alert).toBeHidden();
  });

  test("export then import rules with a Create, a Map and a conflict, then reclassify", async ({
    page,
  }) => {
    test.slow();
    const stamp = Date.now();
    const [kept, conflict, mapped, created] = [
      `XKEEP${stamp}`,
      `XCONF${stamp}`,
      `XMAP${stamp}`,
      `XNEW${stamp}`,
    ];
    const unknownPath = `Inconnue ${stamp}`;
    const newCategory = `Nouvelle ${stamp}`;
    // A default category of the seeded e2e owner.
    const mapCategory = "Voyages";
    const patterns = [kept, conflict, mapped, created];

    await openRules(page);
    try {
      const keptCategory = await createRule(page, kept, 1);
      const conflictCategory = await createRule(page, conflict, 2);
      expect(conflictCategory).not.toBe(keptCategory);
      const conflictTx = await addTransaction(page, conflict, "2026-02-20");
      await expect(conflictTx).toContainText(conflictCategory);
      const mappedTx = await addTransaction(page, mapped, "2026-02-21");

      await openRules(page);
      const download = await downloadExport(page);
      expect(download.suggestedFilename()).toMatch(/^bilan-rules-\d{4}-\d{2}-\d{2}\.json$/);
      const exported = JSON.parse(await readFile((await download.path())!, "utf8")) as {
        format: string;
        rules: FileRule[];
      };
      expect(exported.format).toBe("bilan-rules");

      const keptRule = exported.rules.find((r) => r.pattern === kept)!;
      const conflictRule = exported.rules.find((r) => r.pattern === conflict)!;
      expect(keptRule).toBeDefined();
      expect(conflictRule).toBeDefined();
      // The file keeps `kept` as is (identical), moves `conflict` to the other category,
      // and adds a rule under an unknown path to map and one under a new path to create.
      const edited = {
        ...exported,
        rules: [
          keptRule,
          { ...conflictRule, category: keptRule.category },
          { ...keptRule, pattern: mapped, category: [{ name: unknownPath }] },
          { ...keptRule, pattern: created, category: [{ name: newCategory }] },
        ],
      };

      await page.getByRole("button", { name: "Importer", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#rules-import-file").setInputFiles({
        name: "rules.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(edited)),
      });
      await dialog.getByRole("button", { name: "Continuer" }).click();

      await expect(dialog.getByText("Vérifier l’import")).toBeVisible();
      const categoryRows = dialog.locator('[data-slot="rules-import-category"]');
      await expect(categoryRows).toHaveCount(2);
      const mapRow = categoryRows.filter({ hasText: unknownPath });
      const createRow = categoryRows.filter({ hasText: newCategory });
      await expect(createRow).toContainText(`Crée ${newCategory}`);

      const importButton = dialog.getByRole("button", { name: "Importer", exact: true });
      await mapRow.getByRole("button", { name: "Associer à" }).click();
      await expect(dialog.getByText(/Choisissez une catégorie/)).toBeVisible();
      await expect(importButton).toBeDisabled();
      await mapRow.locator('[data-slot="category-combobox"]').click();
      await page.getByRole("menuitem", { name: mapCategory, exact: true }).first().click();
      await expect(importButton).toBeEnabled();

      const conflictRow = dialog
        .locator('[data-slot="rules-import-conflict"]')
        .filter({ hasText: conflict });
      await expect(conflictRow).toHaveCount(1);
      await conflictRow.getByRole("button", { name: "Déplacer" }).click();

      const summary = dialog.locator('[data-slot="rules-import-summary"]');
      await expect(summary).toContainText(/2\s*règles à créer/);
      await expect(summary).toContainText(/1\s*règle à déplacer/);
      await expect(summary).toContainText(/1\s*ignorée/);
      await importButton.click();

      await expect(dialog.getByText("Règles importées")).toBeVisible();
      await expect(dialog.locator('[data-slot="rules-import-created"]')).toContainText(
        /2\s*règles créées/,
      );
      await expect(dialog.locator('[data-slot="rules-import-categories"]')).toContainText(
        /1\s*catégorie créée/,
      );
      await expect(dialog.locator('[data-slot="rules-import-moved"]')).toContainText(
        /1\s*règle existante déplacée/,
      );
      await expect(dialog.locator('[data-slot="rules-import-skipped"]')).toContainText(
        /1\s*ignorée/,
      );

      await dialog.getByRole("button", { name: "Reclasser les transactions existantes" }).click();
      const moving = dialog.locator('[data-slot="rule-apply-moving"]');
      await expect(moving).toContainText(/2\s*passent/);
      await dialog.getByRole("button", { name: /reclasser 2 transactions/i }).click();
      await expect(dialog).toBeHidden();

      await expect(ruleRow(page, conflict)).toContainText(keptCategory);
      await expect(ruleRow(page, mapped)).toContainText(mapCategory);
      await expect(ruleRow(page, created)).toContainText(newCategory);
      await expect(ruleRow(page, kept)).toContainText(keptCategory);

      await page.goto(`/fr/transactions?search=${conflict}`);
      await expect(conflictTx).toContainText(keptCategory, { timeout: 15_000 });
      await page.goto(`/fr/transactions?search=${mapped}`);
      await expect(mappedTx).toContainText(mapCategory, { timeout: 15_000 });
    } finally {
      await page.keyboard.press("Escape");
      for (const pattern of [conflict, mapped]) await deleteTransactions(page, pattern);
      await openRules(page);
      for (const pattern of patterns) await deleteRule(page, pattern);
      await page.getByRole("button", { name: /^Catégories/ }).click();
      const categoryRow = page.locator('[data-slot="category-row"]').filter({
        hasText: newCategory,
      });
      if (await categoryRow.count()) {
        await categoryRow.getByRole("button", { name: /actions pour/i }).click();
        await page.getByRole("menuitem", { name: /supprimer/i }).click();
        await page
          .locator('[data-slot="category-delete-dialog"]')
          .getByRole("button", { name: /^supprimer$/i })
          .click();
        await expect(categoryRow).toHaveCount(0);
      }
    }
  });
});
