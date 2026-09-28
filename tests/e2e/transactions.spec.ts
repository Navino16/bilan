import { test, expect } from "@playwright/test";

test.describe("transactions", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create a manual transaction and find it via search", async ({ page }) => {
    const label = `Boulangerie ${Date.now()}`;
    await page.goto("/fr/transactions");
    // Requires the owner to have at least one account (seeded e2e fixture).
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-15");
    await page.fill('input[name="amount"]', "-8,50");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    await expect(row.first()).toBeVisible();

    // Token search (first distinctive word).
    await page.getByRole("searchbox").fill("boulangerie");
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
    ).toBeVisible();
  });

  test("a truncated list shows a count and loads more on demand", async ({ page }) => {
    const word = `pagin${Date.now()}`;
    await page.goto("/fr/transactions");
    for (const day of ["10", "11", "12"]) {
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="label"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', `2026-02-${day}`);
      await page.fill('input[name="amount"]', "-5");
      await page.fill('input[name="label"]', `${word} ${day}`);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.locator('input[name="label"]')).toBeHidden();
    }

    // limit=2 may cut Feb 11 short → trimmed to the one complete day (Feb 12).
    await page.goto(`/fr/transactions?search=${word}&limit=2`);
    const rows = page.locator('[data-slot="transaction-row"]');
    const more = page.locator('[data-slot="transactions-more"]');
    await expect(rows).toHaveCount(1);
    await expect(more).toContainText("1 sur 3 opérations affichées");

    await more.getByRole("link", { name: /afficher 100 de plus/i }).click();
    await expect(page).toHaveURL(/limit=102/);
    await expect(rows).toHaveCount(3);
    await expect(more).toHaveCount(0);

    // Changing a filter resets the page size.
    await page.getByRole("button", { name: "Sorties", exact: true }).click();
    await expect(page).toHaveURL(/dir=out/);
    expect(page.url()).not.toContain("limit=");
  });

  test("the header fits a narrow viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/transactions");
    await expect(page.getByRole("button", { name: /nouvelle transaction/i })).toBeInViewport({
      ratio: 1,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("unauthenticated /transactions redirects to login", async ({ page }) => {
  await page.goto("/fr/transactions");
  await expect(page).toHaveURL(/\/login$/);
});
