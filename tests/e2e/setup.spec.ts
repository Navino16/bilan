import { test, expect } from "@playwright/test";

// Skipped until the e2e job wires a fresh-DB reset between runs (the wizard can
// only run when User.count() === 0). completeSetup() is covered by the
// integration suite (tests/integration/setup-wizard.test.ts).
test.skip("setup wizard creates the first user", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.fill('input[name="name"]', "Admin");
  await page.fill('input[name="email"]', "admin@bilan.local");
  await page.fill('input[name="password"]', "admin-strong-password-1!");
  await page.click('button[type="submit"]');
  await expect(page.getByText(/registration mode|mode d’inscription/i)).toBeVisible();
});
