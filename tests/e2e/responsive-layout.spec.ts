import { test, expect, type Page } from "@playwright/test";

// Below lg (1024px) the shell is the mobile one (drawer + bottom nav); the sidebar
// only shows from lg up (#167). Every page must fit each width without scrolling sideways.
const PAGES = [
  "/fr/dashboard",
  "/fr/transactions",
  "/fr/accounts",
  "/fr/groups",
  "/fr/budgets",
  "/fr/categories",
  "/fr/insights",
  "/fr/import",
  "/fr/settings/security",
  "/fr/settings/data",
];
const ADMIN_PAGES = ["/fr/admin/users", "/fr/admin/audit", "/fr/admin/signup-tokens"];
const WIDTHS = [320, 768, 1024];

async function expectLayout(page: Page, path: string, width: number) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(page.locator("main h1")).toBeVisible();
  const bottomNav = page.getByRole("navigation", { name: "Navigation rapide" });
  if (width < 1024) {
    await expect(bottomNav, path).toBeVisible();
    await expect(page.locator("aside"), path).toBeHidden();
    await expect(page.getByRole("button", { name: "Ouvrir le menu" }), path).toBeVisible();
  } else {
    await expect(page.locator("aside"), path).toBeVisible();
    await expect(bottomNav, path).toBeHidden();
    await expect(page.getByRole("button", { name: "Ouvrir le menu" }), path).toBeHidden();
  }
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: `horizontal overflow on ${path} at ${width}px` },
    )
    .toBeLessThanOrEqual(0);
}

test.describe("responsive layout (#167)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only viewport probe");

  for (const width of WIDTHS) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test.describe("as a user", () => {
        test.use({ storageState: "tests/e2e/.auth/owner.json" });

        test("pages fit and show the matching navigation", async ({ page }) => {
          test.setTimeout(180_000);
          for (const path of PAGES) await expectLayout(page, path, width);
        });
      });

      test.describe("as an admin", () => {
        test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

        test("admin pages fit and show the matching navigation", async ({ page }) => {
          test.setTimeout(120_000);
          for (const path of ADMIN_PAGES) await expectLayout(page, path, width);
        });
      });
    });
  }

  test.describe("transactions list and filters", () => {
    test.use({ storageState: "tests/e2e/.auth/owner.json" });

    test("at 768px: card list and filter sheet", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(page.getByRole("button", { name: /^filtres/i })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeHidden();
      await expect(page.locator('[data-slot="transaction-row"]').first()).toBeVisible();
      await expect(page.locator('[data-slot="row-label"]').first()).toBeHidden();
    });

    test("at 1024px: inline filters and a readable label column", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^filtres/i })).toBeHidden();
      const label = page.locator('[data-slot="row-label"]').first();
      await expect(label).toBeVisible();
      expect((await label.boundingBox())!.width).toBeGreaterThan(300);
    });
  });
});
