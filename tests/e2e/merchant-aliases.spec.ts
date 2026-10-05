import { test, expect, type Page } from "@playwright/test";

async function addExpense(page: Page, date: string, label: string, amount: string) {
  await page.goto("/fr/accounts");
  await expect(async () => {
    await page
      .getByRole("button", { name: /saisir une transaction/i })
      .first()
      .click();
    await expect(page.locator('input[name="label"]')).toBeVisible();
  }).toPass();
  await page.fill('input[name="date"]', date);
  await page.fill('input[name="amount"]', amount);
  await page.fill('input[name="label"]', label);
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(page.locator('input[name="label"]')).toBeHidden();
}

test.describe("merchant aliases", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "WebKit taps are unreliable here");

  test("renames and merges merchants from Insights, then manages them in the merchant list", async ({
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
    // A month of its own, so leftovers of earlier local runs can't push it out of the Top 6.
    const month = `${2001 + Math.floor(Math.random() * 20)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
    await addExpense(page, `${month}-14`, `CB ${first}`, "-950");
    await addExpense(page, `${month}-14`, `CB ${second}`, "-940");

    await page.goto(`/fr/insights?from=${month}-01&to=${month}-28`, {
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
    const search = page.getByRole("searchbox", { name: "Rechercher un marchand" });
    await expect(async () => {
      await page.getByRole("button", { name: /^Marchands/ }).click();
      await expect(search).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await search.fill(tag);
    const row = page.locator('[data-slot="merchant-row"]', { hasText: name });
    await expect(row).toContainText(first);
    await expect(row).toContainText(second);

    await row.getByRole("button", { name: `Retirer ${second} de ${name}` }).click();
    await expect(row).not.toContainText(second, { timeout: 30_000 });
    await expect(page.locator('[data-slot="merchant-row"]', { hasText: second })).toBeVisible();

    await row.getByRole("button", { name: `Renommer ${name}` }).click();
    await page.getByRole("button", { name: "Rétablir" }).click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-slot="merchant-row"]', { hasText: first })).toBeVisible();
  });
});
