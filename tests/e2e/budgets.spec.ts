import { test, expect } from "@playwright/test";

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
    await page.fill('input[name="periodEnd"]', "2026-03-31");
    await page.fill('input[name="plannedAmount"]', "300");
    await page.getByRole("button", { name: /créer le budget/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test("opens a budget's detail and shows per-line progress + status", async ({ page }) => {
    const name = `Detail ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await page.fill('input[name="periodEnd"]', "2026-03-31");
    await page.fill('input[name="plannedAmount"]', "250");
    await page.getByRole("button", { name: /créer le budget/i }).click();

    // Open the freshly created budget's detail page.
    await page.getByText(name).first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    // Planned total and a status pill render (spend is 0 → "Dans le budget").
    await expect(page.getByText("250,00", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/dans le budget/i).first()).toBeVisible();
  });

  test("assigns a non-matching transaction to a budget (INCLUDE) and it counts", async ({
    page,
  }) => {
    const stamp = Date.now();
    const txLabel = `Assign ${stamp}`;
    const budgetName = `Enveloppe ${stamp}`;

    // 1) Seed an expense (no category → won't auto-match) on the first account.
    await page.goto("/fr/accounts");
    await expect(async () => {
      await page
        .getByRole("button", { name: /saisir une transaction/i })
        .first()
        .click();
      await expect(page.locator('input[name="label"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="date"]', "2026-03-15");
    await page.fill('input[name="amount"]', "-60");
    await page.fill('input[name="label"]', txLabel);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    // 2) Create a budget with a single unfiltered line (INCLUDE-only spend).
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', budgetName);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await page.fill('input[name="periodEnd"]', "2026-03-31");
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
    await page.getByLabel(/choisir un budget/i).selectOption({ label: budgetName });
    await page.getByRole("button", { name: /^inclure$/i }).click();
    await expect(page.getByText(/incluse/i).first()).toBeVisible({ timeout: 15_000 });

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
});
