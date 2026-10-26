import { test, expect, type Page } from "@playwright/test";

test.describe("dashboard", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  for (const width of [320, 390]) {
    test(`the period selector fits a ${width}px viewport without horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/fr/dashboard");
      await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
      // The preset bar scrolls internally; the page itself must not overflow.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("lists the account balances with a link to the accounts page (#349)", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const card = page.locator('[data-slot="dashboard-accounts"]');
    await expect(card).toContainText("Solde des comptes");
    await expect(
      card.locator('[data-slot="dashboard-account"]', { hasText: "E2E Courant" }),
    ).toContainText("€");
    await card.getByRole("link", { name: /comptes/i }).click();
    await expect(page).toHaveURL(/\/fr\/accounts$/);
  });

  const kpiRects = async (page: Page) => {
    const cards = page.locator('[data-slot="kpi-card"]');
    await expect(cards).toHaveCount(3);
    return cards.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
    );
  };

  test("below md the KPIs form a 2-column grid with the net card spanning both", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/dashboard");
    const [income, expense, net] = await kpiRects(page);
    expect(Math.abs(income.y - expense.y)).toBeLessThan(1);
    expect(expense.x).toBeGreaterThan(income.right);
    expect(net.y).toBeGreaterThan(income.bottom);
    expect(Math.abs(net.x - income.x)).toBeLessThan(1);
    expect(Math.abs(net.right - expense.right)).toBeLessThan(1);
  });

  test("from md up the KPIs sit in a single row", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr/dashboard");
    const [income, expense, net] = await kpiRects(page);
    expect(Math.abs(income.y - expense.y)).toBeLessThan(1);
    expect(Math.abs(expense.y - net.y)).toBeLessThan(1);
    expect(expense.x).toBeGreaterThan(income.right);
    expect(net.x).toBeGreaterThan(expense.right);
  });

  test("renders the KPI row and month label, and navigates months", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
    await expect(page.getByText("Dépenses", { exact: true })).toBeVisible();
    await expect(page.getByText("Solde net", { exact: true })).toBeVisible();
    // The net can change sign, so its comparison is an amount, never a percentage.
    await expect(page.locator('[data-slot="kpi-note"]').nth(2)).not.toContainText("%");
    // The net amount is always signed (or exactly 0).
    await expect(page.locator('[data-slot="kpi-amount"]').nth(2)).toHaveText(/^([+\-−]|0\s)/);

    // The default view is the current month; next month stays reachable (#341).
    await expect(page.getByRole("button", { name: "Période suivante" })).toBeEnabled();

    const heading = page.getByRole("heading", { level: 1 });
    // Absorb the initial hydration race (a click before PeriodNav hydrates is a
    // no-op): retry "previous" until it actually navigates. Lands on a past month.
    await expect(async () => {
      await page.getByRole("button", { name: "Période précédente" }).click();
      await expect(page).toHaveURL(/\?from=.*&to=/);
    }).toPass();

    // From a hydrated page, stepping forward then back must return to the same
    // month — the whole-month ?from/?to range round-trips to a month period, so
    // nav stays exactly one month apart (regression: next used to overshoot).
    const base = await heading.textContent();
    await page.getByRole("button", { name: "Période suivante" }).click();
    await expect(heading).not.toHaveText(base ?? "");
    await page.getByRole("button", { name: "Période précédente" }).click();
    await expect(heading).toHaveText(base ?? "");
  });

  test("snaps a direct future URL back to the current month", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const current = await page.getByRole("heading", { level: 1 }).textContent();

    // A hand-crafted future range must not render an empty future month.
    await page.goto("/fr/dashboard?from=2099-01-01&to=2099-01-31");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(current ?? "");
  });

  test("opens next month as upcoming, and no further (#341)", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(async () => {
      await page.getByRole("button", { name: "Période suivante" }).click();
      await expect(page).toHaveURL(/\?from=.*&to=/);
    }).toPass();
    await expect(page.getByText(/Période à venir/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Période suivante" })).toBeDisabled();
  });

  test("switching to the quarter preset shows a date-range heading and steps by quarter", async ({
    page,
  }) => {
    await page.goto("/fr/dashboard");
    // Retry the (idempotent) preset click until it lands, absorbing the
    // hydration race on the freshly-loaded page.
    await expect(async () => {
      await page.getByRole("button", { name: /trimestre/i }).click();
      await expect(page).toHaveURL(/\?from=.*&to=/);
    }).toPass();

    // The quarter heading shows the span (e.g. "avr. – juin 2026"), not "T2".
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("2026");
    await expect(heading).toHaveText(/[–—-]/);
    const quarterLabel = await heading.textContent();

    // The arrows step by the selected granularity → a different quarter range.
    await page.getByRole("button", { name: "Période précédente" }).click();
    await expect(heading).not.toHaveText(quarterLabel ?? "");
    await expect(heading).toHaveText(/[–—-]/);
    await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
  });

  test("shows the average and peak-bucket stats once there is spending", async ({ page }) => {
    // Seed a current-month expense so the trace has a non-empty peak.
    const label = `Loyer ${Date.now()}`;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
    await page.goto("/fr/transactions");
    // Open the dialog, retrying until the form shows (hydration race on load).
    await expect(async () => {
      await page.getByRole("button", { name: /nouvelle transaction/i }).click();
      await expect(page.locator('input[name="date"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="date"]', day);
    await page.fill('input[name="amount"]', "-1234");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto("/fr/dashboard");
    await expect(page.getByText("Moy. / jour")).toBeVisible();
    await expect(page.getByText("Plus gros jour")).toBeVisible();
  });

  test("the year preset shows just the year and steps year by year", async ({ page }) => {
    await page.goto("/fr/dashboard");
    // Retry the (idempotent) preset click until it lands (hydration race).
    await expect(async () => {
      await page.getByRole("button", { name: /^année$/i }).click();
      await expect(page).toHaveURL(/\?from=.*&to=/);
    }).toPass();

    // Just the year — not a clamped range like "janv. – juin 2026".
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/^\d{4}$/);
    const thisYear = Number(await heading.textContent());

    // A year-long trace switches from day-by-day to month-by-month.
    await expect(page.getByText("Dépenses par mois")).toBeVisible();

    // Previous arrow steps a full calendar year back (still "YYYY").
    await page.getByRole("button", { name: "Période précédente" }).click();
    await expect(heading).toHaveText(String(thisYear - 1));
  });
  test("KPIs compare with an N-month average when picked", async ({ page }) => {
    await page.goto("/fr/dashboard?from=2026-03-01&to=2026-03-31", {
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
    await baseline.selectOption("avg3");
    await expect(page).toHaveURL(/vs=avg3/, { timeout: 60_000 });
    await expect(page.locator('[data-slot="kpi-note"]').nth(1)).toContainText("3 mois");
  });
});
