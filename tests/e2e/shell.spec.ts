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
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
});

test.describe("mobile chrome", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("bottom nav visible on mobile", async ({ page, isMobile }) => {
    // The bottom tab bar is `lg:hidden` — only the mobile project renders it.
    test.skip(!isMobile, "bottom nav is mobile-only (lg:hidden)");
    await page.goto("/fr/dashboard");
    await expect(page.getByRole("navigation", { name: "Navigation rapide" })).toBeVisible();
  });
});

// Guards against shipping a primary nav entry that points at an unbuilt route
// (e.g. a "Budgets" link to /budgets before Phase 7 exists): crawl every link
// rendered in the sidebar and assert none resolves to a 4xx/5xx.
test.describe("primary navigation", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("every sidebar link resolves without an error status", async ({ page, isMobile }) => {
    // The sidebar is desktop-only (`hidden lg:flex`); on mobile it never renders.
    test.skip(!!isMobile, "sidebar is desktop-only");
    // Crawls every sidebar route sequentially; a cold dev-server compile per new
    // route can add up, so allow more than the default 30s.
    test.setTimeout(120_000);
    await page.goto("/fr/dashboard");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
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
    await page.fill('input[name="confirmPassword"]', "e2e-usermenu-pw-123");
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

test.describe("deep links", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  const signIn = async (page: import("@playwright/test").Page) => {
    await page.fill('input[name="email"]', "owner@e2e.local");
    await page.fill('input[name="password"]', "e2e-owner-pw-123456");
    await page.click('button[type="submit"]');
  };

  test("a signed-out deep link survives the password login", async ({ page }) => {
    await page.goto("/fr/transactions?month=2026-09");
    await expect(page).toHaveURL(
      /\/fr\/login\?callbackUrl=%2Ffr%2Ftransactions%3Fmonth%3D2026-09$/,
    );
    await signIn(page);
    await expect(page).toHaveURL(/\/fr\/transactions\?month=2026-09$/, { timeout: 15_000 });
    await expect(page).toHaveTitle("Transactions · Bilan");
  });

  test("a stale session cookie still keeps the deep link", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: "stale.token", url: baseURL! },
    ]);
    await page.goto("/fr/accounts?tab=archived");
    await expect(page).toHaveURL(/\/fr\/login\?callbackUrl=%2Ffr%2Faccounts%3Ftab%3Darchived$/);
  });

  test("an off-site callbackUrl falls back to the dashboard", async ({ page, baseURL }) => {
    await page.goto("/fr/login?callbackUrl=%2F%2Fevil.example%2Ffr%2Fdashboard");
    await signIn(page);
    await expect(page).toHaveURL(`${baseURL}/fr/dashboard`, { timeout: 15_000 });
  });

  test("the password field can be revealed", async ({ page }) => {
    await page.goto("/fr/login");
    const password = page.locator('input[name="password"]');
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
    await expect(password).toHaveAttribute("type", "text");
  });
});

test.describe("shell chrome", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("switching language keeps the query string", async ({ page }) => {
    await page.goto("/fr/transactions?month=2026-09");
    await page.getByRole("button", { name: "Passer en anglais (EN)" }).click();
    await expect(page).toHaveURL(/\/en\/transactions\?month=2026-09$/);
    await expect(page).toHaveTitle("Transactions · Bilan");
    // The browsing locale outlives the browser session (#245).
    const cookie = (await page.context().cookies()).find((c) => c.name === "NEXT_LOCALE");
    expect(cookie?.value).toBe("en");
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 60 * 60);
  });

  test("the desktop sidebar stays in view while the page scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/fr/dashboard");
    // Guarantees a scrollable page whatever the fixture data.
    await page.locator("main").evaluate((main) => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      main.append(spacer);
    });
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const top = await page.locator("aside").evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(1);
  });

  test("the mobile drawer scrolls and exposes sign-out at 320x640", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/fr/insights");
    const tabs = page.getByRole("navigation", { name: "Navigation rapide" });
    await expect(tabs.locator('[aria-current="page"]')).toHaveText("Accueil");
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeInViewport();
    await expect(page.getByRole("dialog").getByText("owner@e2e.local")).toBeVisible();
  });
});
