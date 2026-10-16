import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Page } from "@playwright/test";

// The app server fetches discovery/token/userinfo; the browser follows the authorize redirect.
// E2E_IDP_HOST lets a containerised app reach this process (e.g. host.docker.internal).
const SERVER_HOST = process.env.E2E_IDP_HOST ?? "127.0.0.1";
const MEMBER_EMAIL = "member@e2e.local";

let idp: Server;
// The account the stub IdP signs in.
let idpUser = { sub: "e2e-member-sub", email: MEMBER_EMAIL };
let port = 0;
const serverBase = () => `http://${SERVER_HOST}:${port}`;

function stubIdp(req: IncomingMessage, res: ServerResponse) {
  req.resume();
  const url = new URL(req.url ?? "/", "http://idp.invalid");
  const json = (body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return json({
        issuer: serverBase(),
        authorization_endpoint: `http://127.0.0.1:${port}/authorize`,
        token_endpoint: `${serverBase()}/token`,
        userinfo_endpoint: `${serverBase()}/userinfo`,
      });
    case "/authorize": {
      // Consent is implicit: straight back to the app's callback with a code.
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "e2e-code");
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    case "/token":
      return json({ access_token: "e2e-at", token_type: "Bearer", expires_in: 3600 });
    case "/userinfo":
      return json({ ...idpUser, email_verified: true, name: "M" });
    default:
      res.writeHead(404);
      res.end();
  }
}

async function addProvider(page: Page, key: string, name: string, allowSignUp = false) {
  const addForm = page.locator("form:has(#ap-new-key)");
  await page.goto("/fr/admin/auth-providers", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(async () => {
    await addForm.locator("#ap-new-key").fill(key);
    await addForm.locator("#ap-new-type").selectOption("oidc");
    await addForm.locator("#ap-new-displayName").fill(name);
    await addForm.locator("#ap-new-issuer").fill(serverBase());
    await addForm.locator("#ap-new-clientId").fill("e2e-client");
    await addForm.locator("#ap-new-clientSecret").fill("e2e-secret");
    await addForm.locator("#ap-new-allowSignUp").setChecked(allowSignUp);
    await addForm.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.locator(`form:has(#ap-${key}-key)`)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

async function deleteProvider(page: Page, key: string) {
  const editForm = page.locator(`form:has(#ap-${key}-key)`);
  await page.goto("/fr/admin/auth-providers", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await editForm.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(editForm).toHaveCount(0);
}

test.describe("SSO identities (#204)", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test.beforeAll(async () => {
    idp = createServer(stubIdp);
    await new Promise<void>((resolve) => idp.listen(0, "0.0.0.0", resolve));
    port = (idp.address() as AddressInfo).port;
  });

  test.afterAll(async () => {
    if (idp) await new Promise<void>((resolve) => idp.close(() => resolve()));
  });

  test("links an OIDC identity from Settings, signs in with it, then unlinks it", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const key = `e2e-idp-${Date.now()}`;
    const name = `E2E IdP ${Date.now()}`;
    const admin = await browser.newContext({ storageState: "tests/e2e/.auth/superadmin.json" });
    const anonContext = await browser.newContext();
    const memberContext = await browser.newContext({
      storageState: "tests/e2e/.auth/member.json",
    });
    const adminPage = await admin.newPage();
    const anon = await anonContext.newPage();
    const member = await memberContext.newPage();
    // Warm every route's provider and handler caches: the admin change must still apply at once (#208).
    await anon.goto("/fr/login", { waitUntil: "networkidle", timeout: 30_000 });
    expect((await anon.request.get("/api/auth/ok")).ok()).toBe(true);
    await member.goto("/fr/settings/security", { waitUntil: "networkidle" });
    await addProvider(adminPage, key, name);
    try {
      const continueWith = anon.getByRole("button", { name: `Continuer avec ${name}` });
      await anon.goto("/fr/login", { waitUntil: "networkidle", timeout: 30_000 });
      // Same email as the member, but nothing is linked yet: no implicit linking (#200).
      await continueWith.click({ timeout: 2000 });
      await expect(anon).toHaveURL(/\/fr\/login\?error=account_not_linked/, { timeout: 10_000 });
      await expect(anon.getByText(/autre moyen de connexion, puis liez-la/)).toBeVisible();

      const row = member.locator(`[data-identity="${key}"]`);
      const linkButton = member.getByRole("button", { name: `Lier ${name}` });
      await member.goto("/fr/settings/security", { waitUntil: "networkidle" });
      await expect(linkButton).toBeVisible({ timeout: 2000 });
      // The Server Action returns the IdP URL; the state cookie it sets must survive the round trip.
      await linkButton.click();
      await expect(member).toHaveURL(/\/fr\/settings\/security\?linked=/, { timeout: 30_000 });
      await expect(member.getByText(new RegExp(`${name}.*est maintenant liée`))).toBeVisible();
      await expect(row).toContainText(name);

      await expect(async () => {
        await anon.goto("/fr/login", { waitUntil: "networkidle", timeout: 30_000 });
        await continueWith.click({ timeout: 2000 });
        await expect(anon).toHaveURL(/\/fr\/dashboard$/, { timeout: 5000 });
      }).toPass({ timeout: 30_000 });

      await row.getByRole("button", { name: `Délier ${name}` }).click();
      await member.getByRole("dialog").getByRole("button", { name: "Délier" }).click();
      await expect(row).toHaveCount(0);
      await expect(linkButton).toBeVisible();
    } finally {
      await anonContext.close();
      await memberContext.close();
      await deleteProvider(adminPage, key);
      await admin.close();
    }
  });

  test("an SSO-only account is told its IdP handles two-factor authentication (#256)", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const key = `e2e-idp-sso-${stamp}`;
    const name = `E2E SSO ${stamp}`;
    idpUser = { sub: `e2e-sso-only-${stamp}`, email: `sso-only-${stamp}@e2e.local` };
    const admin = await browser.newContext({ storageState: "tests/e2e/.auth/superadmin.json" });
    const anonContext = await browser.newContext();
    const adminPage = await admin.newPage();
    const anon = await anonContext.newPage();
    await addProvider(adminPage, key, name, true);
    try {
      await expect(async () => {
        await anon.goto("/fr/login", { waitUntil: "networkidle", timeout: 30_000 });
        await anon.getByRole("button", { name: `Continuer avec ${name}` }).click({ timeout: 2000 });
        await expect(anon).not.toHaveURL(/\/login/, { timeout: 5000 });
      }).toPass({ timeout: 30_000 });

      await anon.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(anon.locator('[data-slot="two-factor-sso-only"]')).toContainText(
        "Votre compte n’a pas de mot de passe",
      );
      await expect(anon.locator("#tfa-pw-enable")).toHaveCount(0);
    } finally {
      idpUser = { sub: "e2e-member-sub", email: MEMBER_EMAIL };
      await anonContext.close();
      await deleteProvider(adminPage, key);
      await admin.close();
    }
  });
});
