import { test, expect } from "@playwright/test";

test.describe("transactions", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create a manual transaction and find it via search", async ({ page }) => {
    const stamp = Date.now();
    const label = `Boulangerie ${stamp}`;
    await page.goto("/fr/transactions");
    // Requires the owner to have at least one account (seeded e2e fixture).
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-15");
    await page.fill('input[name="amount"]', "-8,50");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    await expect(page.locator('input[name="label"]')).toBeHidden();

    // Token search on the per-run word (the unfiltered list only shows the newest page).
    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    await page.getByRole("searchbox").fill(String(stamp));
    await expect(row.first()).toBeVisible();

    // Word beginnings match (#192), word middles don't.
    await page.getByRole("searchbox").fill(`boul ${stamp}`);
    await expect(page).toHaveURL(/search=boul/);
    await expect(row.first()).toBeVisible();
    await page.getByRole("searchbox").fill(`oulangerie ${stamp}`);
    await expect(page).toHaveURL(/search=oulangerie/);
    await expect(
      page.getByText(
        "Aucune transaction ne correspond. La recherche porte sur les débuts de mots d’au moins 3 lettres.",
      ),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test("a truncated list shows a count and loads more on demand", async ({ page }) => {
    // Within MAX_SEARCH_PREFIX (12) chars, so the search matches this run's rows only.
    const word = `pg${Date.now().toString(36)}`;
    await page.goto("/fr/transactions");
    for (const day of ["10", "11", "12"]) {
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="label"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', `2026-02-${day}`);
      await page.fill('input[name="amount"]', "-5");
      await page.fill('input[name="label"]', `${word} ${day}`);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.locator('input[name="label"]')).toBeHidden();
    }

    // limit=2 may cut Feb 11 short → trimmed to the one complete day (Feb 12).
    await page.goto(`/fr/transactions?search=${word}&limit=2`);
    const rows = page.locator('[data-slot="transaction-row"]');
    const more = page.locator('[data-slot="transactions-more"]');
    await expect(rows).toHaveCount(1);
    await expect(more).toContainText("1 sur 3 transactions affichées");

    await more.getByRole("link", { name: /afficher 100 de plus/i }).click();
    await expect(page).toHaveURL(/limit=102/);
    await expect(rows).toHaveCount(3);
    await expect(more).toHaveCount(0);

    // Changing a filter resets the page size.
    await page.getByRole("button", { name: "Sorties", exact: true }).click();
    await expect(page).toHaveURL(/dir=out/);
    expect(page.url()).not.toContain("limit=");
  });

  test("manual entry explains amount problems and accepts grouped amounts", async ({ page }) => {
    const label = `Montant ${Date.now()}`;
    await page.goto("/fr/transactions");
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-17");
    await page.fill('input[name="label"]', label);
    await expect(page.locator('input[name="label"]')).toHaveAttribute("maxlength", "200");

    for (const [amount, message] of [
      ["12,3456", /plus de 2 décimales/i],
      ["1.234", /montant ambigu/i],
      ["0", /ne peut pas être nul/i],
    ] as const) {
      await page.fill('input[name="amount"]', amount);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(message);
      // A rejected submit keeps what was typed.
      await expect(page.locator('input[name="label"]')).toHaveValue(label);
      await expect(page.locator('input[name="date"]')).toHaveValue("2026-02-17");
    }

    await page.fill('input[name="amount"]', "-1.234,56");
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();
  });

  test("edits a manual transaction from its detail", async ({ page }) => {
    const stamp = Date.now();
    await page.goto(`/fr/transactions?search=${stamp}`);
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-15");
    await page.fill('input[name="amount"]', "-8,50");
    await page.fill('input[name="label"]', `Avant ${stamp}`);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    await page
      .locator('[data-slot="transaction-row"]')
      .filter({ hasText: `Avant ${stamp}` })
      .click();
    await page.getByRole("button", { name: /^modifier$/i }).click();
    const form = page.locator('[data-slot="transaction-edit-form"]');
    await expect(form.locator('input[name="amount"]')).toHaveValue("-8,50");
    await form.locator('input[name="amount"]').fill("12,3456");
    await form.getByRole("button", { name: /enregistrer/i }).click();
    await expect(form.getByRole("alert")).toHaveText(/plus de 2 décimales/i);

    await form.locator('input[name="amount"]').fill("-9,75");
    await form.locator('input[name="label"]').fill(`Après ${stamp}`);
    await form.locator('input[name="note"]').fill("Note e2e");
    await form.getByRole("button", { name: /enregistrer/i }).click();
    await expect(form).toBeHidden();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Note e2e")).toBeVisible();
    await expect(sheet.getByText(/9,75/).first()).toBeVisible();
    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: `Après ${stamp}` })
        .first(),
    ).toBeVisible();
  });

  test("filters by account, type and amount, sorts by amount and resets", async ({ page }) => {
    const stamp = Date.now();
    await page.goto(`/fr/transactions?search=${stamp}`);
    // The seeded account: the form defaults to the newest one, which a concurrent run may change.
    const accountName = "E2E Courant";
    for (const [suffix, amount, type] of [
      ["petit", "-5", "CARD"],
      ["gros", "-150", "TRANSFER"],
    ] as const) {
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="label"]')).toBeVisible();
      }).toPass();
      await page.selectOption("#tx-account", { label: accountName });
      await page.fill('input[name="date"]', "2026-02-20");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', `Filtre ${stamp} ${suffix}`);
      await page.selectOption('select[name="type"]', type);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.locator('input[name="label"]')).toBeHidden();
    }
    const rows = page.locator('[data-slot="transaction-row"]');
    await expect(rows).toHaveCount(2);

    await page.getByRole("button", { name: /tous les types/i }).click();
    await page.getByRole("menuitem", { name: "Virement" }).click();
    await expect(page).toHaveURL(/type=TRANSFER/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("gros");

    // Filters build on the live URL, so the next one must wait for the reset to land.
    const reset = page.locator('[data-slot="filters-reset"]');
    const resetFilters = async () => {
      await reset.click();
      await expect(reset).toBeHidden();
    };
    await resetFilters();
    await expect(page).not.toHaveURL(/type=/);
    await expect(rows).toHaveCount(2);

    await page.getByRole("textbox", { name: "Montant min." }).fill("100");
    await page.getByRole("textbox", { name: "Montant min." }).press("Enter");
    await expect(page).toHaveURL(/min=100/);
    await expect(page.getByRole("textbox", { name: "Montant min." })).toHaveValue("100,00");
    await expect(rows).toHaveCount(1);
    await resetFilters();

    await page.getByRole("button", { name: /tous les comptes/i }).click();
    await page.getByRole("menuitem", { name: accountName, exact: true }).click();
    await expect(page).toHaveURL(/accountId=/);
    await expect(rows).toHaveCount(2);
    await resetFilters();

    await page.getByRole("combobox", { name: "Tri" }).selectOption("amount-asc");
    await expect(page).toHaveURL(/sort=amount-asc/);
    await expect(rows.first()).toContainText("gros");
    await page.getByRole("combobox", { name: "Tri" }).selectOption("amount-desc");
    await expect(rows.first()).toContainText("petit");
    await resetFilters();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).toHaveURL(new RegExp(`search=${stamp}`));
  });

  test("search is debounced and explains short words", async ({ page }) => {
    await page.goto("/fr/transactions");
    const box = page.getByRole("searchbox");
    await box.pressSequentially("cb", { delay: 50 });
    await expect(page.getByText(/débuts de mots d’au moins 3 lettres/i).first()).toBeVisible();
    await expect(page).toHaveURL(/search=cb/);
    await box.fill("");
    await expect(page).not.toHaveURL(/search=/);
  });

  test("the header fits a narrow viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/transactions");
    await expect(page.getByRole("button", { name: /nouvelle transaction/i })).toBeInViewport({
      ratio: 1,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("unauthenticated /transactions redirects to login", async ({ page }) => {
  await page.goto("/fr/transactions");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Ftransactions$/);
});
