import { test, expect } from "@playwright/test";

test.describe("navigation pending state", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("dims the page while a period change waits for the server", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const heading = page.getByRole("heading", { level: 1 });
    const before = await heading.textContent();

    // Hold the RSC payload of the period navigation until the pending UI is checked.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === "/fr/dashboard" && url.searchParams.has("from"),
      async (route) => {
        if (route.request().headers()["rsc"]) await gate;
        await route.continue();
      },
    );

    const busy = page.locator('[aria-busy="true"][data-pending]');
    // A click before PeriodNav hydrates is a no-op: retry until the transition starts.
    await expect(async () => {
      await page.getByRole("button", { name: "prev", exact: true }).click();
      await expect(busy).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(page.locator('[data-slot="navigation-progress"]')).toBeAttached();
    await expect(heading).toHaveText(before ?? "");

    release();
    await expect(page).toHaveURL(/\?from=.*&to=/);
    await expect(busy).toHaveCount(0);
    await expect(heading).not.toHaveText(before ?? "");
  });
});
