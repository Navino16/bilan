import { test, expect } from "@playwright/test";

test.describe("insights", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("renders the analyses heading and the spend-trend chart", async ({ page }) => {
    // Target a period that has seeded data — an empty period now shows a "no data"
    // message instead of the (flat, meaningless) trend bars.
    await page.goto("/fr/insights?from=2026-03-01&to=2026-03-31", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    // Absorb the dev-server cold-compile race on the first load.
    const heading = page.getByRole("heading", { level: 1, name: /analyses/i });
    await expect(async () => {
      await expect(heading).toBeVisible();
    }).toPass();

    await expect(page.locator('[data-slot="insights-trend"]')).toBeVisible();
  });
});
