import { test, expect, type Page } from "@playwright/test";

const emptyState = (page: Page) => page.locator('[data-slot="empty-state"]');

test.describe("first run of a brand-new user (#170)", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("guides from no account to a first transaction", async ({ page }) => {
    test.setTimeout(120_000);
    const email = `onboarding-${Date.now()}@e2e.local`;
    const password = "e2e-onboarding-password-123";

    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Onboarding");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    // Dashboard: a checklist instead of zeroed KPIs.
    const welcome = page.locator('[data-slot="welcome-card"]');
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Bienvenue sur /);
    await expect(welcome).toBeVisible();
    await expect(page.locator('[data-slot="kpi-note"]')).toHaveCount(0);
    await expect(welcome.getByRole("link", { name: "Importer un relevé" })).toHaveCount(0);

    // Transactions: the disabled action stays focusable and points at the reason.
    await page.goto("/fr/transactions");
    const create = page.getByRole("button", { name: /nouvelle transaction/i });
    await expect(create).toHaveAttribute("aria-disabled", "true");
    await expect(create).toHaveAttribute("aria-describedby", "add-transaction-blocked");
    await expect(page.locator("#add-transaction-blocked")).toContainText(
      "Commencez par créer un compte",
    );

    // Import: no drop zone without a target account.
    await page.goto("/fr/import");
    await expect(page.locator('[data-slot="import-dropzone"]')).toHaveCount(0);
    await expect(emptyState(page)).toContainText("Commencez par créer un compte");
    await expect(page.getByRole("button", { name: /saisie manuelle/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // Budgets: an empty state with its own CTA.
    await page.goto("/fr/budgets");
    await expect(emptyState(page)).toContainText(/aucun budget pour l.instant/i);
    await expect(
      emptyState(page).getByRole("button", { name: "Créer mon premier budget" }),
    ).toBeVisible();

    // Step 1 from the dashboard CTA: lands on /accounts with the create form open.
    await page.goto("/fr/dashboard");
    await welcome.getByRole("link", { name: "Créer un compte" }).click();
    // Once open, the form drops `?new=1`: neither back navigation nor a reload reopens it (#230).
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/fr\/accounts$/, { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator('input[name="name"]')).toBeHidden();
    await page.locator("aside").getByRole("link", { name: "Tableau de bord" }).click();
    await expect(page).toHaveURL(/\/fr\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/fr\/accounts$/);
    await expect(emptyState(page)).toContainText("Créer mon premier compte");
    await expect(page.locator('input[name="name"]')).toBeHidden();
    await page.reload();
    await expect(emptyState(page)).toContainText("Créer mon premier compte");
    await expect(page.locator('input[name="name"]')).toBeHidden();
    await page.goto("/fr/accounts?new=1");
    const accountName = `Premier ${Date.now()}`;
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
    await page.fill('input[name="name"]', accountName);
    await page.getByRole("button", { name: /créer le compte/i }).click();
    await expect(page.getByText(accountName).first()).toBeVisible();

    // Step 2 unlocked.
    await page.goto("/fr/dashboard");
    await expect(page.locator('[data-slot="welcome-step"][data-done]')).toHaveCount(1);
    await expect(welcome.getByRole("link", { name: "Importer un relevé" })).toBeVisible();

    await page.goto("/fr/import");
    await expect(page.locator('[data-slot="import-dropzone"]')).toBeVisible();

    await page.goto("/fr/transactions");
    await expect(emptyState(page)).toContainText(/aucune transaction pour l.instant/i);

    // The checklist's manual-entry CTA opens the form directly.
    await page.goto("/fr/dashboard");
    await welcome.getByRole("link", { name: "Saisir une transaction" }).click();
    const label = `Premiere ${Date.now()}`;
    await expect(page.locator('input[name="label"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/fr\/transactions$/, { timeout: 15_000 });
    await page.fill('input[name="date"]', "2026-01-15");
    await page.fill('input[name="amount"]', "-12");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }),
    ).toBeVisible({ timeout: 15_000 });

    // Past first run: the regular dashboard.
    await page.goto("/fr/dashboard");
    await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
    await expect(welcome).toHaveCount(0);

    await page.goto("/fr/settings/data", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(async () => {
      await page.getByRole("button", { name: "Supprimer mon compte" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("dialog").getByLabel("Mot de passe").fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer définitivement" })
      .click();
    await expect(page).toHaveURL(/\/login\?deleted=1$/, { timeout: 15_000 });
  });
});
