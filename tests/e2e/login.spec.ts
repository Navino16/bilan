import { test, expect } from "@playwright/test";

// Skipped until credentialed fixtures land in scope 1.5 (admin-created users with
// a known password). The login action + rate limiter are unit/flow covered.
test.skip("login succeeds with valid credentials", async ({ page }) => {
  await page.goto("/fr/login");
  await page.fill('input[name="email"]', "fixture@bilan.local");
  await page.fill('input[name="password"]', "fixture-strong-password-1");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test.skip("locks out after repeated failed attempts", async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    await page.goto("/fr/login");
    await page.fill('input[name="email"]', "fixture@bilan.local");
    await page.fill('input[name="password"]', `wrong-${i}`);
    await page.click('button[type="submit"]');
  }
  await expect(page.getByText(/too many|trop de/i)).toBeVisible();
});
