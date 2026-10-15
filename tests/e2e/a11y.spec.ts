import { test, expect, type Page } from "@playwright/test";

const AXE = require.resolve("axe-core/axe.min.js");

type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

async function seriousViolations(page: Page, rules?: string[]): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  await page.addScriptTag({ path: AXE });
  // WebKit's axe sometimes samples a white backdrop under dark-theme text that isn't
  // on screen; contrast stays covered by the Chromium runs (follow-up #239).
  const skipContrast =
    page.context().browser()?.browserType().name() === "webkit" &&
    (await page.evaluate(
      () =>
        matchMedia("(prefers-color-scheme: dark)").matches ||
        document.documentElement.classList.contains("dark"),
    ));
  const violations = await page.evaluate(
    async ({ rules, skipContrast }) => {
      const axe = (
        window as unknown as {
          axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Violation[] }> };
        }
      ).axe;
      const result = await axe.run(document, {
        runOnly: rules
          ? { type: "rule", values: rules }
          : { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
        ...(skipContrast && { rules: { "color-contrast": { enabled: false } } }),
      });
      return result.violations;
    },
    { rules, skipContrast },
  );
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const DUP_ROW = "15/01/2020;A11Y DUPLICATE;1,00;";

async function uploadCsv(page: Page, csv: string) {
  await page.goto("/fr/import");
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/import/csv") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "a11y.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Date;Libellé;Débit;Crédit\n${csv}`),
  });
  await uploaded;
  await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
    timeout: 15_000,
  });
}

// Imports a fixed 2020 row once, then previews it again next to a new row so the
// review step shows a duplicate badge and a dimmed row.
async function openImportReview(page: Page) {
  await uploadCsv(page, DUP_ROW);
  const validate = page.getByRole("button", { name: /valider l’import/i });
  if (await validate.isEnabled()) {
    const committed = page.waitForResponse((r) => r.url().includes("/commit"), {
      timeout: 30_000,
    });
    await validate.click();
    await committed;
  }
  await uploadCsv(page, `${DUP_ROW}\n16/01/2020;A11Y ${Date.now()};2,00;`);
  await expect(page.getByText(/^doublon$/i).first()).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme });
    });

    test("login has no serious violations", async ({ page }) => {
      await page.goto("/fr/login");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    // The CI owner has no budget, so WARN/OVER badges are not covered here.
    test.describe("signed in", () => {
      test.use({ storageState: "tests/e2e/.auth/owner.json" });
      test.slow();

      for (const path of ["/fr/dashboard", "/fr/transactions", "/fr/budgets", "/fr/import"]) {
        test(`${path} has no serious violations`, async ({ page }) => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(await seriousViolations(page)).toEqual([]);
        });
      }

      test("the import review step has no serious violations", async ({ page, browserName }) => {
        test.skip(browserName === "webkit", "Playwright WebKit doesn't deliver taps in this env");
        await openImportReview(page);
        expect(await seriousViolations(page)).toEqual([]);
      });

      test("the category dialog has no serious violations", async ({ page, browserName }) => {
        test.skip(browserName === "webkit", "Playwright WebKit doesn't deliver taps in this env");
        await page.goto("/fr/categories");
        await expect(async () => {
          await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
          await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        expect(await seriousViolations(page)).toEqual([]);
      });

      test("the transaction detail sheet is named and has no serious violations", async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === "webkit", "Playwright WebKit doesn't deliver taps in this env");
        await page.goto("/fr/transactions");
        const sheet = page.getByRole("dialog");
        await expect(async () => {
          await page.locator('[data-slot="transaction-row"]').first().click();
          await expect(sheet).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        await expect(sheet).toHaveAccessibleName(/\S/);
        // Full axe in light mode; dark mode checks the dialog name only (#229 TX-06).
        const rules = colorScheme === "dark" ? ["aria-dialog-name"] : undefined;
        expect(await seriousViolations(page, rules)).toEqual([]);
      });
    });
  });
}

test.describe("axe (dark theme cookie)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.slow();

  test("the dashboard has no serious violations", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "bilan-theme", value: "dark", url: baseURL! }]);
    await page.goto("/fr/dashboard");
    await expect(page.locator("html.dark")).toBeAttached();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

for (const { path, auth } of [
  { path: "/fr/login", auth: undefined },
  { path: "/fr/dashboard", auth: "tests/e2e/.auth/owner.json" },
]) {
  test.describe(`skip link on ${path}`, () => {
    test.use({ storageState: auth });

    test("is the first tab stop and moves focus to main", async ({ page, browserName }) => {
      await page.goto(path);
      // WebKit leaves links out of the plain Tab order.
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      const skip = page.getByRole("link", { name: "Aller au contenu principal" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      expect(
        await skip.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
      ).toBeGreaterThan(8);
      // Headless WebKit on the CI runner doesn't activate links with Enter.
      if (browserName === "webkit") return;
      await page.keyboard.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
    });
  });
}
