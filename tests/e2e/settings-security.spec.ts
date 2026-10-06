import { test, expect } from "@playwright/test";

test.describe("security settings", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("the 2FA controls render", async ({ page }) => {
    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1, name: /sécurité/i })).toBeVisible();
    await expect(page.locator('[data-slot="two-factor-controls"]')).toBeVisible();
  });
});

test.describe("change password", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("changes the password then signs in with the new one", async ({ page, context }) => {
    const email = `pwchange-${Date.now()}@e2e.local`;
    const oldPassword = "e2e-old-password-123";
    const newPassword = "e2e-new-password-456";

    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Password");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', oldPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const card = page.locator('[data-slot="password-controls"]');
    // Retry until the client island has hydrated.
    await expect(async () => {
      await card.getByRole("button", { name: "Modifier" }).click();
      await expect(card.getByLabel("Mot de passe actuel")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await card.getByLabel("Mot de passe actuel").fill(oldPassword);
    await card.getByLabel("Nouveau mot de passe", { exact: true }).fill(newPassword);
    await card.getByLabel("Confirmer le nouveau mot de passe").fill(newPassword);
    await card.getByRole("button", { name: "Changer le mot de passe" }).click();
    await expect(card.getByText("Votre mot de passe a été modifié.")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/security$/);

    await context.clearCookies();
    await page.goto("/fr/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', newPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  });
});

test.describe("active sessions", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("signs other devices out, which lose access on their next request", async ({
    page,
    browser,
  }) => {
    const email = `sessions-${Date.now()}@e2e.local`;
    const password = "e2e-sessions-password-123";

    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Sessions");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    const devices = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ storageState: undefined });
      const device = await context.newPage();
      await device.goto("/fr/login");
      await device.fill('input[name="email"]', email);
      await device.fill('input[name="password"]', password);
      await device.click('button[type="submit"]');
      await expect(device).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
      devices.push(device);
    }

    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const card = page.locator('[data-slot="sessions-controls"]');
    await expect(card.getByText("Cet appareil")).toBeVisible();
    await expect(card.getByText("Autres appareils · 2")).toBeVisible();
    // Retry until the client island has hydrated.
    await expect(async () => {
      await card
        .getByRole("button", { name: /^Déconnecter Chrome/ })
        .first()
        .click();
      await expect(card.getByText("Autres appareils · 1")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    await card.getByRole("button", { name: "Tout déconnecter" }).click();
    await expect(card.getByText("Aucun autre appareil connecté.")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/security$/);

    for (const device of devices) {
      await device.goto("/fr/dashboard");
      await expect(device).toHaveURL(/\/login/, { timeout: 15_000 });
      await device.context().close();
    }
  });
});

test.describe("passkeys", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "The CDP virtual authenticator is Chromium-only",
  );

  test("adds, renames, signs in with and deletes a passkey", async ({ page, context }) => {
    test.setTimeout(90_000);
    const email = `passkeys-${Date.now()}@e2e.local`;
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Passkeys");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "e2e-passkeys-password-123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const card = page.locator('[data-slot="passkeys-controls"]');
    await expect(card.getByText("Aucune passkey pour le moment.")).toBeVisible();
    // Retry until the client island has hydrated.
    await expect(async () => {
      await card.getByRole("button", { name: "Ajouter" }).click();
      await expect(card.getByText("Vos passkeys · 1")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    // A retried click on an already-added passkey would surface ALREADY_REGISTERED.
    await expect(card.getByRole("alert")).toHaveCount(0);
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials.map((c) => c.userName)).toEqual([email]);

    await card.getByRole("button", { name: /^Renommer/ }).click();
    await card.getByLabel("Nom de la passkey").fill("Clé e2e");
    await card.getByRole("button", { name: "Enregistrer" }).click();
    await expect(card.getByText("Clé e2e")).toBeVisible();

    await context.clearCookies();
    await page.goto("/fr/login");
    await expect(async () => {
      await page.getByRole("button", { name: "Se connecter avec une passkey" }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
    }).toPass({ timeout: 20_000 });

    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(async () => {
      await card.getByRole("button", { name: "Supprimer Clé e2e" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    await expect(card.getByText("Aucune passkey pour le moment.")).toBeVisible();
  });
});
