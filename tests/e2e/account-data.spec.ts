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

    const en = await page.request.get("/api/export/transactions?locale=en");
    expect(await en.text()).toContain("date,amount,type,label,account,category");
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
});
