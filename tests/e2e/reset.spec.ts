import { test, expect } from "@playwright/test";

test.skip(
  ({ browserName }) => browserName === "webkit",
  "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
);

test("reset request always reports success (no email enumeration)", async ({ page }) => {
  await page.goto("/en/reset");
  await page.fill('input[name="email"]', `nobody-${Date.now()}@bilan.local`);
  await page.click('button[type="submit"]');
  await expect(page.getByText(/reset link has been sent/i)).toBeVisible();
});

test("a dead reset link is rejected before asking for a password", async ({ page }) => {
  await page.goto("/fr/reset/not-a-real-token");
  await expect(page.getByText("Ce lien est invalide ou expiré.", { exact: false })).toBeVisible();
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Demander un nouveau lien" }).click();
  await expect(page).toHaveURL(/\/fr\/reset$/);
});

test("the login page confirms a completed reset", async ({ page }) => {
  await page.goto("/fr/login?reset=1");
  await expect(page.getByText("Votre mot de passe a été modifié.", { exact: false })).toBeVisible();
});
