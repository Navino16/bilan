import { test, expect } from "@playwright/test";

test.describe("register and delete an account", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("asks to confirm the password, then confirms the account deletion (#172)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = `register-${Date.now()}@e2e.local`;
    const password = "e2e-register-password-123";

    const fill = async (confirmPassword: string) => {
      await page.fill('input[name="name"]', "E2E Register");
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.fill('input[name="confirmPassword"]', confirmPassword);
    };

    await page.goto("/fr/register");
    await fill("e2e-something-else-456");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Les deux mots de passe ne correspondent pas.")).toBeVisible();

    await fill(password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    await page.goto("/fr/settings/data", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(async () => {
      await page.getByRole("button", { name: "Supprimer mon compte" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("dialog").locator('[data-slot="delete-impact"]')).toContainText(
      "Vos catégories, règles et budgets personnels",
    );
    await page.getByRole("dialog").getByLabel("Mot de passe").fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer définitivement" })
      .click();

    await expect(page).toHaveURL(/\/login\?deleted=1$/, { timeout: 15_000 });
    await expect(
      page.getByText("Votre compte et toutes vos données ont été supprimés."),
    ).toBeVisible();
  });
});
