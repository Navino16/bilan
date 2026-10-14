import { test, expect, type Locator } from "@playwright/test";

test.describe("admin pages (#164)", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test.describe("as a super admin", () => {
    test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

    test("creates an expiring signup token, revokes then deletes it, audited", async ({ page }) => {
      test.setTimeout(120_000);
      const description = `e2e token ${Date.now()}`;
      await page.goto("/fr/admin/signup-tokens", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const row = page.locator('[data-slot="signup-token-row"]', { hasText: description });
      await expect(async () => {
        await page.fill("#st-desc", description);
        await page.selectOption("#st-expiry", "7");
        await page.getByRole("button", { name: /^créer$/i }).click();
        await expect(row).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await expect(row).toContainText("Actif");
      await expect(row.getByRole("button", { name: /copier le lien/i })).toBeVisible();

      await row.getByRole("button", { name: "Révoquer" }).click();
      const dialog = page.locator('[data-slot="confirm-dialog"]');
      await dialog.getByRole("button", { name: "Révoquer" }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText("Révoqué");

      await row.getByRole("button", { name: "Supprimer" }).click();
      await dialog.getByRole("button", { name: "Supprimer" }).click();
      await expect(row).toHaveCount(0);

      await page.goto("/fr/admin/audit?action=signup_token", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(page.locator("#f-action")).toHaveValue("signup_token");
      await expect(
        page.locator('[data-slot="audit-row"]', { hasText: "Jeton d’invitation supprimé" }).first(),
      ).toBeVisible();
    });

    test("an invalid max uses shows its range once, without shifting the row (#227)", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("/fr/admin/signup-tokens", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const form = page.locator("form:has(#st-max)");
      const maxUses = page.locator("#st-max");
      // Skip native min/max validation to reach the server check.
      await form.evaluate((f: HTMLFormElement) => (f.noValidate = true));
      await expect(async () => {
        await maxUses.fill("0");
        await page.getByRole("button", { name: /^créer$/i }).click();
        await expect(maxUses).toHaveAttribute("aria-invalid", "true", { timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await expect(maxUses).toHaveAccessibleDescription(/^Nombre entier entre 1 et 10\s000\.$/);
      await expect(form.getByRole("alert")).toHaveCount(0);
      const top = async (el: Locator) => (await el.boundingBox())!.y;
      const descTop = await top(page.locator("#st-desc"));
      expect(await top(maxUses)).toBeCloseTo(descTop, 0);
      expect(await top(page.locator("#st-expiry"))).toBeCloseTo(descTop, 0);
      expect(await top(form.getByRole("button", { name: /^créer$/i }))).toBeCloseTo(descTop, 0);
    });

    test("permanently deletes a user after typing their email", async ({ page }) => {
      test.setTimeout(120_000);
      const email = `e2e-delete-${Date.now()}@e2e.local`;
      await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(async () => {
        await page.fill("#cu-name", "E2E À supprimer");
        await page.fill("#cu-email", email);
        await page.getByRole("button", { name: /^créer$/i }).click();
        await expect(page.getByText(/utilisateur créé/i)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });

      await page.goto(`/fr/admin/users?q=${encodeURIComponent(email)}`, {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator('[data-slot="admin-user-row"]', { hasText: email });
      const dialog = page.locator('[data-slot="confirm-dialog"]');
      await expect(async () => {
        await row.getByRole("button", { name: /actions pour/i }).click();
        await page.getByRole("menuitem", { name: /supprimer définitivement/i }).click();
        await expect(dialog).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await expect(dialog.getByText(/calcul de l’impact/i)).toBeHidden();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      // A fresh user owns nothing: no impact warning, in particular none about budget lines (#230).
      await expect(dialog.locator('[data-slot="user-deletion-impact"]')).toHaveCount(0);
      const confirm = dialog.getByRole("button", { name: /supprimer définitivement/i });
      await expect(confirm).toBeDisabled();
      await dialog.getByRole("textbox").fill(email);
      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(row).toHaveCount(0);
    });
  });

  test.describe("as an admin", () => {
    test.use({ storageState: "tests/e2e/.auth/admin.json" });

    test("searches users", async ({ page }) => {
      await page.goto("/fr/admin/users?q=roles-target", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const rows = page.locator('[data-slot="admin-user-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("roles-target@e2e.local");
      await page.goto("/fr/admin/users?q=no-user-matches-this", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText(/aucun utilisateur ne correspond/i)).toBeVisible();
    });

    test("disables then re-enables a user through the confirm dialog", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/fr/admin/users?q=roles-target", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const row = page.locator('[data-slot="admin-user-row"]', { hasText: "roles-target" });
      const dialog = page.locator('[data-slot="confirm-dialog"]');
      const toggle = async (item: RegExp, badgeCount: number) => {
        await expect(async () => {
          await row.getByRole("button", { name: /actions pour/i }).click();
          await page.getByRole("menuitem", { name: item }).click();
          await expect(dialog).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 20_000 });
        await dialog.getByRole("button", { name: item }).click();
        await expect(dialog).toBeHidden();
        await expect(row.getByText("Désactivé", { exact: true })).toHaveCount(badgeCount);
      };
      await toggle(/^désactiver$/i, 1);
      await toggle(/^réactiver$/i, 0);
    });
  });
});
