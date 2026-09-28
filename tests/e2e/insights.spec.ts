import { test, expect } from "@playwright/test";

test.describe("insights", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("renders the what-changed block for a past period, without the in-progress note", async ({
    page,
  }) => {
    // The changes block needs spending in the period: seed one expense.
    await page.goto("/fr/accounts");
    await expect(async () => {
      await page
        .getByRole("button", { name: /saisir une transaction/i })
        .first()
        .click();
      await expect(page.locator('input[name="label"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="date"]', "2026-03-20");
    await page.fill('input[name="amount"]', "-35");
    await page.fill('input[name="label"]', `Insights ${Date.now()}`);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    await page.goto("/fr/insights?from=2026-03-01&to=2026-03-31", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    // Absorb the dev-server cold-compile race on the first load.
    const heading = page.getByRole("heading", { level: 1, name: /analyses/i });
    await expect(async () => {
      await expect(heading).toBeVisible();
    }).toPass();

    await expect(page.locator('[data-slot="insights-changes"]')).toBeVisible();
    await expect(page.locator('[data-slot="insights-merchants"]')).toBeVisible();
    await expect(page.locator('[data-slot="period-in-progress"]')).toHaveCount(0);
  });

  test("flags the current period as in progress on insights and the dashboard", async ({
    page,
  }) => {
    for (const path of ["/fr/insights", "/fr/dashboard"]) {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(async () => {
        await expect(page.locator('[data-slot="period-in-progress"]')).toBeVisible();
      }).toPass();
    }
  });
});
