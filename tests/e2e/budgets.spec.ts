import { test, expect, type Page } from "@playwright/test";

test.describe("budgets", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "Dialog flow deferred to Phase 8.3");

  test("create a personal budget with a line and see it listed", async ({ page }) => {
    const name = `Budget ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await expect(page.locator('input[name="periodEnd"]')).toHaveValue("2026-03-31");
    await page.fill('input[name="plannedAmount"]', "300,5");
    await expect(page.getByText("Total prévu : 300,50 €")).toBeVisible();
    await page.getByRole("button", { name: /créer le budget/i }).click();
    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: name });
    await expect(card).toContainText("/ 300,50 €", { timeout: 15_000 });
  });

  test("a cancelled draft is not kept for the next budget", async ({ page }) => {
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="plannedAmount"]', "1234,5");
    await page.getByRole("button", { name: /^annuler$/i }).click();
    await page.getByRole("button", { name: /nouveau budget/i }).click();
    await expect(page.locator('input[name="plannedAmount"]')).toHaveValue("");
  });

  test("opens a budget's detail and shows per-line progress + status", async ({ page }) => {
    const name = `Detail ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2031-02-01");
    await page.fill('input[name="plannedAmount"]', "250");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    // Open the freshly created budget's detail page.
    await page.getByText(name).first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    // Planned total and a status pill render (spend is 0 → "Dans le budget").
    await expect(page.getByText("250,00", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/dans le budget/i).first()).toBeVisible();

    // Without period links, the menu stays beside the title on mobile.
    await page.setViewportSize({ width: 320, height: 800 });
    const title = page.getByRole("heading", { name });
    const menu = page.getByRole("button", { name: `Actions pour ${name}` });
    await expect
      .poll(async () => {
        const [m, h] = [await menu.boundingBox(), await title.boundingBox()];
        return m && h ? m.y < h.y + h.height : false;
      })
      .toBe(true);
  });

  test("assigns a non-matching transaction to a budget (INCLUDE) and it counts", async ({
    page,
  }) => {
    const budgetName = await includeIntoNewBudget(page, "-60");

    // 4) The budget detail now reflects the included spend (60,00 €).
    await page.goto("/fr/budgets");
    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: budgetName });
    await expect(card).toContainText("60,00 € / 200,00 €", { timeout: 15_000 });
    await expect(card).toContainText("30 %");
    await card.click();
    await expect(page.getByRole("heading", { name: budgetName })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("60,00", { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("an included income that matches no line shows out of budget (#345)", async ({ page }) => {
    const budgetName = await includeIntoNewBudget(page, "80");
    await page.goto("/fr/budgets");
    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: budgetName });
    await expect(card).toContainText("-80,00 € / 200,00 €", { timeout: 15_000 });
    await card.click();
    await expect(page.getByRole("heading", { name: budgetName })).toBeVisible({ timeout: 15_000 });
    const outOfBudget = page.locator('[data-slot="budget-out-of-budget"]');
    await expect(outOfBudget).toContainText("Hors budget");
    await expect(outOfBudget).toContainText("-80,00 €");
    await expect(outOfBudget).toContainText("1 transaction incluse sans ligne correspondante");
  });

  test("renews a recurring budget, groups its periods, navigates, edits and deletes it", async ({
    page,
  }) => {
    const name = `Série ${Date.now()}`;
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', lastMonth.toISOString().slice(0, 10));
    await page.fill('input[name="plannedAmount"]', "100");
    await page.locator('input[name="recurring"]').check();
    await page.getByRole("button", { name: /créer le budget/i }).click();

    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: name });
    await card.getByRole("button", { name: /renouveler/i }).click({ timeout: 15_000 });
    await expect(page.locator('[data-slot="roll-result"]')).toContainText(name);
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-slot="budget-history"]')).toContainText("1 autre période");
    await expect(card.getByRole("button", { name: /renouveler/i })).toHaveCount(0);

    await card.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    const currentUrl = page.url();
    await page.getByRole("link", { name: /période précédente/i }).click();
    await expect(page).not.toHaveURL(currentUrl);
    const next = page.getByRole("link", { name: /période suivante/i });
    await expect(next).toBeVisible();
    expect(await next.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );

    await page.getByRole("button", { name: `Actions pour ${name}` }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await page.fill('input[name="name"]', `${name} bis`);
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(page.getByRole("heading", { name: `${name} bis` })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: `Actions pour ${name} bis` }).click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    await page
      .locator('[data-slot="budget-delete-dialog"]')
      .getByRole("button", { name: /^supprimer$/i })
      .click();
    await expect(page).toHaveURL(/\/fr\/budgets$/, { timeout: 15_000 });
    // The renewed period survives as its own series.
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-slot="budget-history"]')).toHaveCount(0);
  });

  test("amounts read back in the locale format and hydrate cleanly in English (#226)", async ({
    page,
  }) => {
    const name = `Format ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2032-05-01");
    const planned = page.locator('input[name="plannedAmount"]');
    await planned.fill("1 234,5");
    await planned.blur();
    await expect(planned).toHaveValue("1\u202f234,50");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: name });
    await card.getByRole("link").first().click({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    const detailUrl = page.url();

    await page.getByRole("button", { name: `Actions pour ${name}` }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await expect(planned).toHaveValue("1\u202f234,50");
    // Too many decimals: the app's message, not just the browser's pattern tooltip.
    await planned.fill("12,3456");
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(page.getByText("Le montant ne peut pas avoir plus de 2 décimales.")).toBeVisible();
    await expect(planned).toHaveAttribute("aria-invalid", "true");

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    for (const url of ["/en/budgets", detailUrl.replace("/fr/", "/en/")]) {
      await page.goto(url, { waitUntil: "load" });
      await expect(page.locator("main h1")).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("edits a description and line labels, archives and unarchives a budget", async ({
    page,
  }) => {
    const stamp = Date.now();
    const name = `Archive ${stamp}`;
    const label = `Resto ${stamp}`;
    const renamed = `Sorties ${stamp}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('textarea[name="description"]', "Sorties et restaurants");
    await page.fill('input[name="periodStart"]', "2033-01-01");
    await page.getByRole("textbox", { name: "Libellé" }).fill(label);
    await page.fill('input[name="plannedAmount"]', "120");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: name });
    const archived = page.locator('[data-slot="archived-budgets"]');
    const archivedRow = archived.locator('[data-slot="archived-budget"]').filter({ hasText: name });
    await expect(card.locator('[data-slot="budget-description"]')).toHaveText(
      "Sorties et restaurants",
      { timeout: 15_000 },
    );
    try {
      await card.getByRole("link").first().click();
      await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-slot="budget-description"]')).toHaveText(
        "Sorties et restaurants",
      );
      await expect(page.getByText(label, { exact: true })).toBeVisible();

      // The edit form reads the description and the label back.
      await page.getByRole("button", { name: `Actions pour ${name}` }).click();
      await page.getByRole("menuitem", { name: /modifier/i }).click();
      await expect(page.locator('textarea[name="description"]')).toHaveValue(
        "Sorties et restaurants",
      );
      const labelInput = page.getByRole("textbox", { name: "Libellé" });
      await expect(labelInput).toHaveValue(label);
      await labelInput.fill(renamed);
      await page.getByRole("button", { name: /enregistrer/i }).click();
      await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: `Actions pour ${name}` }).click();
      await page.getByRole("menuitem", { name: /^archiver$/i }).click();
      await page
        .locator('[data-slot="budget-archive-dialog"]')
        .getByRole("button", { name: /^archiver$/i })
        .click();
      await expect(page.getByText("Archivé", { exact: true })).toBeVisible({ timeout: 15_000 });

      await page.goto("/fr/budgets");
      await expect(card).toHaveCount(0);
      await archived.locator("summary").click();
      await expect(archivedRow).toBeVisible();
      await archivedRow.getByRole("button", { name: `Actions pour ${name}` }).click();
      await expect(page.getByRole("menuitem", { name: /modifier/i })).toHaveCount(0);
      await page.getByRole("menuitem", { name: /désarchiver/i }).click();
      await expect(card).toHaveCount(1, { timeout: 15_000 });
    } finally {
      // Delete it whether it ended up active or archived.
      await page.goto("/fr/budgets");
      if ((await card.count()) === 0) await archived.locator("summary").click();
      const holder = (await card.count()) > 0 ? card : archivedRow;
      await holder.getByRole("button", { name: `Actions pour ${name}` }).click();
      await page.getByRole("menuitem", { name: /supprimer/i }).click();
      await page
        .locator('[data-slot="budget-delete-dialog"]')
        .getByRole("button", { name: /^supprimer$/i })
        .click();
      await expect(holder).toHaveCount(0, { timeout: 15_000 });
    }
  });

  test("an attached budget shows its landing here and on the dashboard, sections and out-of-budget rows", async ({
    page,
  }) => {
    const stamp = Date.now();
    const account = `Atterrissage ${stamp}`;
    const name = `Enveloppe compte ${stamp}`;
    const today = new Date().toISOString().slice(0, 10);
    await createAccount(page, account, "500");
    await page
      .locator('[data-slot="card"]', { hasText: account })
      .getByRole("button", { name: /saisir une transaction/i })
      .click();
    await page.fill('input[name="date"]', today);
    await page.fill('input[name="amount"]', "-12");
    await page.fill('input[name="label"]', `Imprévu ${stamp}`);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    await openNewBudget(page);
    await page.fill('input[name="name"]', name);
    await page.locator("#bud-account").selectOption({ label: account });
    await page.fill('input[name="periodStart"]', `${today.slice(0, 7)}-01`);
    const line = page.locator('[data-slot="budget-line-row"]').first();
    await line.getByLabel("Catégorie").selectOption({ index: 1 });
    await line.getByLabel("Montant prévu").fill("100");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    const landing = page.locator('[data-slot="landing-card"]').filter({ hasText: account });
    await expect(landing).toContainText("388,00", { timeout: 15_000 });
    await page.goto("/fr/dashboard");
    const onDashboard = page.locator('[data-slot="landing-card"]').filter({ hasText: account });
    await expect(onDashboard).toContainText("388,00");
    await expect(onDashboard).toContainText("488,00");
    await onDashboard.getByRole("link").click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="budget-income"]')).toBeVisible();
    await expect(page.locator('[data-slot="budget-spending"]')).toBeVisible();
    const outOfBudget = page.locator('[data-slot="budget-out-of-budget"]');
    await expect(outOfBudget).toContainText("12,00");
    await outOfBudget.getByRole("link").first().click();
    await expect(page).toHaveURL(/\?show=out$/);
    const rows = page.locator('[data-slot="budget-transaction-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(`Imprévu ${stamp}`);

    await deleteBudget(page, name);
    await deleteAccount(page, account);
  });

  test("builds an attached budget with income, a transfer and a margin, and edits it back", async ({
    page,
  }) => {
    const stamp = Date.now();
    const savings = `Livret ${stamp}`;
    const name = `Comptes ${stamp}`;
    await createAccount(page, savings, "0");

    await openNewBudget(page);
    await page.fill('input[name="name"]', name);
    await page.locator("#bud-account").selectOption({ label: "E2E Courant" });
    await page.fill('input[name="periodStart"]', `${2100 + (stamp % 800)}-01-01`);
    const lines = page.locator('[data-slot="budget-line-row"]');
    await lines.nth(0).getByLabel("Type").selectOption({ label: "Rentrée" });
    await lines.nth(0).getByLabel("Catégorie").selectOption({ index: 1 });
    await lines.nth(0).getByLabel("Montant prévu").fill("2000");
    await page.getByRole("button", { name: /ajouter une ligne/i }).click();
    await lines.nth(1).getByLabel("Type").selectOption({ label: "Virement" });
    await lines.nth(1).getByLabel("Autre compte").selectOption({ label: savings });
    await lines.nth(1).getByLabel("Montant prévu").fill("300");
    await page.fill('input[name="outOfBudgetPlanned"]', "50");
    await expect(page.getByText("Total prévu : 350,00 €")).toBeVisible();
    await page.getByRole("button", { name: /créer le budget/i }).click();

    const card = page.locator('[data-slot="budget-card"]').filter({ hasText: name });
    await expect(card).toContainText("E2E Courant", { timeout: 15_000 });
    await card.getByRole("button", { name: `Actions pour ${name}` }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    await expect(page.locator("#bud-account").locator("option:checked")).toHaveText("E2E Courant");
    await expect(lines.nth(0).getByLabel("Type")).toHaveValue("INCOME");
    await expect(lines.nth(1).getByLabel("Type")).toHaveValue("TRANSFER");
    await expect(lines.nth(1).getByLabel("Sens")).toHaveValue("OUT");
    await expect(lines.nth(1).getByLabel("Autre compte").locator("option:checked")).toHaveText(
      savings,
    );
    await expect(page.locator('input[name="outOfBudgetPlanned"]')).toHaveValue("50,00");
    await page.getByRole("button", { name: /^annuler$/i }).click();

    await card.click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="budget-income"]')).toContainText("0,00 € / 2 000,00 €");
    await deleteBudget(page, name);
    await deleteAccount(page, savings);
  });

  test("the dashboard shows a budget snapshot", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(page.locator('[data-slot="budget-snapshot"]')).toBeVisible();
  });
});

