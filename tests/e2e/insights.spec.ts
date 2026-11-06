import { test, expect } from "@playwright/test";

test.describe("insights", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("renders the overview and by-category cards for a past period, without the in-progress note", async ({
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

    await expect(page.locator('[data-slot="insights-overview"]')).toBeVisible();
    await expect(page.locator('[data-slot="overview-month"]')).toHaveCount(12);
    await expect(page.locator('[data-slot="insights-categories"]')).toBeVisible();
    await expect(page.locator('[data-slot="insights-merchants"]')).toBeVisible();
    await expect(page.locator('[data-slot="period-in-progress"]')).toHaveCount(0);
  });

  test("drills down from the uncategorized line and a merchant row to the filtered list", async ({
    page,
  }) => {
    const label = `Drilldown ${Date.now()}`;
    await page.goto("/fr/accounts");
    await expect(async () => {
      await page
        .getByRole("button", { name: /saisir une transaction/i })
        .first()
        .click();
      await expect(page.locator('input[name="label"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="date"]', "2025-11-12");
    await page.fill('input[name="amount"]', "-42");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();

    const insights = "/fr/insights?from=2025-11-01&to=2025-11-30";
    await page.goto(insights, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const uncategorized = page.locator('[data-slot="insights-uncategorized"]');
    await expect(async () => {
      await expect(uncategorized).toBeVisible();
    }).toPass();
    await uncategorized.click();
    await expect(page).toHaveURL(
      /\/fr\/transactions\?.*from=2025-11-01.*dir=out.*categoryId=none/,
      {
        timeout: 60_000,
      },
    );
    await expect(page.getByRole("button", { name: "Sans catégorie", exact: true })).toBeVisible();
    await expect(page.getByText(label).first()).toBeVisible();

    await page.goto(insights, { waitUntil: "domcontentloaded" });
    await page.locator('[data-slot="insights-merchants"] a', { hasText: "Drilldown" }).click();
    await expect(page).toHaveURL(/search=Drilldown/, { timeout: 60_000 });
    await expect(page.getByText(label).first()).toBeVisible();
  });

  test("compares with the 3-month average by default, another baseline kept while browsing", async ({
    page,
  }) => {
    await page.goto("/fr/insights?from=2026-03-01&to=2026-03-31", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const baseline = page.locator('[data-slot="baseline-select"]');
    await expect(async () => {
      await expect(baseline).toBeVisible();
    }).toPass();
    // Selecting before hydration changes the value without firing React's onChange.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-slot="baseline-select"]');
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
    await expect(baseline).toHaveValue("avg3");
    await expect(page.locator('[data-slot="insights-categories"]')).toContainText(
      /moyenne déc\.\s2025\s–\sfévr\.\s2026/,
    );
    await baseline.selectOption("prev");
    await expect(page).toHaveURL(/vs=prev/, { timeout: 60_000 });
    await expect(page.locator('[data-slot="insights-categories"]')).toContainText(
      /mars 2026 vs février 2026/i,
    );

    await page.getByRole("button", { name: "Période précédente" }).click();
    await expect(page).toHaveURL(/from=2026-02-01.*vs=prev|vs=prev.*from=2026-02-01/, {
      timeout: 60_000,
    });
    await expect(baseline).toHaveValue("prev");

    await page.goto("/fr/insights?from=2026-01-01&to=2026-03-31&vs=avg3", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-slot="insights-categories"]')).toBeVisible();
    await expect(baseline).toHaveCount(0);
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
