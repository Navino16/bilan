import { test, expect, type Page } from "@playwright/test";

const skipWebKit = ({ browserName }: { browserName: string }) => browserName === "webkit";
const skipReason = "Playwright WebKit doesn't deliver taps in this env (project-wide skip)";

async function setInstanceSwitch(page: Page, enabled: boolean) {
  const form = page.locator("form:has(#set-mcp_enabled)");
  await page.goto("/fr/admin/app-settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(async () => {
    await form.locator("#set-mcp_enabled").selectOption(String(enabled));
    await form.getByRole("button", { name: /enregistrer/i }).click();
    await expect(form.getByText("Enregistré.")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("AI assistants settings, instance switch off (#450)", () => {
  test.use({ storageState: "tests/e2e/.auth/member.json" });
  test.skip(skipWebKit, skipReason);

  test("says the administrator hasn't enabled it, without any control", async ({ page }) => {
    await page.goto("/fr/settings/ai");
    await expect(page.getByRole("heading", { level: 1, name: "Assistants IA" })).toBeVisible();
    await expect(page.locator('[data-slot="mcp-instance-off"]')).toContainText(
      "Indisponible sur cette instance",
    );
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Créer un jeton" })).toHaveCount(0);
  });
});

// The stale-session step-up is covered by tests/integration/mcp-actions.test.ts: the e2e suite
// can't age a browser session past the 10-minute window, so a fresh sign-in creates without it.
test.describe("AI assistants settings (#450)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(skipWebKit, skipReason);

  test("enable access, create a read token shown once, then revoke it", async ({
    browser,
    page,
  }) => {
    test.setTimeout(120_000);
    const admin = await browser.newContext({ storageState: "tests/e2e/.auth/superadmin.json" });
    const adminPage = await admin.newPage();
    await setInstanceSwitch(adminPage, true);
    try {
      await page.goto("/fr/login");
      await page.fill('input[name="email"]', "owner@e2e.local");
      await page.fill('input[name="password"]', "e2e-owner-pw-123456");
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

      await page.goto("/fr/settings/ai", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1, name: "Assistants IA" })).toBeVisible();
      const access = page.getByRole("switch", { name: "Autoriser les assistants IA" });
      const revokeButtons = page.locator("[data-token-id]").getByRole("button");
      // Leftovers of an interrupted run.
      if ((await access.getAttribute("aria-checked")) === "true") {
        await access.click();
        await expect(access).toHaveAttribute("aria-checked", "false");
      }
      while ((await revokeButtons.count()) > 0) {
        const left = await revokeButtons.count();
        await revokeButtons.first().click();
        await expect(revokeButtons).toHaveCount(left - 1);
      }
      await expect(
        page.getByText("Autorisez les assistants IA pour connecter un client."),
      ).toBeVisible();

      // Turning access on asks to accept the privacy warning first.
      const confirm = page.locator('[data-slot="confirm-dialog"]');
      await access.click();
      await expect(confirm).toContainText(
        "déchiffrés et envoyés au fournisseur de votre assistant",
      );
      await confirm.getByRole("button", { name: "Activer" }).click();
      await expect(confirm).toBeHidden();
      await expect(access).toHaveAttribute("aria-checked", "true");
      await expect(page.locator('[data-slot="mcp-endpoint"]')).toHaveValue(/\/api\/mcp$/);

      const name = `E2E ${Date.now()}`;
      const dialog = page.locator('[data-slot="mcp-token-dialog"]');
      await page.getByRole("button", { name: "Créer un jeton" }).click();
      await dialog.getByLabel("Nom", { exact: true }).fill(name);
      await expect(dialog.getByRole("radio", { name: "Lecture seule" })).toBeChecked();
      await dialog.getByRole("button", { name: "Créer le jeton" }).click();
      const value = dialog.locator('[data-slot="mcp-token-value"]');
      await expect(value).toHaveValue(/^bilan_pat_[A-Za-z0-9_-]{43}$/);
      await expect(dialog).toContainText("il ne sera plus affiché");
      await expect(page.locator('[data-slot="step-up"]')).toHaveCount(0);
      const token = await value.inputValue();
      await dialog.getByRole("button", { name: "Terminé" }).click();
      await expect(dialog).toBeHidden();

      const row = page.locator("[data-token-id]", { hasText: name });
      await expect(row).toContainText("Lecture seule");
      await expect(row).toContainText(token.slice(0, 16));
      await expect(row).toContainText("jamais utilisé");
      await expect(row).toContainText("expire le");

      // Shown once: after a reload only the prefix is left.
      await page.reload({ waitUntil: "networkidle" });
      await expect(row).toBeVisible();
      expect(await page.content()).not.toContain(token);

      await row.getByRole("button", { name: `Révoquer ${name}` }).click();
      await expect(row).toHaveCount(0);
      await expect(page.locator('[data-slot="mcp-tokens-empty"]')).toHaveText(
        "Aucun jeton personnel.",
      );

      // A write through MCP shows in the recent activity with the token's name. The edit
      // rewrites a transaction's own label and note, leaving the e2e data as it was.
      const writer = `E2E write ${Date.now()}`;
      await page.getByRole("button", { name: "Créer un jeton" }).click();
      await dialog.getByLabel("Nom", { exact: true }).fill(writer);
      await dialog.getByRole("radio", { name: "Lecture et écriture" }).check();
      await dialog.getByRole("button", { name: "Créer le jeton" }).click();
      await expect(value).toHaveValue(/^bilan_pat_/);
      const writeToken = await value.inputValue();
      await dialog.getByRole("button", { name: "Terminé" }).click();
      await expect(dialog).toBeHidden();

      const call = async (name: string, args: Record<string, unknown>) => {
        const res = await page.request.post("/api/mcp", {
          headers: {
            authorization: `Bearer ${writeToken}`,
            accept: "application/json, text/event-stream",
          },
          data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
        });
        expect(res.status()).toBe(200);
        const body = (await res.json()) as {
          result: { isError?: boolean; structuredContent: Record<string, unknown> };
        };
        expect(body.result.isError).toBeFalsy();
        return body.result.structuredContent;
      };
      const { accounts } = (await call("list_accounts", {})) as {
        accounts: { id: string; access: string }[];
      };
      const owned = new Set(accounts.filter((a) => a.access === "OWNER").map((a) => a.id));
      const { items } = (await call("search_transactions", { take: 100 })) as {
        items: { id: string; accountId: string; label: string; note: string | null }[];
      };
      const tx = items.find((item) => owned.has(item.accountId))!;
      expect(tx).toBeDefined();
      expect(
        await call("update_transaction", {
          id: tx.id,
          label: tx.label,
          ...(tx.note ? { note: tx.note } : {}),
        }),
      ).toEqual({ ok: true, id: tx.id });

      await page.reload({ waitUntil: "networkidle" });
      const latest = page.locator('[data-slot="mcp-activity"] li').first();
      await expect(latest).toContainText("Transaction modifiée");
      await expect(latest).toContainText(writer);
      await expect(page.locator('[data-slot="mcp-activity"] h3').first()).toHaveText(
        /aujourd’hui/i,
      );
      await page
        .locator("[data-token-id]", { hasText: writer })
        .getByRole("button", { name: `Révoquer ${writer}` })
        .click();
      await expect(page.locator('[data-slot="mcp-tokens-empty"]')).toBeVisible();

      // Turning access off needs no confirmation.
      await access.click();
      await expect(access).toHaveAttribute("aria-checked", "false");
      await expect(confirm).toHaveCount(0);
    } finally {
      await setInstanceSwitch(adminPage, false);
      await admin.close();
    }
  });
});
