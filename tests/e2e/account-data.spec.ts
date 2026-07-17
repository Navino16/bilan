import { test, expect } from "@playwright/test";

test.describe("account data", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("the CSV export endpoint returns a text/csv attachment", async ({ page }) => {
    const res = await page.request.get("/api/export/transactions");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
  });

  test("the data settings page renders the export and danger-zone controls", async ({ page }) => {
    // A brand-new route compiles on first hit in the dockerized dev server.
    await page.goto("/fr/settings/data", { waitUntil: "domcontentloaded", timeout: 90_000 });

    const heading = page.getByRole("heading", { level: 1, name: /données/i });
    await expect(async () => {
      await expect(heading).toBeVisible();
    }).toPass();

    await expect(page.getByText("Zone de danger")).toBeVisible();
    await expect(page.getByRole("link", { name: /transactions \(csv\)/i })).toBeVisible();
  });
});
