import { test, expect } from "@playwright/test";

test.describe("admin settings", () => {
  test.use({ storageState: "tests/e2e/.auth/admin.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("editing the app name saves and appears in the audit log", async ({ page }) => {
    // Two brand-new routes cold-compile on first hit; allow more than the default 30s.
    test.setTimeout(120_000);
    const form = page.locator("form:has(#set-app_name)");
    // Unchanged values aren't written (nor audited): save a fresh name, then restore.
    const saveName = async (name: string) => {
      await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
      // Retry the first submit until the client island has hydrated.
      await expect(async () => {
        await form.locator("#set-app_name").fill(name);
        await form.getByRole("button", { name: /enregistrer/i }).click();
        await expect(form.getByText("Enregistré.")).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
    };

    try {
      await saveName(`Bilan E2E ${Date.now()}`);
      // The mutation is audited; the viewer, filtered on the action, shows the row.
      await page.goto("/fr/admin/audit?action=settings.app_name.update", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(page.locator('[data-slot="audit-row"]').first()).toBeVisible();
      // The setting is named, not shown as its raw key (#226).
      await expect(page.locator('[data-slot="audit-row"]').first()).toContainText(
        "Nom de l’instance",
      );
      await expect(page.locator('[data-slot="audit-row"]').first()).not.toContainText("app_name");
    } finally {
      await saveName("Bilan");
    }
  });

  test("renaming the instance rebrands the shell and the page title", async ({ page }) => {
    test.setTimeout(120_000);
    const form = page.locator("form:has(#set-app_name)");
    const saveName = async (name: string) => {
      await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(async () => {
        await form.locator("#set-app_name").fill(name);
        await form.getByRole("button", { name: /enregistrer/i }).click();
        await expect(form.getByText("Enregistré.")).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
    };

    try {
      await saveName("Maison E2E");
      await page.goto("/fr/dashboard");
      await expect(page).toHaveTitle("Tableau de bord · Maison E2E");
      await expect(page.locator("aside").getByRole("link", { name: "Maison E2E" })).toBeVisible();
      // Copy naming the instance follows too (#226).
      await page.goto("/fr/transactions/suggestions");
      await expect(page.getByText(/^Maison E2E repère les paires/)).toBeVisible();
    } finally {
      await saveName("Bilan");
    }
  });

  test.describe("security settings, as a super admin (#223)", () => {
    test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

    test("an out-of-range min password length shows its range once, on the field (#227)", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
      const form = page.locator("form:has(#set-min_password_length)");
      const input = form.locator("#set-min_password_length");
      // Skip native min/max validation to reach the server check.
      await form.evaluate((f: HTMLFormElement) => (f.noValidate = true));
      await expect(async () => {
        await input.fill("3");
        await form.getByRole("button", { name: /enregistrer/i }).click();
        await expect(input).toHaveAttribute("aria-invalid", "true", { timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await expect(input).toHaveAccessibleDescription("Nombre entier entre 8 et 128.");
      await expect(form.getByRole("alert")).toHaveCount(0);
    });

    test("adds a provider, refuses a duplicate key, then deletes it (#163)", async ({ page }) => {
      test.setTimeout(120_000);
      const key = `e2e-${Date.now()}`;
      const addForm = page.locator("form:has(#ap-new-key)");
      const editForm = page.locator(`form:has(#ap-${key}-key)`);
      const add = async () => {
        await addForm.locator("#ap-new-key").fill(key);
        await addForm.locator("#ap-new-type").selectOption("oidc");
        await addForm.locator("#ap-new-displayName").fill("E2E provider");
        await addForm.locator("#ap-new-enabled").selectOption("false");
        await addForm.locator("#ap-new-issuer").fill("https://idp.e2e.invalid");
        await addForm.locator("#ap-new-clientId").fill("e2e-client");
        await addForm.locator("#ap-new-clientSecret").fill("e2e-secret");
        await addForm.getByRole("button", { name: "Ajouter" }).click();
      };
      await page.goto("/fr/admin/auth-providers", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(async () => {
        await add();
        await expect(editForm).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });

      await add();
      await expect(addForm.getByText(/utilise déjà cette clé/)).toBeVisible();

      await editForm.getByRole("button", { name: "Supprimer" }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByRole("button", { name: "Supprimer" }).click();
      await expect(dialog).toBeHidden();
      await expect(editForm).toHaveCount(0);
    });

    test("a saved select keeps its new value across consecutive saves (#165)", async ({ page }) => {
      test.setTimeout(120_000);
      const key = `e2e-sel-${Date.now()}`;
      const addForm = page.locator("form:has(#ap-new-key)");
      const editForm = page.locator(`form:has(#ap-${key}-key)`);
      await page.goto("/fr/admin/auth-providers", {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(async () => {
        await addForm.locator("#ap-new-key").fill(key);
        await addForm.locator("#ap-new-type").selectOption("oidc");
        await addForm.locator("#ap-new-displayName").fill("E2E select");
        await addForm.locator("#ap-new-issuer").fill("https://idp.e2e.invalid");
        await addForm.locator("#ap-new-clientId").fill("e2e-client");
        await addForm.locator("#ap-new-clientSecret").fill("e2e-secret");
        await addForm.getByRole("button", { name: "Ajouter" }).click();
        await expect(editForm).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });

      try {
        const enabled = editForm.locator(`#ap-${key}-enabled`);
        await enabled.selectOption("false");
        await editForm.getByRole("button", { name: "Enregistrer" }).click();
        await expect(editForm.getByText("Fournisseur enregistré.")).toBeVisible();
        await expect(enabled).toHaveValue("false");

        // A second save must not send the select's mount-time default back.
        await editForm.locator(`#ap-${key}-displayName`).fill("E2E select renamed");
        await editForm.getByRole("button", { name: "Enregistrer" }).click();
        await expect(editForm.locator(`#ap-${key}-displayName`)).toHaveValue("E2E select renamed");
        // The success message is still shown from the first save; the refreshed card title is not.
        const card = page.locator('[data-slot="card"]', { has: editForm });
        await expect(card.getByRole("heading", { name: "E2E select renamed" })).toBeVisible();
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(editForm.locator(`#ap-${key}-enabled`)).toHaveValue("false");
        await expect(editForm.locator(`#ap-${key}-displayName`)).toHaveValue("E2E select renamed");
      } finally {
        await editForm.getByRole("button", { name: "Supprimer" }).click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("button", { name: "Supprimer" }).click();
        await expect(editForm).toHaveCount(0);
      }
    });
  });

  test("an admin sees general settings only, without security, SSO or SMTP (#223)", async ({
    page,
  }) => {
    await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(page.locator("#set-app_name")).toBeVisible();
    await expect(page.locator("#set-registration_mode")).toHaveCount(0);
    await expect(page.locator("#set-security\\.admin_2fa_required")).toHaveCount(0);
    for (const path of ["/fr/admin/auth-providers", "/fr/admin/smtp"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(403);
    }
  });

  test("the admin nav only lists permitted tabs and fits a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const nav = page.getByRole("link", { name: "Utilisateurs", exact: true });
    await expect(nav).toHaveAttribute("aria-current", "page");
    // ADMIN lacks admin.signup_tokens.manage and admin.security.write (SUPER_ADMIN only).
    await expect(page.getByRole("link", { name: /jetons d’invitation/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /fournisseurs d’authentification/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "SMTP", exact: true })).toHaveCount(0);
    // The create form offers no role choice: an ADMIN can only create users.
    await expect(page.locator("#cu-role")).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
