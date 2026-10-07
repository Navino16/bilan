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

  test("the admin nav only lists permitted tabs and fits a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const nav = page.getByRole("link", { name: "Utilisateurs", exact: true });
    await expect(nav).toHaveAttribute("aria-current", "page");
    // ADMIN lacks admin.signup_tokens.manage (SUPER_ADMIN only) → no dead-end tab.
    await expect(page.getByRole("link", { name: /jetons d'invitation/i })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
