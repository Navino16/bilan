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

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/fr/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "Vérification" })).toBeVisible({
    timeout: 15_000,
  });
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
    test.setTimeout(120_000);
    const email = `twofactor-${Date.now()}@e2e.local`;
    const password = "e2e-twofactor-pw-123";

    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Two Factor");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const card = page.locator('[data-slot="two-factor-controls"]');
    await card.locator("#tfa-pw-enable").fill(password);
    await card.locator("#tfa-pw-enable").press("Enter");
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible({ timeout: 15_000 });
    const secret = (await card.locator("code").textContent())!.replace(/\s/g, "");
    const backupCode = (await card.getByRole("list").locator("li").first().textContent())!.trim();

    await card.locator("#tfa-code").fill(totp(secret));
    await card.getByRole("button", { name: "Vérifier et activer" }).click();
    await expect(page.getByText("La double authentification est activée")).toBeVisible({
      timeout: 15_000,
    });

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
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByText("Code invalide. Réessayez.")).toBeVisible();
    await page.getByLabel("Code de vérification").fill(totp(secret));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    // Five wrong codes burn the pending sign-in: the password step is required again.
    await context.clearCookies();
    await signInWithPassword(page, email, password);
    const codeField = page.getByLabel("Code de vérification");
    for (let i = 0; i < 5; i++) {
      await codeField.fill("000000");
      await page.getByRole("button", { name: "Vérifier" }).click();
      await expect(page.getByText("Code invalide. Réessayez.")).toBeVisible();
    }
    await codeField.fill(totp(secret));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByText("Trop de tentatives.", { exact: false })).toBeVisible();
    await codeField.fill(totp(secret));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByText("La vérification a expiré.", { exact: false })).toBeVisible();

    await context.clearCookies();
    await signInWithPassword(page, email, password);
    await page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await page.getByLabel("Code de secours").fill(backupCode);
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  });
});
