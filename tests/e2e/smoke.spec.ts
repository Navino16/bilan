import { test, expect } from "@playwright/test";

test("root sends a signed-out visitor to the localized login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(fr|en)\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the locale index redirects to login when signed out", async ({ page }) => {
  await page.goto("/fr");
  await expect(page).toHaveURL(/\/fr\/login$/);
  await expect(page).toHaveTitle("Connexion · Bilan");
});

test("english locale renders the english tagline", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByText("Your finances, settled.")).toBeVisible();
});

test.describe("signed in", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("the locale index lands on the dashboard", async ({ page }) => {
    await page.goto("/fr");
    await expect(page).toHaveURL(/\/fr\/dashboard$/);
    await expect(page).toHaveTitle("Tableau de bord · Bilan");
  });
});
