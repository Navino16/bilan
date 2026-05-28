import { test, expect } from "@playwright/test";

test("home page renders the Bilan heading", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.getByRole("heading", { name: "Bilan", level: 1 })).toBeVisible();
});

test("redirects root to a supported locale", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.url()).toMatch(/\/(fr|en)\/?$/);
});

test("english locale renders the english tagline", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByText("Your finances, settled.")).toBeVisible();
});