// Seeds an uncategorised transaction, creates a 200 € catch-all budget on an empty
// period and INCLUDEs the transaction into it; returns the budget name.
async function includeIntoNewBudget(page: Page, amount: string): Promise<string> {
  const stamp = Date.now();
  const txLabel = `Assign ${stamp}`;
  const budgetName = `Enveloppe ${stamp}`;

  // 1) Seed a transaction (no category → won't auto-match) on the first account.
  await page.goto("/fr/accounts");
  await expect(async () => {
    await page
      .getByRole("button", { name: /saisir une transaction/i })
      .first()
      .click();
    await expect(page.locator('input[name="label"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="date"]', "2026-03-15");
  await page.fill('input[name="amount"]', amount);
  await page.fill('input[name="label"]', txLabel);
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(page.locator('input[name="label"]')).toBeHidden();

  // 2) Create a budget on a period with no transaction, so only the INCLUDE counts.
  await page.goto("/fr/budgets");
  await expect(async () => {
    await page.getByRole("button", { name: /nouveau budget/i }).click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="name"]', budgetName);
  await page.fill('input[name="periodStart"]', "2031-01-01");
  await page.fill('input[name="plannedAmount"]', "200");
  await page.getByRole("button", { name: /créer le budget/i }).click();
  await expect(page.getByText(budgetName).first()).toBeVisible({ timeout: 15_000 });

  // 3) Open the seeded transaction and assign it INCLUDE to the budget.
  // Retried: the budget-create refresh can still be in flight and abort the goto.
  await expect(async () => {
    await page.goto(`/fr/transactions?search=${stamp}`);
  }).toPass();
  await page
    .locator('[data-slot="transaction-row"]')
    .filter({ hasText: txLabel })
    .first()
    .click({ timeout: 15_000 });
  // Options read "name · period" (#161).
  const budgetSelect = page.getByLabel(/choisir un budget/i);
  const option = budgetSelect.locator("option", { hasText: budgetName });
  await budgetSelect.selectOption((await option.getAttribute("value"))!);
  await page.getByRole("button", { name: /^inclure$/i }).click();
  await expect(page.getByText(/incluse/i).first()).toBeVisible({ timeout: 15_000 });

  return budgetName;
}

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await page.goto("/fr/accounts");
  await expect(async () => {
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="initialBalance"]', balance);
  await page.getByRole("button", { name: /créer le compte/i }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
}

// Test accounts would otherwise pile up in every account list (the import step lists them all).
async function deleteAccount(page: Page, name: string): Promise<void> {
  await page.goto("/fr/accounts");
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: name })
    .last()
    .getByRole("button", { name: /^actions pour/i })
    .click();
  await page.getByRole("menuitem", { name: /supprimer/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/saisissez/i).fill(name);
  await dialog.getByRole("button", { name: /supprimer définitivement/i }).click();
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 15_000 });
}

async function openNewBudget(page: Page): Promise<void> {
  await page.goto("/fr/budgets");
  await expect(async () => {
    await page.getByRole("button", { name: /nouveau budget/i }).click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  }).toPass();
}

async function deleteBudget(page: Page, name: string): Promise<void> {
  await page.goto("/fr/budgets");
  await page
    .locator('[data-slot="budget-card"]')
    .filter({ hasText: name })
    .getByRole("button", { name: `Actions pour ${name}` })
    .click();
  await page.getByRole("menuitem", { name: /supprimer/i }).click();
  await page
    .locator('[data-slot="budget-delete-dialog"]')
    .getByRole("button", { name: /^supprimer$/i })
    .click();
  await expect(page.locator('[data-slot="budget-card"]').filter({ hasText: name })).toHaveCount(0);
}
