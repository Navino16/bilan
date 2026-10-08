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

  test("invite a member by code and let them join", async ({ page, browser }) => {
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
    await page.getByRole("button", { name: /envoyer l'invitation/i }).click();
    await expect(page.getByText("member@e2e.local")).toBeVisible();
    const code = (await page.locator("span.font-mono").first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // The member joins with the code from a separate session.
    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL: "http://localhost:3000",
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
    await page.getByRole("button", { name: /envoyer l'invitation/i }).click();
    await page.getByRole("button", { name: "Copier le lien d'invitation" }).click();
    await expect(page.getByRole("button", { name: "Lien copié" })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/fr\/groups\/join\/[\w-]+$/);

    const memberCtx = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
      baseURL: "http://localhost:3000",
    });
    const mp = await memberCtx.newPage();
    await mp.goto(new URL(link).pathname);
    await expect(mp.getByText("Cette invitation a été envoyée à s***@e2e.local.")).toBeVisible();
    await expect(mp.getByRole("button", { name: /accepter/i })).toHaveCount(0);
    await memberCtx.close();
  });
});

test("unauthenticated /groups redirects to login", async ({ page }) => {
  await page.goto("/fr/groups");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ffr%2Fgroups$/);
});
