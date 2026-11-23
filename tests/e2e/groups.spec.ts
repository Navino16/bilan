import { test, expect } from "@playwright/test";

test.describe("groups", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  // Project-wide convention: click-driven specs skip WebKit — Playwright's WebKit
  // driver doesn't reliably deliver taps in this (WSL) env, so Base UI popups
  // don't open. The Phase-8.3 bottom-sheet layout is verified on Chromium.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("create a group and open its detail", async ({ page }) => {
    const name = `Foyer ${Date.now()}`;
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    const card = page.getByRole("link", { name: new RegExp(name) });
    await expect(card).toBeVisible();

    // Opening the group shows the creator as the sole OWNER member.
    await card.click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    // Scope to main: the email also appears in the sidebar user menu.
    await expect(page.getByRole("main").getByText("owner@e2e.local")).toBeVisible();
  });

  test("a server-side error keeps the typed values, flags the field and focuses it (#165)", async ({
    page,
  }) => {
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    const dialog = page.getByRole("dialog");
    const name = dialog.locator('input[name="name"]');
    const description = dialog.locator('textarea[name="description"]');
    // Spaces pass the browser's `required` check but not the server's trimmed nameSchema.
    await name.fill("   ");
    await description.fill("Une description à garder");
    await dialog.getByRole("button", { name: /créer le foyer/i }).click();

    const fieldError = dialog.getByText("Ce champ est requis.");
    await expect(fieldError).toBeVisible();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    const describedBy = (await name.getAttribute("aria-describedby")) ?? "";
    expect(describedBy).toBe(await fieldError.getAttribute("id"));
    await expect(name).toHaveValue("   ");
    await expect(description).toHaveValue("Une description à garder");
    await expect(name).toHaveAttribute("maxlength", "100");
  });

  test("invite a member by code and let them join", async ({ page, browser, baseURL }) => {
    const name = `Foyer invite ${Date.now()}`;
    // Owner creates a group and opens it.
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);

    // Invite the member and read the generated code from the pending list.
    await page.fill('input[name="email"]', "member@e2e.local");
    await page.getByRole("button", { name: /envoyer l’invitation/i }).click();
    await expect(page.getByText("member@e2e.local")).toBeVisible();
    const code = (await page.locator("span.font-mono").first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // The member joins with the code from a separate session.
    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    const mp = await memberCtx.newPage();
    await mp.goto("/fr/groups");
    // The pending-invitations banner surfaces the invite addressed to this email.
    await expect(mp.getByText(new RegExp(name))).toBeVisible();
    await mp.fill('input[name="code"]', code);
    await mp.getByRole("button", { name: /^rejoindre$/i }).click();
    await mp.waitForURL(/\/groups\/[a-z0-9]+$/i);
    await expect(mp.getByRole("heading", { name })).toBeVisible();
    await memberCtx.close();
  });

  test("an invitation link only works for the invited address", async ({
    page,
    browser,
    baseURL,
    context,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Playwright WebKit doesn't deliver taps in this env");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const name = `Foyer nominatif ${Date.now()}`;
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);

    await page.fill('input[name="email"]', "someone-else@e2e.local");
    await page.getByRole("button", { name: /envoyer l’invitation/i }).click();
    // E2E runs without SMTP: the inviter gets the link to share by hand (#228).
    const share = page.locator('[data-slot="invitation-share"]');
    await expect(share.getByText("Invitation créée")).toBeVisible();
    await expect(
      share.getByText(/^L’e-mail est désactivé\s: transmettez ce lien\.$/),
    ).toBeVisible();
    const shown = await share.getByRole("textbox", { name: "Lien d’invitation" }).inputValue();
    await share.getByRole("button", { name: "Copier le lien d’invitation" }).click();
    await expect(share.getByRole("button", { name: "Lien copié" })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/fr\/groups\/join\/[\w-]+$/);
    expect(link).toBe(shown);

    await page.fill('input[name="email"]', "someone-else@e2e.local");
    await page.getByRole("button", { name: /envoyer l’invitation/i }).click();
    await expect(share.getByText("Invitation renouvelée")).toBeVisible();
    await expect(page.getByRole("main").getByText("someone-else@e2e.local")).toHaveCount(1);
    expect(await share.getByRole("textbox").inputValue()).toBe(shown);

    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    const mp = await memberCtx.newPage();
    await mp.goto(new URL(link).pathname);
    await expect(mp.getByText("Cette invitation a été envoyée à s***@e2e.local.")).toBeVisible();
    await expect(mp.getByRole("button", { name: /accepter/i })).toHaveCount(0);
    await memberCtx.close();
  });

  test("an unverified address gets a hint instead of its invitations, the link still works (#240)", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const name = `Foyer non vérifié ${stamp}`;
    const email = `unverified-${stamp}@e2e.local`;
    const password = "e2e-unverified-password-123";

    await page.goto("/fr/groups");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau foyer/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);
    await page.fill('input[name="email"]', email);
    await page.getByRole("button", { name: /envoyer l’invitation/i }).click();
    const share = page.locator('[data-slot="invitation-share"]');
    const link = await share.getByRole("textbox", { name: "Lien d’invitation" }).inputValue();
    expect(link).toMatch(/\/fr\/groups\/join\/[\w-]+$/);

    // A fresh sign-up has an unverified address; e2e runs without SMTP.
    // Explicitly signed out: browser.newContext() inherits the describe's owner storageState.
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const np = await ctx.newPage();
      await np.goto("/fr/register");
      await expect(np).toHaveURL(/\/fr\/register$/);
      await expect(async () => {
        if (!/\/dashboard$/.test(np.url())) {
          await np.fill('input[name="name"]', "E2E Unverified");
          await np.fill('input[name="email"]', email);
          await np.fill('input[name="password"]', password);
          await np.fill('input[name="confirmPassword"]', password);
          await np.click('button[type="submit"]');
        }
        await expect(np).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
      }).toPass({ timeout: 45_000 });
      await expect(np.locator('[data-slot="verify-email-banner"]')).toHaveCount(0);

      await np.goto("/fr/groups");
      await expect(np.getByRole("heading", { name: "Foyers", level: 1 })).toBeVisible();
      const hint = np.locator('[data-slot="unverified-invitations-hint"]');
      await expect(hint).toContainText("une fois celle-ci vérifiée par un administrateur");
      await expect(np.locator('[data-slot="pending-invitation"]')).toHaveCount(0);
      await expect(np.getByText(name)).toHaveCount(0);

      await np.goto(new URL(link).pathname);
      await expect(async () => {
        await np.getByRole("button", { name: /accepter/i }).click();
        await np.waitForURL(/\/groups\/[a-z0-9]+$/i, { timeout: 5_000 });
      }).toPass({ timeout: 20_000 });
      await expect(np.getByRole("heading", { name })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("the invitee can decline a pending invitation (#228)", async ({
    page,
    browser,
    baseURL,
  }) => {
    const name = `Foyer refus ${Date.now()}`;
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);
    await page.fill('input[name="email"]', "member@e2e.local");
    await page.getByRole("button", { name: /envoyer l’invitation/i }).click();
    await expect(page.locator('[data-slot="invitation-share"]')).toBeVisible();

    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL,
    });
    const mp = await memberCtx.newPage();
    await mp.goto("/fr/groups");
    const row = mp.locator('[data-slot="pending-invitation"]', { hasText: name });
    await row.getByRole("button", { name: "Refuser" }).click();
    const dialog = mp.getByRole("alertdialog");
    await expect(dialog.getByText("Refuser cette invitation ?")).toBeVisible();
    await dialog.getByRole("button", { name: "Refuser" }).click();
    await expect(row).toHaveCount(0);
    await mp.reload();
    await expect(mp.locator('[data-slot="pending-invitation"]', { hasText: name })).toHaveCount(0);
    await memberCtx.close();
  });
});

test("unauthenticated /groups redirects to login", async ({ page }) => {
  await page.goto("/fr/groups");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Fgroups$/);
});
