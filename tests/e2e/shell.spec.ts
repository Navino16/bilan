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

// Guards against shipping a primary nav entry that points at an unbuilt route
// (e.g. a "Budgets" link to /budgets before Phase 7 exists): crawl every link
// rendered in the sidebar and assert none resolves to a 4xx/5xx.
test.describe("primary navigation", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("every sidebar link resolves without an error status", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const nav = page.getByRole("navigation", { name: /sidebar/i });
    await expect(nav).toBeVisible();
    const hrefs = await nav
      .locator("a[href]")
      .evaluateAll((els) =>
        els
          .map((e) => (e as HTMLAnchorElement).getAttribute("href"))
          .filter((h): h is string => !!h),
      );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of [...new Set(hrefs)]) {
      const res = await page.goto(href);
      expect(res, `no response for ${href}`).toBeTruthy();
      expect(res!.status(), `error status for ${href}`).toBeLessThan(400);
    }
  });
});
