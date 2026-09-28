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
  });

  test("a top-level path bypassing the locale proxy renders the themed root 404", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "bilan-theme", value: "dark", url: baseURL! }]);
    // A dotted path is excluded by the proxy matcher, so the root not-found handles it.
    const res = await page.goto("/does-not-exist.xyz", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: /page introuvable/i })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});
