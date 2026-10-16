import { test, expect } from "@playwright/test";

test.describe("transaction links", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven link flow deferred to Phase 8.3",
  );

  test("link two transactions via selection mode and see them badged", async ({ page }) => {
    const stamp = Date.now();
    const expense = `Achat ${stamp}`;
    const refund = `Remb ${stamp}`;

    // Seed an expense and its refund.
    for (const [label, amount] of [
      [expense, "-60"],
      [refund, "60"],
    ] as const) {
      await page.goto(`/fr/transactions?search=${stamp}`);
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-03-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Enter selection mode, select both, link.
    await expect(async () => {
      await page.getByRole("button", { name: /^sélectionner$/i }).click();
      await expect(page.locator('[data-slot="selection-bar"]')).toBeVisible();
    }).toPass();
    await page
      .locator('[data-slot="transaction-row"]')
      .filter({ hasText: expense })
      .first()
      .click();
    await page.locator('[data-slot="transaction-row"]').filter({ hasText: refund }).first().click();
    await page.getByRole("button", { name: /^lier$/i }).click();
    await expect(page.locator('[data-slot="selection-bar"]')).toBeHidden({ timeout: 15_000 });

    // The expense row shows the "Liée" badge (the row renders both a desktop and
    // a mobile layout, so the badge appears twice in the DOM — assert the first).
    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: expense })
        .getByText("Liée")
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Linking rows that are already linked reports why instead of failing silently.
    await page.getByRole("button", { name: /^sélectionner$/i }).click();
    await page
      .locator('[data-slot="transaction-row"]')
      .filter({ hasText: expense })
      .first()
      .click();
    await page.locator('[data-slot="transaction-row"]').filter({ hasText: refund }).first().click();
    await page.getByRole("button", { name: /^lier$/i }).click();
    await expect(page.locator('[data-slot="selection-bar"]').getByRole("alert")).toHaveText(
      /déjà liée/i,
    );

    // The detail says what the row is linked to, and unlinks it.
    await page.getByRole("button", { name: /quitter la sélection/i }).click();
    await page
      .locator('[data-slot="transaction-row"]')
      .filter({ hasText: expense })
      .first()
      .click();
    const summary = page.locator('[data-slot="link-summary"]');
    await expect(summary).toContainText(refund);
    await summary.getByRole("button", { name: /^délier$/i }).click();
    await expect(summary).toBeHidden({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: expense }).getByText("Liée"),
    ).toHaveCount(0);
  });

  test("accepts a suggested pair and persists an ignore", async ({ page }) => {
    const stamp = Date.now();
    const exp = `Sugg exp ${stamp}`;
    const ref = `Sugg ref ${stamp}`;
    // A per-run unique amount so exactly one +X/-X pair exists on the dev DB
    // (runs accumulate rows) — after ignoring, the +X leg has no other -X to
    // re-pair with, so the suggestion truly disappears.
    const amt = 10000 + (stamp % 80000) + stamp / 1e13; // e.g. 4XXXX.xx, distinct
    const uniq = amt.toFixed(2);
    for (const [label, amount] of [
      [exp, `-${uniq}`],
      [ref, uniq],
    ] as const) {
      await page.goto(`/fr/transactions?search=${stamp}`);
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-04-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Navigate to the suggestions route, retrying the load: a freshly
    // (re)started dev server can transiently 404 the new segment before
    // Turbopack compiles it.
    await expect(async () => {
      await page.goto("/fr/transactions/suggestions");
      await expect(page.getByRole("heading", { name: /suggestions de liens/i })).toBeVisible();
    }).toPass({ timeout: 30_000 });
    // Match this run's pair by its unique per-run label (the row shows both legs'
    // labels), not by amount — pairs accumulate across runs on the dev DB.
    const row = page.locator('[data-slot="suggestion-row"]').filter({ hasText: ref }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    // Each leg shows its day.
    await expect(row).toContainText("2 avr. 2026");

    // #224: at 320px the labels keep their width and « Lier » doesn't cover the legs.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 800 });
    for (const label of await row.locator('[data-slot="leg-label"]').all()) {
      await expect
        .poll(() => label.evaluate((el) => el.clientWidth > 0 && el.scrollWidth <= el.clientWidth))
        .toBe(true);
    }
    const legs = (await row.locator("ul").boundingBox())!;
    const linkButton = (await row.getByRole("button", { name: /^lier$/i }).boundingBox())!;
    expect(
      linkButton.y >= legs.y + legs.height || linkButton.x >= legs.x + legs.width,
      "« Lier » overlaps the legs",
    ).toBe(true);
    if (viewport) await page.setViewportSize(viewport);

    await row.getByRole("button", { name: /ignorer/i }).click();
    // After ignoring, that pair no longer appears on reload.
    await expect(async () => {
      await page.goto("/fr/transactions/suggestions");
      await expect(
        page.locator('[data-slot="suggestion-row"]').filter({ hasText: ref }),
      ).toHaveCount(0);
    }).toPass({ timeout: 30_000 });

    // It is listed among the ignored pairs and can be restored.
    const ignored = page.locator('[data-slot="ignored-suggestions"]');
    await ignored.locator("summary").click();
    await ignored
      .locator('[data-slot="ignored-row"]')
      .filter({ hasText: ref })
      .getByRole("button", { name: /restaurer/i })
      .click();
    await expect(
      page.locator('[data-slot="suggestion-row"]').filter({ hasText: ref }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("link suggestion settings", () => {
  // The member's own settings, so the owner's suggestion specs keep the defaults.
  test.use({ storageState: "tests/e2e/.auth/member.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven link flow deferred to Phase 8.3",
  );

  async function save(
    page: import("@playwright/test").Page,
    windowDays: string,
    minAmount: string,
  ): Promise<void> {
    await expect(async () => {
      await page.getByRole("button", { name: /^réglages$/i }).click();
      await expect(page.getByLabel("Écart maximal (jours)")).toBeVisible();
    }).toPass();
    await page.getByLabel("Écart maximal (jours)").fill(windowDays);
    await page.getByLabel("Montant minimum").fill(minAmount);
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
  }

  test("changes the window and minimum amount and shows them on the page", async ({ page }) => {
    await expect(async () => {
      await page.goto("/fr/transactions/suggestions");
      await expect(page.getByRole("heading", { name: /suggestions de liens/i })).toBeVisible();
    }).toPass({ timeout: 30_000 });
    const criteria = page.locator('[data-slot="suggestion-criteria"]');
    try {
      await save(page, "7", "1,234");
      await expect(page.getByText(/montant ambigu/i)).toBeVisible();
      await page.getByLabel("Montant minimum").fill("12,5");
      await page.getByRole("button", { name: /^enregistrer$/i }).click();
      await expect(criteria).toContainText("7 jours d’écart au plus", { timeout: 15_000 });
      await expect(criteria).toContainText("12,50");

      await page.reload();
      await save(page, "0", "0");
      await expect(criteria).toContainText("Paires du même jour", { timeout: 15_000 });
    } finally {
      await page.goto("/fr/transactions/suggestions");
      await save(page, "30", "0");
      await expect(criteria).toContainText("30 jours", { timeout: 15_000 });
    }
  });
});
