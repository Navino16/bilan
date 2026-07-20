import { test, expect } from "@playwright/test";

test.describe("security settings", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("the 2FA controls render", async ({ page }) => {
    await page.goto("/fr/settings/security", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1, name: /sécurité/i })).toBeVisible();
    await expect(page.locator('[data-slot="two-factor-controls"]')).toBeVisible();
  });
});
