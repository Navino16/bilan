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

test.describe("mobile chrome", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("bottom nav visible on mobile", async ({ page, isMobile }) => {
    // The bottom tab bar is `md:hidden` — only the mobile project renders it.
    test.skip(!isMobile, "bottom nav is mobile-only (md:hidden)");
    await page.goto("/fr/dashboard");
    await expect(page.getByRole("navigation", { name: /bottom/i })).toBeVisible();
  });
});

// Guards against shipping a primary nav entry that points at an unbuilt route
// (e.g. a "Budgets" link to /budgets before Phase 7 exists): crawl every link
// rendered in the sidebar and assert none resolves to a 4xx/5xx.
test.describe("primary navigation", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("every sidebar link resolves without an error status", async ({ page, isMobile }) => {
    // The sidebar is desktop-only (`hidden md:flex`); on mobile it never renders.
    test.skip(!!isMobile, "sidebar is desktop-only");
    // Crawls every sidebar route sequentially; a cold dev-server compile per new
    // route can add up, so allow more than the default 30s.
    test.setTimeout(120_000);
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

// Signs out a throwaway user: logging out a shared storageState would revoke the
// session the other specs rely on.
test.describe("user menu", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("opens and signs out", async ({ page }) => {
    const email = `usermenu-${Date.now()}@e2e.local`;
    await page.goto("/fr/register");
    await page.fill('input[name="name"]', "E2E Menu");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "e2e-usermenu-pw-123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const trigger = page.getByRole("button", { name: "Menu du compte" });
    await expect(async () => {
      await trigger.click();
      await expect(page.getByRole("menuitem", { name: "Se déconnecter" })).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("menu").getByText(email)).toBeVisible();
    expect(pageErrors).toEqual([]);

    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
