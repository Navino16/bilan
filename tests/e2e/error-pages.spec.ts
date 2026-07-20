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
});
