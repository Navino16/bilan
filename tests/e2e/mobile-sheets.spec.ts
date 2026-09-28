import { test, expect } from "@playwright/test";

// Verifies the Phase-8.3 responsive bottom-sheets: on a mobile viewport the
// account/group create dialogs render as a `Sheet side="bottom"` and open on
// click. Runs on Chromium at a 390px viewport — Playwright's WebKit driver can't
// drive taps in this env (the whole interactive suite is WebKit-skipped), so the
// `mobile` (WebKit) project can only assert non-interactive things; Chromium at a
// mobile viewport gives reliable interaction plus the mobile media query.
test.describe("mobile bottom-sheets", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json", viewport: { width: 390, height: 844 } });
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only mobile-viewport probe");

  async function openViaTrigger(page: import("@playwright/test").Page, triggerName: RegExp) {
    // Retry the first click until the popup mounts (absorbs the hydration race:
    // a click before the island hydrates is a no-op).
    await expect(async () => {
      await page.getByRole("button", { name: triggerName }).click();
      await expect(page.locator('[data-slot="sheet-content"][data-side="bottom"]')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 20_000 });
  }

  test("account create opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/accounts", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouveau compte/i);
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test("group create opens a bottom sheet", async ({ page }) => {
    await page.goto("/fr/groups", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await openViaTrigger(page, /nouveau foyer/i);
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test("transaction filters live in a bottom sheet and combine", async ({ page }) => {
    await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
    // Only search + the « Filtres » button stay inline on mobile.
    await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeHidden();
    await openViaTrigger(page, /^filtres/i);

    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.getByRole("button", { name: "Sorties", exact: true }).click();
    await expect(page).toHaveURL(/dir=out/);
    // A period keeps the other filters.
    await sheet.getByRole("button", { name: "Trimestre", exact: true }).click();
    await expect(page).toHaveURL(/from=.*&to=/);
    expect(page.url()).toContain("dir=out");

    await sheet.getByRole("button", { name: /^(voir|aucune)/i }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: /^filtres/i })).toContainText("2");
  });
});
