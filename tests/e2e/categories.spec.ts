import { test, expect, type Locator, type Page } from "@playwright/test";

// Retries the first click: one landing before hydration is a no-op.
async function openCreateDialog(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

// The radios are visually hidden behind their swatch/tab: click what the user sees.
async function pick(dialog: Locator, name: string) {
  const radio = dialog.page().getByRole("radio", { name, exact: true });
  await dialog.locator("label").filter({ has: radio }).click();
  await expect(dialog.getByRole("radio", { name, exact: true })).toBeChecked();
}

test.describe("categories", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create, edit and delete a category", async ({ page }) => {
    const name = `Cat ${Date.now()}`;
    await page.goto("/fr/categories");
    await openCreateDialog(page);
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer la catégorie/i }).click();
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
    await expect(dialog).toContainText("n’est utilisée nulle part");
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
      await openCreateDialog(page);
      await page.fill('input[name="name"]', name);
      if (parent) {
        const select = page.locator("#cat-parent");
        const value = await select.locator("option", { hasText: parent }).getAttribute("value");
        await select.selectOption(value!);
      }
      await page.getByRole("button", { name: /créer la catégorie/i }).click();
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

  test("a household category with a palette colour and a symbol", async ({ page }) => {
    const name = `HH cat ${Date.now()}`;
    await page.goto("/fr/categories");
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    const preview = dialog.locator('[data-slot="category-preview"]');
    await expect(dialog.getByRole("radio", { name: "Vert sauge" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Aucun symbole" })).toBeChecked();

    await page.fill('input[name="name"]', name);
    await expect(preview).toContainText(name);
    const scopeSelect = dialog.locator("#cat-scope");
    if (await scopeSelect.count()) await scopeSelect.selectOption({ label: "E2E Shared" });
    else await pick(dialog, "E2E Shared");
    await expect(dialog).toContainText("Visible par tous les membres du foyer.");
    await pick(dialog, "Bleu ardoise");
    await pick(dialog, "Voiture");
    await expect(preview).toContainText("🚗");
    await dialog.getByRole("button", { name: /créer la catégorie/i }).click();

    const row = page.locator('[data-slot="category-row"]').filter({ hasText: name });
    await expect(row).toContainText("🚗");
    await expect(row).toContainText("Foyer");

    await row.getByRole("button", { name: /actions pour/i }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await expect(dialog.getByRole("radio", { name: "Bleu ardoise" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Voiture" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "E2E Shared" })).toBeDisabled();
    await pick(dialog, "Aucun symbole");
    await dialog.getByRole("button", { name: /enregistrer/i }).click();
    await expect(dialog).toBeHidden();
    await expect(row).not.toContainText("🚗");

    await row.getByRole("button", { name: /actions pour/i }).click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="category-delete-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(row).toHaveCount(0);
  });
});

test.describe("category free colour and symbol", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "Playwright WebKit taps");

  test("a custom colour and a typed symbol become the selected extra choices", async ({ page }) => {
    const name = `Free ${Date.now()}`;
    await page.goto("/fr/categories");
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    await page.fill('input[name="name"]', name);
    await dialog.locator('[data-slot="category-color-picker"]').fill("#123456");
    await expect(
      dialog.getByRole("radio", { name: "Couleur personnalisée (#123456)" }),
    ).toBeChecked();

    await dialog.getByRole("button", { name: "Saisir un autre symbole" }).click();
    const draft = dialog.getByRole("textbox", { name: "Symbole personnalisé" });
    await expect(draft).toBeFocused();
    await draft.fill("ab");
    await expect(dialog).toContainText("Un seul caractère ou emoji.");
    await draft.fill("🦄");
    await expect(dialog.getByRole("radio", { name: "Symbole personnalisé (🦄)" })).toBeChecked();
    await draft.press("Enter");
    await expect(draft).toBeHidden();
    await dialog.getByRole("button", { name: /créer la catégorie/i }).click();

    const row = page.locator('[data-slot="category-row"]').filter({ hasText: name });
    await expect(row).toContainText("🦄");
    await row.getByRole("button", { name: /actions pour/i }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await expect(
      dialog.getByRole("radio", { name: "Couleur personnalisée (#123456)" }),
    ).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Symbole personnalisé (🦄)" })).toBeChecked();
    await page.keyboard.press("Escape");

    await row.getByRole("button", { name: /actions pour/i }).click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="category-delete-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(row).toHaveCount(0);
  });
});

test("unauthenticated /categories redirects to login", async ({ page }) => {
  await page.goto("/fr/categories");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Fcategories$/);
});
