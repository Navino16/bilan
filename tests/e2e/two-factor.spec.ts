import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), matching Better Auth's defaults.
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/[\s=]/g, "").toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// A code is accepted once per 30 s step (#223): wait for the step after `used`.
async function nextTotp(page: Page, base32: string, used: string): Promise<string> {
  while (totp(base32) === used) await page.waitForTimeout(1_000);
  return totp(base32);
}

// Under `next start` Better Auth throttles /two-factor/* to 3 requests per 10 s per
// IP; wait it out so the test exercises our own attempt guard, not that throttle.
async function submitCode(page: Page, button = "Vérifier") {
  for (let i = 0; i < 4; i++) {
    const response = page.waitForResponse((r) => r.url().includes("/api/auth/two-factor/verify"));
    await page.getByRole("button", { name: button, exact: true }).click();
    const r = await response;
    if (r.status() !== 429 || (await r.json()).code === "TOO_MANY_ATTEMPTS") return;
    await page.waitForTimeout(10_000);
  }
  throw new Error("two-factor verification still throttled");
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/fr/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "Vérification" })).toBeVisible({
    timeout: 15_000,
  });
}

async function register(page: Page, email: string, password: string) {
  await page.goto("/fr/register");
  await page.fill('input[name="name"]', "E2E Two Factor");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

async function enrol(page: Page, password: string) {
  await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
  const card = page.locator('[data-slot="two-factor-controls"]');
  await card.locator("#tfa-pw-enable").fill(password);
  await card.locator("#tfa-pw-enable").press("Enter");
  await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible({ timeout: 15_000 });
  const secret = (await card.locator("code").textContent())!.replace(/\s/g, "");
  const backupCodes = (await card.getByRole("list").locator("li").allTextContents()).map((c) =>
    c.trim(),
  );
  const enrolCode = totp(secret);
  await card.locator("#tfa-code").fill(enrolCode);
  await submitCode(page, "Vérifier et activer");
  await expect(page.getByText("La double authentification est activée")).toBeVisible({
    timeout: 15_000,
  });
  return { card, secret, backupCodes, enrolCode };
}

test.describe("two-factor sign-in", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("enrols with the QR step, then signs in with a TOTP and a backup code", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const email = `twofactor-${Date.now()}@e2e.local`;
    const password = "e2e-twofactor-pw-123";

    await register(page, email, password);
    const { card, secret, backupCodes, enrolCode } = await enrol(page, password);
    const [backupCode, disableCode] = backupCodes;

    // A password alone must not open a session.
    await context.clearCookies();
    await signInWithPassword(page, email, password);
    await page.getByRole("button", { name: /Retour/ }).click();
    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await signInWithPassword(page, email, password);
    await expect(page.getByLabel("Faire confiance à cet appareil")).not.toBeChecked();
    await page.getByLabel("Code de vérification").fill("000000");
    await submitCode(page);
    await expect(page.getByText("Code invalide. Réessayez.")).toBeVisible();
    await page.getByLabel("Code de vérification").fill(await nextTotp(page, secret, enrolCode));
    await submitCode(page);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    // Five wrong codes burn the pending sign-in: the password step is required again.
    await context.clearCookies();
    await signInWithPassword(page, email, password);
    const codeField = page.getByLabel("Code de vérification");
    for (let i = 0; i < 5; i++) {
      await codeField.fill("000000");
      await submitCode(page);
      await expect(page.getByText("Code invalide. Réessayez.")).toBeVisible();
    }
    await codeField.fill(totp(secret));
    await submitCode(page);
    await expect(page.getByText("Trop de tentatives.", { exact: false })).toBeVisible();
    await codeField.fill(totp(secret));
    await submitCode(page);
    await expect(page.getByText("La vérification a expiré.", { exact: false })).toBeVisible();

    await context.clearCookies();
    await signInWithPassword(page, email, password);
    await page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await page.getByLabel("Code de secours").fill(backupCode);
    await submitCode(page);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    // Disabling takes the password and a second factor (#243).
    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await card.locator("#tfa-pw-disable").fill(password);
    const disable = card.getByRole("button", { name: "Désactiver" });
    await expect(disable).toBeDisabled();
    await card.getByLabel("Code d’authentification").fill("zzzzz-zzzzz");
    await disable.click();
    await expect(card.getByText("Code invalide. Réessayez.")).toBeVisible();
    await card.getByLabel("Code d’authentification").fill(disableCode);
    await disable.click();
    await expect(page.getByText("La double authentification n’est pas encore activée")).toBeVisible(
      {
        timeout: 15_000,
      },
    );
  });

  test("regenerates the backup codes and forgets a trusted device (#256)", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const email = `twofactor-self-${Date.now()}@e2e.local`;
    const password = "e2e-twofactor-pw-456";
    await register(page, email, password);
    const { secret, backupCodes, enrolCode } = await enrol(page, password);
    const codesBlock = page.locator('[data-slot="backup-codes-controls"]');
    await expect(codesBlock).toContainText("10 codes de secours restants.");

    await context.clearCookies();
    await signInWithPassword(page, email, password);
    await page.getByLabel("Faire confiance à cet appareil").check();
    await page.getByLabel("Code de vérification").fill(await nextTotp(page, secret, enrolCode));
    await submitCode(page);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const devices = page.locator('[data-slot="trusted-devices-controls"]');
    await expect(devices.locator("li")).toHaveCount(1);
    await expect(devices.locator("li")).toContainText("Cet appareil");

    await expect(async () => {
      await codesBlock.getByRole("button", { name: "Générer de nouveaux codes" }).click();
      await expect(codesBlock.locator("#tfa-pw-codes")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await codesBlock.locator("#tfa-pw-codes").fill(password);
    await codesBlock.getByLabel("Code d’authentification").fill(backupCodes[0]);
    await codesBlock.getByRole("button", { name: "Générer de nouveaux codes" }).click();
    const newCodes = codesBlock.getByRole("list", { name: "Codes de secours" }).locator("li");
    await expect(newCodes).toHaveCount(10, { timeout: 15_000 });
    const newCode = (await newCodes.nth(0).textContent())!.trim();
    expect(backupCodes).not.toContain(newCode);
    await expect(codesBlock.getByRole("button", { name: "Télécharger" })).toBeVisible();
    await codesBlock.getByRole("button", { name: "Terminé" }).click();
    await expect(codesBlock).toContainText("10 codes de secours restants.");

    await devices.getByRole("button", { name: /^Oublier / }).click();
    await expect(devices.getByText("Aucun appareil de confiance.")).toBeVisible();

    await context.clearCookies({ name: /session_token/ });
    await signInWithPassword(page, email, password);
    await page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await page.getByLabel("Code de secours").fill(backupCodes[1]);
    await submitCode(page);
    await expect(page.getByText("Code invalide. Réessayez.")).toBeVisible();
    await page.getByLabel("Code de secours").fill(newCode);
    await submitCode(page);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  });
});
