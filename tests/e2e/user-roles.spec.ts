import { test, expect, type Page } from "@playwright/test";

const TARGET = "roles-target@e2e.local";

function targetRow(page: Page) {
  return page.locator('[data-slot="admin-user-row"]', { hasText: TARGET });
}

test.describe("admin user roles", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test.describe("as a super admin", () => {
    test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

    test("promotes a user to admin, audited, then demotes them back", async ({ page }) => {
      test.setTimeout(120_000);
      const setRole = async (label: string, value: string) => {
        await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
        const select = targetRow(page).getByRole("combobox");
        // Retry until the client island has hydrated and the change is persisted.
        await expect(async () => {
          await select.selectOption({ label });
          await page
            .getByRole("alertdialog")
            .getByRole("button", { name: "Changer le rôle" })
            .click({ timeout: 2000 });
          await expect(page.getByRole("alertdialog")).toBeHidden();
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(select).toHaveValue(value, { timeout: 2000 });
        }).toPass({ timeout: 30_000 });
      };

      try {
        await setRole("Administrateur", "ADMIN");
        await page.goto("/fr/admin/audit?action=user.role.changed", {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await expect(page.locator('[data-slot="audit-row"]').first()).toBeVisible();
      } finally {
        await setRole("Utilisateur", "USER");
      }
    });

    test("asks for confirmation and leaves the role unchanged on cancel (#163)", async ({
      page,
    }) => {
      await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
      const select = targetRow(page).getByRole("combobox");
      const dialog = page.getByRole("alertdialog");
      await expect(async () => {
        await select.selectOption({ label: "Super-administrateur" });
        await expect(dialog).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await expect(dialog).toContainText("E2E Roles Target");
      await dialog.getByRole("button", { name: "Annuler" }).click();
      await expect(dialog).toBeHidden();
      await expect(select).toHaveValue("USER");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(select).toHaveValue("USER");
    });

    test("cannot change their own role", async ({ page }) => {
      await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
      const own = page.locator('[data-slot="admin-user-row"]', {
        hasText: "superadmin@e2e.local",
      });
      await expect(own.getByRole("combobox")).toHaveCount(0);
      await expect(targetRow(page).getByRole("combobox")).toBeVisible();
    });
  });

  test.describe("as an admin", () => {
    test.use({ storageState: "tests/e2e/.auth/admin.json" });

    test("sees roles read-only", async ({ page }) => {
      await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(targetRow(page)).toBeVisible();
      await expect(page.locator('[data-slot="admin-user-row"]').getByRole("combobox")).toHaveCount(
        0,
      );
    });
  });
});
