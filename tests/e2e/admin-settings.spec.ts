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
    } finally {
      await saveName("Bilan");
    }
  });

  test("adds a provider, refuses a duplicate key, then deletes it (#163)", async ({ page }) => {
    test.setTimeout(120_000);
    const key = `e2e-${Date.now()}`;
    const addForm = page.locator("form:has(#ap-new-key)");
    const editForm = page.locator(`form:has(#ap-${key}-key)`);
    const add = async () => {
      await addForm.locator("#ap-new-key").fill(key);
      await addForm.locator("#ap-new-type").selectOption("credentials");
      await addForm.locator("#ap-new-displayName").fill("E2E provider");
      await addForm.getByRole("button", { name: "Ajouter" }).click();
    };
    await page.goto("/fr/admin/auth-providers", { waitUntil: "domcontentloaded", timeout: 90_000 });
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
    await page.goto("/fr/admin/auth-providers", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await expect(async () => {
      await addForm.locator("#ap-new-key").fill(key);
      await addForm.locator("#ap-new-type").selectOption("credentials");
      await addForm.locator("#ap-new-displayName").fill("E2E select");
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

  test("the admin nav only lists permitted tabs and fits a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const nav = page.getByRole("link", { name: "Utilisateurs", exact: true });
    await expect(nav).toHaveAttribute("aria-current", "page");
    // ADMIN lacks admin.signup_tokens.manage (SUPER_ADMIN only) → no dead-end tab.
    await expect(page.getByRole("link", { name: /jetons d’invitation/i })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
