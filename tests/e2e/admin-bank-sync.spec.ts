import { generateKeyPairSync } from "node:crypto";
import { test, expect } from "@playwright/test";

test.describe("bank sync admin page", () => {
  test.use({ storageState: "tests/e2e/.auth/superadmin.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("configures the Enable Banking application without exposing the key", async ({ page }) => {
    test.setTimeout(120_000);
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await page.goto("/fr/admin/bank-sync", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const appId = page.locator("#bs-applicationId");
    // The config is an instance singleton: never overwrite one the admin saved.
    test.skip((await appId.inputValue()) !== "", "a bank sync config already exists");
    await expect(page.locator("[data-slot=bank-sync-redirect]")).toHaveValue(
      /\/api\/bank-sync\/callback$/,
    );

    try {
      await expect(async () => {
        await appId.fill("e2e-app-id");
        await page.locator("#bs-privateKey").fill(pem);
        await expect(page.locator("#bs-enabled")).not.toBeChecked();
        await expect(page.locator("#bs-syncIntervalHours")).toHaveValue("6");
        await page.locator("#bs-syncIntervalHours").selectOption("12");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await expect(page.getByText("Configuration enregistrée.")).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(appId).toHaveValue("e2e-app-id");
      await expect(page.locator("#bs-syncIntervalHours")).toHaveValue("12");
      const key = page.locator("#bs-privateKey");
      await expect(key).toHaveValue("");
      await expect(key).toHaveAttribute("placeholder", /clé enregistrée/i);
      expect(await page.content()).not.toContain("PRIVATE KEY");
    } finally {
      await page.reload({ waitUntil: "domcontentloaded" });
      const remove = page.getByRole("button", { name: "Supprimer la configuration" });
      if (await remove.isVisible()) {
        await remove.click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("button", { name: "Supprimer la configuration" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(appId).toHaveValue("");
      }
    }
  });
});
