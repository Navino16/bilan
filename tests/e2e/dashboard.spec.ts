import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("renders the KPI row and month label, and navigates months", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(page.getByText("Revenus", { exact: true })).toBeVisible();
    await expect(page.getByText("Dépenses", { exact: true })).toBeVisible();
    await expect(page.getByText("Solde net", { exact: true })).toBeVisible();

    const heading = page.getByRole("heading", { level: 1 });
    const before = await heading.textContent();
    await page.getByRole("button", { name: "prev", exact: true }).click();
    await expect(page).toHaveURL(/\?from=.*&to=/);
    await expect(heading).not.toHaveText(before ?? "");

    // Stepping back then forward must return to the starting month (a whole-month
    // ?from/?to range round-trips to a month period, so nav stays one month apart).
    await page.getByRole("button", { name: "next", exact: true }).click();
    await expect(heading).toHaveText(before ?? "");
  });
});
