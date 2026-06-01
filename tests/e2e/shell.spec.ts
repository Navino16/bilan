import { test, expect } from "@playwright/test";

// Runnable now: an unauthenticated request to the dashboard is bounced to /login
// by the proxy guard (the shell never renders without a session).
test("unauthenticated access to /dashboard redirects to login", async ({ page }) => {
  await page.goto("/fr/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

// Skipped until credentialed fixtures land (a signed-in session cookie). These
// assert the responsive chrome: the sidebar on desktop (chromium project) and the
// bottom tab bar on mobile (iPhone 14 / mobile project).
test.skip("sidebar visible on desktop", async ({ page }) => {
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("navigation", { name: /sidebar/i })).toBeVisible();
});

test.skip("bottom nav visible on mobile", async ({ page }) => {
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("navigation", { name: /bottom/i })).toBeVisible();
});
