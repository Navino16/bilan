import { test, expect } from "@playwright/test";

test.describe("error pages", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("an unmatched locale path renders the Bilan 404 with a 404 status", async ({ page }) => {
    const res = await page.goto("/fr/does-not-exist-" + "xyz", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: /page introuvable/i })).toBeVisible();
    await expect(page).toHaveTitle("Page introuvable · Bilan");
  });

  test("an unmatched /en/ path renders the English 404 (#226)", async ({ page }) => {
    const res = await page.goto("/en/does-not-exist-xyz/deeper", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    expect(res?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Bilan");
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute(
      "href",
      "/en/dashboard",
    );
  });

  for (const [locale, message] of [
    ["fr", "Cette page n’existe pas ou a été déplacée."],
    ["en", "This page doesn’t exist or has moved."],
  ] as const) {
    test(`the proxy's /${locale}/setup 404 speaks ${locale} once setup is done (#214)`, async ({
      page,
    }) => {
      const res = await page.goto(`/${locale}/setup`, { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByText(message)).toBeVisible();
      // Same title form as every other 404 (#245).
      await expect(page).toHaveTitle(
        `${locale === "fr" ? "Page introuvable" : "Page not found"} · Bilan`,
      );
    });
  }

  test("a top-level path bypassing the locale proxy renders the themed root 404", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "bilan-theme", value: "dark", url: baseURL! },
      { name: "NEXT_LOCALE", value: "fr", url: baseURL! },
    ]);
    // A dotted path is excluded by the proxy matcher, so the root not-found handles it.
    const res = await page.goto("/does-not-exist.xyz", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: /page introuvable/i })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });

  test("the root 404 follows the locale cookie, then the browser language (#245)", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.clearCookies();
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    const res = await page.goto("/does-not-exist.xyz", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    expect(res?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Bilan");
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute(
      "href",
      "/en/dashboard",
    );

    const api = await page.request.get("/api/nope");
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ error: "NOT_FOUND" });

    await context.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: baseURL! }]);
    await page.goto("/does-not-exist.xyz", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
  });
});
