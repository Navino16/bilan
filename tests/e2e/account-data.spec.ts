import { test, expect } from "@playwright/test";

test.describe("account data", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven nav refinement deferred to Phase 8.3",
  );

  test("the CSV export is an Excel-friendly attachment in the requested locale", async ({
    page,
  }) => {
    const fr = await page.request.get("/api/export/transactions?locale=fr");
    expect(fr.status()).toBe(200);
    expect(fr.headers()["content-type"]).toContain("text/csv");
    expect(fr.headers()["content-disposition"]).toMatch(
      /attachment; filename="bilan-transactions-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const frBody = await fr.body();
    expect([...frBody.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(frBody.toString("utf8")).toContain("date;montant;type;libellé;compte;catégorie");
    // Type codes are exported as localized labels (#245).
    expect(frBody.toString("utf8")).not.toMatch(/;(CARD|TRANSFER|DIRECT_DEBIT|CHEQUE|ATM|OTHER);/);

    const en = await page.request.get("/api/export/transactions?locale=en");
    const enBody = await en.text();
    expect(enBody).toContain("date,amount,type,label,account,category");
    expect(enBody).not.toMatch(/,(CARD|TRANSFER|DIRECT_DEBIT|CHEQUE|OTHER),/);
  });

  test("the CSV export keeps to the requested date range and readable account", async ({
    page,
  }) => {
    const rows = async (query: string) =>
      (await (await page.request.get(`/api/export/transactions?locale=fr&${query}`)).text())
        .trim()
        .split(/\r?\n/)
        .slice(1);

    // The seeded owner transaction (scripts/seed-e2e.ts) on its fixed account.
    const seeded = await rows("accountId=e2e-owner-account&from=2020-01-15&to=2020-01-15");
    expect(seeded.some((r) => r.includes("E2E seed"))).toBe(true);
    expect(seeded.every((r) => r.includes(";E2E Courant;"))).toBe(true);
    expect(await rows("accountId=e2e-owner-account&from=2020-01-16&to=2020-01-16")).toEqual([]);
    expect(await rows("accountId=not-a-readable-account")).toEqual([]);
  });

  test("the JSON export has a dated filename and no encrypted fields", async ({ page }) => {
    const res = await page.request.get("/api/export/data");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(
      /attachment; filename="bilan-data-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = await res.text();
    expect(body).not.toContain("ibanEnc");
    expect(body).not.toContain("labelEnc");
  });

  test("the data settings page downloads exports with progress feedback", async ({ page }) => {
    // A brand-new route compiles on first hit in the dockerized dev server.
    await page.goto("/fr/settings/data", { waitUntil: "domcontentloaded", timeout: 90_000 });

    const heading = page.getByRole("heading", { level: 1, name: /données/i });
    await expect(async () => {
      await expect(heading).toBeVisible();
    }).toPass();

    await expect(page.getByText("Zone de danger")).toBeVisible();
    const csvButton = page.getByRole("button", { name: /transactions \(csv\)/i });
    await expect(csvButton).toBeVisible();

    const download = page.waitForEvent("download");
    await csvButton.click();
    expect((await download).suggestedFilename()).toMatch(
      /^bilan-transactions-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    await expect(csvButton).toBeEnabled();
  });

  test("the CSV export button sends the chosen filters", async ({ page }) => {
    await page.goto("/fr/settings/data", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const filters = page.locator('[data-slot="export-filters"]');
    await expect(filters).toBeVisible();
    // Retried: a fill that lands before hydration never reaches the filter state.
    await expect(async () => {
      await filters.getByLabel("Du").fill("2020-01-01");
      await filters.getByLabel("Au").fill("2020-12-31");
      await filters.getByLabel("Compte").selectOption({ label: "E2E Courant" });
      const request = page.waitForRequest((r) => r.url().includes("/api/export/transactions"));
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: /transactions \(csv\)/i }).click();
      const params = new URL((await request).url()).searchParams;
      expect(Object.fromEntries(params)).toEqual({
        locale: "fr",
        from: "2020-01-01",
        to: "2020-12-31",
        accountId: "e2e-owner-account",
      });
      await download;
    }).toPass({ timeout: 20_000 });

    // At 320 px the filters stack without overflowing the card.
    await page.setViewportSize({ width: 320, height: 800 });
    await expect.poll(() => filters.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
});
