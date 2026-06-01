import { test, expect } from "@playwright/test";

// Runnable now: the proxy cookie sniff redirects unauthenticated requests to any
// authenticated area (here /admin) to /login before the layout guard runs.
test("unauthenticated access to /admin redirects to login", async ({ page }) => {
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/login$/);
});

// Skipped until credentialed fixtures land (an admin-created USER with a known
// password). The RBAC gate itself (requirePermission → /403) is unit/flow covered
// in the integration suite. Pre-conditions: sign a USER in via auth.api.signInEmail
// and copy the cookie into the browser context.
test.skip("non-admin user is redirected from /admin to /403", async ({ page }) => {
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/403$/);
});
