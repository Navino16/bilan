import { test, expect, type Page } from "@playwright/test";

async function addExpense(page: Page, label: string, amount: string) {
  await page.goto("/fr/accounts");
  await expect(async () => {
    await page
      .getByRole("button", { name: /saisir une transaction/i })
      .first()
      .click();
    await expect(page.locator('input[name="label"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="date"]', "2024-05-14");
  await page.fill('input[name="amount"]', amount);
  await page.fill('input[name="label"]', label);
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(page.locator('input[name="label"]')).toBeHidden();
}

test.describe("merchant aliases", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "WebKit taps are unreliable here");

  test("renames and merges merchants from Insights, then manages them on Categories", async ({
    page,
  }) => {
    const tag = Math.random()
      .toString(36)
      .replace(/[^a-z]/g, "")
      .slice(0, 8)
      .toUpperCase();
    const first = `E2E SHOP ${tag}`;
    const second = `E2E MART ${tag}`;
    const name = `Boutique ${tag}`;
    await addExpense(page, `CB ${first}`, "-950");
    await addExpense(page, `CB ${second}`, "-940");

    await page.goto("/fr/insights?from=2024-05-01&to=2024-05-31", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const merchants = page.locator('[data-slot="insights-merchants"]');
    const nameInput = page.getByLabel("Nom affiché");
    const rename = async (merchant: string) =>
      expect(async () => {
        await page.getByRole("button", { name: `Renommer ${merchant}` }).click();
        await expect(nameInput).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 60_000 });

    await rename(first);
    await nameInput.fill(name);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(merchants.getByText(name)).toBeVisible({ timeout: 30_000 });

    await rename(second);
    await nameInput.fill("");
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(merchants.getByText(second)).toHaveCount(0, { timeout: 30_000 });
    await expect(merchants.locator("li", { hasText: name })).toContainText("1 890 €");

    await page.goto("/fr/categories", { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-slot="merchant-alias-row"]', { hasText: name });
    await expect(async () => {
      await page.getByRole("button", { name: /^Marchands/ }).click();
      await expect(row).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await expect(row).toContainText(first);
    await expect(row).toContainText(second);

    await row.getByRole("button", { name: `Retirer ${second} de ${name}` }).click();
    await expect(row).not.toContainText(second, { timeout: 30_000 });

    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: `Rétablir les libellés de ${name}` }).click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
  });
});
