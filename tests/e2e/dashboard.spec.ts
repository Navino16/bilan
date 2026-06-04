import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("renders the KPI row and month label, and navigates months", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
    await expect(page.getByText("Dépenses", { exact: true })).toBeVisible();
    await expect(page.getByText("Solde net", { exact: true })).toBeVisible();

    // The default view is the current month — there's no future to browse into.
    await expect(page.getByRole("button", { name: "next", exact: true })).toBeDisabled();

    const heading = page.getByRole("heading", { level: 1 });
    // Absorb the initial hydration race (a click before PeriodNav hydrates is a
    // no-op): retry "prev" until it actually navigates. Lands on a past month.
    await expect(async () => {
      await page.getByRole("button", { name: "prev", exact: true }).click();
      await expect(page).toHaveURL(/\?from=.*&to=/);
    }).toPass();

    // From a hydrated page, stepping forward then back must return to the same
    // month — the whole-month ?from/?to range round-trips to a month period, so
    // nav stays exactly one month apart (regression: next used to overshoot).
    const base = await heading.textContent();
    await page.getByRole("button", { name: "next", exact: true }).click();
    await expect(heading).not.toHaveText(base ?? "");
    await page.getByRole("button", { name: "prev", exact: true }).click();
    await expect(heading).toHaveText(base ?? "");
  });

  test("snaps a direct future URL back to the current month", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const current = await page.getByRole("heading", { level: 1 }).textContent();

    // A hand-crafted future range must not render an empty future month.
    await page.goto("/fr/dashboard?from=2099-01-01&to=2099-01-31");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(current ?? "");
    await expect(page.getByRole("button", { name: "next", exact: true })).toBeDisabled();
  });

  test("switching to the quarter preset shows a date-range heading and steps by quarter", async ({
    page,
  }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("button", { name: /trimestre/i }).click();
    await expect(page).toHaveURL(/\?from=.*&to=/);

    // The quarter heading shows the span (e.g. "avr. – juin 2026"), not "T2".
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("2026");
    await expect(heading).toHaveText(/[–—-]/);
    const quarterLabel = await heading.textContent();

    // The arrows step by the selected granularity → a different quarter range.
    await page.getByRole("button", { name: "prev", exact: true }).click();
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
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
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
    await page.getByRole("button", { name: /^année$/i }).click();

    // Just the year — not a clamped range like "janv. – juin 2026".
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/^\d{4}$/);
    const thisYear = Number(await heading.textContent());

    // A year-long trace switches from day-by-day to month-by-month.
    await expect(page.getByText("Dépenses par mois")).toBeVisible();

    // Previous arrow steps a full calendar year back (still "YYYY").
    await page.getByRole("button", { name: "prev", exact: true }).click();
    await expect(heading).toHaveText(String(thisYear - 1));
  });
});
