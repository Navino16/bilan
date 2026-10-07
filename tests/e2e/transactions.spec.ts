import { test, expect } from "@playwright/test";

test.describe("transactions", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create a manual transaction and find it via search", async ({ page }) => {
    const stamp = Date.now();
    const label = `Boulangerie ${stamp}`;
    await page.goto("/fr/transactions");
    // Requires the owner to have at least one account (seeded e2e fixture).
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-15");
    await page.fill('input[name="amount"]', "-8,50");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    await expect(page.locator('input[name="label"]')).toBeHidden();

    // Token search on the per-run word (the unfiltered list only shows the newest page).
    await page.getByRole("searchbox").fill(String(stamp));
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

  test("manual entry explains amount problems and accepts grouped amounts", async ({ page }) => {
    const label = `Montant ${Date.now()}`;
    await page.goto("/fr/transactions");
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-17");
    await page.fill('input[name="label"]', label);
    await expect(page.locator('input[name="label"]')).toHaveAttribute("maxlength", "200");

    for (const [amount, message] of [
      ["12,3456", /plus de 2 décimales/i],
      ["1.234", /montant ambigu/i],
      ["0", /ne peut pas être nul/i],
    ] as const) {
      await page.fill('input[name="amount"]', amount);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(message);
      // A rejected submit keeps what was typed.
      await expect(page.locator('input[name="label"]')).toHaveValue(label);
      await expect(page.locator('input[name="date"]')).toHaveValue("2026-02-17");
    }

    await page.fill('input[name="amount"]', "-1.234,56");
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.locator('input[name="label"]')).toBeHidden();
  });

  test("search is debounced and explains short words", async ({ page }) => {
    await page.goto("/fr/transactions");
    const box = page.getByRole("searchbox");
    await box.pressSequentially("cb", { delay: 50 });
    await expect(page.getByText(/mots entiers d'au moins 3 lettres/i).first()).toBeVisible();
    await expect(page).toHaveURL(/search=cb/);
    await box.fill("");
    await expect(page).not.toHaveURL(/search=/);
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
