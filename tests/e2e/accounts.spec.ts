import { test, expect } from "@playwright/test";

test.describe("accounts", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  // Project-wide convention: every click-driven spec skips WebKit — Playwright's
  // WebKit driver does not reliably deliver taps in this (WSL) environment, so
  // Base UI popups never open (the trigger focuses but no dialog/sheet mounts).
  // Phase 8.3 shipped the mobile bottom-sheet layout (verified on Chromium at a
  // mobile viewport); the interaction itself stays Chromium-only, like the rest.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("create, edit and archive an account", async ({ page }) => {
    const name = `Compte ${Date.now()}`;
    await page.goto("/fr/accounts");
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await page.fill('input[name="name"]', name);
    // Type defaults to "Courant" (CHECKING) in the segmented control.
    await page.fill('input[name="initialBalance"]', "1500");
    await page.fill('input[name="iban"]', "FR76 3000 6000 0112 3456 7890 189");
    await page.getByRole("button", { name: /créer le compte/i }).click();
    // The name shows both in the account card and the global-balance legend, so
    // assert the first match is visible.
    await expect(page.getByText(name).first()).toBeVisible();

    // Renaming leaves the IBAN untouched (the field stays blank on edit).
    const card = page.locator('[data-slot="card"]', { hasText: name });
    await expect(card.getByText("•••• 0189")).toBeVisible();
    await card.getByRole("button", { name: /^actions pour/i }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('input[name="initialBalance"]')).toHaveValue("1\u202f500,00");
    await expect(dialog.locator('input[name="iban"]')).toHaveAttribute("placeholder", /•••• 0189/);
    await dialog.locator('input[name="name"]').fill(`${name} bis`);
    await dialog.getByRole("button", { name: /enregistrer/i }).click();
    const renamed = page.locator('[data-slot="card"]', { hasText: `${name} bis` });
    await expect(renamed.getByText("•••• 0189")).toBeVisible();
  });

  test("a negative balance shows in the expense colour", async ({ page }) => {
    const name = `Découvert ${Date.now()}`;
    await page.goto("/fr/accounts");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau compte/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="initialBalance"]', "-250");
    await page.getByRole("button", { name: /créer le compte/i }).click();

    const balance = page
      .locator('[data-slot="card"]')
      .filter({ hasText: name })
      .last()
      .locator('[data-slot="account-balance"]');
    await expect(balance).toContainText("250,00");
    const [color, expense] = await balance.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--expense)";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(el).color, resolved];
    });
    expect(color).toBe(expense);
  });

  test("archive, unarchive, then delete an account with a typed confirmation", async ({ page }) => {
    const name = `Jetable ${Date.now()}`;
    await page.goto("/fr/accounts");
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le compte/i }).click();
    const card = () => page.locator('[data-slot="card"]').filter({ hasText: name }).last();
    await expect(card()).toBeVisible();

    await card()
      .getByRole("button", { name: /^actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /^archiver$/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^archiver$/i })
      .click();
    const archived = page.locator('[data-slot="archived-accounts"]');
    await expect(archived.getByText(name)).toBeVisible();

    await card()
      .getByRole("button", { name: /^actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /désarchiver/i }).click();
    await expect(archived.getByText(name)).toHaveCount(0);

    await card()
      .getByRole("button", { name: /^actions pour/i })
      .click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: /supprimer définitivement/i });
    await expect(dialog.getByText(/aucune transaction/i)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/saisissez/i).fill(name);
    await confirm.click();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("share an account READ with a household; member sees it read-only", async ({
    page,
    browser,
    baseURL,
  }) => {
    const name = `Partagé ${Date.now()}`;
    // Owner creates an account.
    await page.goto("/fr/accounts");
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="initialBalance"]', "100");
    await page.getByRole("button", { name: /créer le compte/i }).click();
    // The name also appears in the global-balance card legend, so take the last
    // match (the account card comes after the total card).
    const card = page.locator('[data-slot="card"]').filter({ hasText: name }).last();
    await expect(card).toBeVisible();

    // Open the card's kebab → Share, then grant READ to the seeded "E2E Shared".
    await card.getByRole("button", { name: /^actions pour/i }).click();
    await page.getByRole("menuitem", { name: /partager/i }).click();
    await page.getByLabel("E2E Shared").selectOption("READ");
    await expect(page.getByLabel("E2E Shared")).toHaveValue("READ");

    // The member of that household sees the account read-only (no mutate menu).
    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    const mp = await memberCtx.newPage();
    await mp.goto("/fr/accounts");
    const mcard = mp.locator('[data-slot="card"]').filter({ hasText: name }).last();
    await expect(mcard).toBeVisible();
    await expect(mcard.getByText(/lecture/i)).toBeVisible();
    await expect(mcard.getByRole("button", { name: /^actions pour/i })).toHaveCount(0);
    await memberCtx.close();
  });
});

// The stale-session step-up (password or new sign-in) is covered by the integration tests:
// the e2e suite can't age a browser session past the 10-minute window.
test.describe("IBAN reveal (#257)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("a fresh sign-in reveals the full IBAN without asking again", async ({ page }) => {
    await page.goto("/fr/login");
    await page.fill('input[name="email"]', "owner@e2e.local");
    await page.fill('input[name="password"]', "e2e-owner-pw-123456");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    const name = `IBAN ${Date.now()}`;
    await page.goto("/fr/accounts");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau compte/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="iban"]', "FR76 3000 6000 0112 3456 7890 189");
    await page.getByRole("button", { name: /créer le compte/i }).click();

    const card = page.locator('[data-slot="card"]').filter({ hasText: name }).last();
    const iban = card.locator('[data-slot="account-iban"]');
    await expect(iban).toHaveText("•••• 0189");
    await card.getByRole("button", { name: "Afficher l’IBAN" }).click();
    await expect(iban).toHaveText("FR76 3000 6000 0112 3456 7890 189");
    await expect(page.locator('[data-slot="step-up"]')).toHaveCount(0);

    await card.getByRole("button", { name: "Masquer l’IBAN" }).click();
    await expect(iban).toHaveText("•••• 0189");
  });
});

test("unauthenticated /accounts redirects to login", async ({ page }) => {
  await page.goto("/fr/accounts");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Faccounts$/);
});
