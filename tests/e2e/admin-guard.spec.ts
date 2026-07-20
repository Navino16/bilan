import { test, expect } from "@playwright/test";

// Runnable now: the proxy cookie sniff redirects unauthenticated requests to any
// authenticated area (here /admin) to /login before the layout guard runs.
test("unauthenticated access to /admin redirects to login", async ({ page }) => {
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("non-admin forbidden", () => {
  test.use({ storageState: "tests/e2e/.auth/member.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  // A signed-in non-admin hitting /admin gets a real 403 forbidden page
  // (requirePermission → forbidden()), not a redirect.
  test("a non-admin gets the 403 forbidden page", async ({ page }) => {
    const res = await page.goto("/fr/admin", { waitUntil: "domcontentloaded", timeout: 90_000 });
    expect(res?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1, name: /accès refusé/i })).toBeVisible();
  });
});
