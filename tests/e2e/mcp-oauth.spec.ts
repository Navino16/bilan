import { createHash, randomBytes } from "node:crypto";
import { test, expect, request as apiRequest, type Browser, type Page } from "@playwright/test";

const REDIRECT_URI = "http://127.0.0.1:43123/callback";
const OWNER = "tests/e2e/.auth/owner.json";

async function setInstanceSwitch(page: Page, enabled: boolean) {
  const form = page.locator("form:has(#set-mcp_enabled)");
  await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(async () => {
    await form.locator("#set-mcp_enabled").selectOption(String(enabled));
    await form.getByRole("button", { name: /enregistrer/i }).click();
    await expect(form.getByText("Enregistré.")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

async function setUserSwitch(page: Page, enabled: boolean) {
  await page.goto("/fr/settings/ai", { waitUntil: "networkidle" });
  const access = page.getByRole("switch", { name: "Autoriser les assistants IA" });
  if ((await access.getAttribute("aria-checked")) === String(enabled)) return;
  await access.click();
  if (enabled) {
    await page
      .locator('[data-slot="confirm-dialog"]')
      .getByRole("button", { name: "Activer" })
      .click();
  }
  await expect(access).toHaveAttribute("aria-checked", String(enabled));
}

async function setSwitches(browser: Browser, enabled: boolean) {
  const admin = await browser.newContext({ storageState: "tests/e2e/.auth/superadmin.json" });
  const owner = await browser.newContext({ storageState: OWNER });
  try {
    if (enabled) await setInstanceSwitch(await admin.newPage(), true);
    await setUserSwitch(await owner.newPage(), enabled);
    if (!enabled) await setInstanceSwitch(await admin.newPage(), false);
  } finally {
    await admin.close();
    await owner.close();
  }
}

// Without the browser's cookies, as an MCP client registers: the plugin refuses a signed-in
// registration (no client privileges configured).
async function registerClient(baseURL: string, name: string): Promise<string> {
  const anonymous = await apiRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const res = await anonymous.post("/api/auth/oauth2/register", {
      data: {
        client_name: name,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { client_id: string }).client_id;
  } finally {
    await anonymous.dispose();
  }
}

function authorizeFlow(clientId: string, baseURL: string, scope: string) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    resource: `${baseURL}/api/mcp`,
  });
  return { url: `/api/auth/oauth2/authorize?${query}`, verifier, state };
}

// The client's loopback redirect, answered in place of the client.
async function captureRedirect(page: Page): Promise<() => Promise<URL>> {
  let captured: string | null = null;
  await page.route("http://127.0.0.1:43123/**", async (route) => {
    captured = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });
  return async () => {
    await expect.poll(() => captured, { timeout: 15_000 }).not.toBeNull();
    return new URL(captured!);
  };
}

const consentCard = (page: Page) => page.locator('[data-slot="oauth-consent"]');

// The plugin's redirects carry no locale: the proxy picks it from Accept-Language.
test.use({ locale: "fr-FR" });

test.describe("OAuth errors on the login page (#456)", () => {
  test("an authorization the provider refused shows its code on the consent page", async ({
    page,
  }) => {
    await page.goto("/fr/login?error=invalid_client&error_description=client%20not%20found");
    await expect(page).toHaveURL(/\/fr\/oauth\/consent\?error=invalid_client$/);
    await expect(consentCard(page)).toContainText("L’autorisation n’a pas pu aboutir.");
    await expect(consentCard(page)).toContainText("invalid_client");
  });

  test("an SSO sign-in error with the same code stays on the login page", async ({ page }) => {
    await page.goto("/fr/login?sso=1&error=access_denied");
    await expect(page).toHaveURL(/\/fr\/login\?/);
    await expect(page.getByRole("alert")).toBeVisible();
  });
});

test.describe("MCP OAuth consent (#456)", () => {
  test.skip(({ browserName }) => browserName === "webkit", "Playwright WebKit taps (project-wide)");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    await setSwitches(browser, true);
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);
    await setSwitches(browser, false);
  });

  test("signed out: login, consent read only, code, token, MCP initialize", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const name = `E2E client ${Date.now()}`;
    const clientId = await registerClient(baseURL!, name);
    const flow = authorizeFlow(clientId, baseURL!, "bilan:read bilan:write offline_access");
    const redirected = await captureRedirect(page);

    await page.goto(flow.url);
    await expect(page).toHaveURL(/\/fr\/login\?callbackUrl=%2Ffr%2Foauth%2Fconsent%3F/);
    await page.fill('input[name="email"]', "owner@e2e.local");
    await page.fill('input[name="password"]', "e2e-owner-pw-123456");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/fr\/oauth\/consent\?/, { timeout: 15_000 });

    const card = consentCard(page);
    await expect(card).toContainText(name);
    await expect(card).toContainText("127.0.0.1:43123");
    await expect(card.getByRole("radio", { name: "Lecture et écriture" })).toBeChecked();
    await card.getByRole("radio", { name: "Lecture seule" }).click();
    await expect(card.getByRole("radio", { name: "Lecture seule" })).toBeChecked();
    await card.getByRole("button", { name: "Autoriser" }).click();

    const url = await redirected();
    expect(url.searchParams.get("state")).toBe(flow.state);
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await request.post("/api/auth/oauth2/token", {
      form: {
        grant_type: "authorization_code",
        code: code!,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: flow.verifier,
        resource: `${baseURL}/api/mcp`,
      },
    });
    expect(tokenRes.status()).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; scope: string };
    expect(tokens.scope.split(" ").sort()).toEqual(["bilan:read", "offline_access"]);

    const mcp = await request.post("/api/mcp", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "e2e", version: "1" },
        },
      },
    });
    expect(mcp.status()).toBe(200);
    expect(await mcp.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: {} } });
  });

  test.describe("signed in", () => {
    test.use({ storageState: OWNER });

    test("Deny sends the client access_denied", async ({ page, baseURL }) => {
      const clientId = await registerClient(baseURL!, `E2E deny ${Date.now()}`);
      const flow = authorizeFlow(clientId, baseURL!, "bilan:read");
      const redirected = await captureRedirect(page);
      await page.goto(flow.url);
      await expect(page).toHaveURL(/\/fr\/oauth\/consent\?/);
      await consentCard(page).getByRole("button", { name: "Refuser" }).click();
      const url = await redirected();
      expect(url.searchParams.get("error")).toBe("access_denied");
      expect(url.searchParams.get("state")).toBe(flow.state);
    });

    test("shows a self-declared name as plain text", async ({ page, baseURL }) => {
      const clientId = await registerClient(baseURL!, "<b>Claude</b>");
      await page.goto(authorizeFlow(clientId, baseURL!, "bilan:read").url);
      const card = consentCard(page);
      await expect(card.getByText("<b>Claude</b>", { exact: true })).toBeVisible();
      await expect(card.locator("b")).toHaveCount(0);
      await expect(card).toContainText("127.0.0.1:43123");
    });
  });
});
