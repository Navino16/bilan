import { test, expect } from "@playwright/test";

test.describe("groups", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  // Dialog interaction on WebKit / mobile bottom-sheet is deferred to Phase 8.3.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create a group and open its detail", async ({ page }) => {
    const name = `Foyer ${Date.now()}`;
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau foyer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /créer le foyer/i }).click();
    const card = page.getByRole("link", { name: new RegExp(name) });
    await expect(card).toBeVisible();

    // Opening the group shows the creator as the sole OWNER member.
    await card.click();
    await page.waitForURL(/\/groups\/[a-z0-9]+$/i);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    // Scope to main: the email also appears in the sidebar user menu.
    await expect(page.getByRole("main").getByText("owner@e2e.local")).toBeVisible();
  });
});

test("unauthenticated /groups redirects to login", async ({ page }) => {
  await page.goto("/fr/groups");
  await expect(page).toHaveURL(/\/login$/);
});
