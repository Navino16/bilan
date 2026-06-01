import { test, expect } from "@playwright/test";

// Skipped until credentialed fixtures land in scope 1.5. The reset request/confirm
// actions use Better Auth + the dev-fallback link (logged + audited).
test.skip("reset request always reports success (no email enumeration)", async ({ page }) => {
  await page.goto("/fr/reset");
  await page.fill('input[name="email"]', "whoever@bilan.local");
  await page.click('button[type="submit"]');
  await expect(page.getByText(/lien de réinitialisation|reset link/i)).toBeVisible();
});
