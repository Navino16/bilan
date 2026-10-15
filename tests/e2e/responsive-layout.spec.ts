import { test, expect, type Locator, type Page } from "@playwright/test";

// Below lg (1024px) the shell is the mobile one (drawer + bottom nav); the sidebar
// only shows from lg up (#167). Every page must fit each width without scrolling sideways.
const PAGES = [
  "/fr/dashboard",
  "/fr/transactions",
  "/fr/accounts",
  "/fr/groups",
  "/fr/budgets",
  "/fr/categories",
  "/fr/insights",
  "/fr/import",
  "/fr/settings/security",
  "/fr/settings/data",
];
const ADMIN_PAGES = ["/fr/admin/users", "/fr/admin/audit", "/fr/admin/signup-tokens"];
const WIDTHS = [320, 768, 1024];

async function expectLayout(page: Page, path: string, width: number) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(page.locator("main h1")).toBeVisible();
  const bottomNav = page.getByRole("navigation", { name: "Navigation rapide" });
  if (width < 1024) {
    await expect(bottomNav, path).toBeVisible();
    await expect(page.locator("aside"), path).toBeHidden();
    await expect(page.getByRole("button", { name: "Ouvrir le menu" }), path).toBeVisible();
  } else {
    await expect(page.locator("aside"), path).toBeVisible();
    await expect(bottomNav, path).toBeHidden();
    await expect(page.getByRole("button", { name: "Ouvrir le menu" }), path).toBeHidden();
  }
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: `horizontal overflow on ${path} at ${width}px` },
    )
    .toBeLessThanOrEqual(0);
}

async function expectNoPageOverflow(page: Page, what: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: `horizontal overflow on ${what}` },
    )
    .toBeLessThanOrEqual(0);
}

// The element's content is neither clipped nor spilling out sideways.
async function expectFits(locator: Locator, what: string) {
  await expect
    .poll(() => locator.evaluate((el) => el.scrollWidth - el.clientWidth), { message: what })
    .toBeLessThanOrEqual(0);
}

async function expectMinWidth(locator: Locator, min: number, what: string) {
  await expect
    .poll(async () => (await locator.boundingBox())?.width ?? 0, { message: what })
    .toBeGreaterThanOrEqual(min);
}

async function deleteGroupIfPresent(page: Page, name: string) {
  await page.goto("/fr/groups", { waitUntil: "domcontentloaded", timeout: 90_000 });
  const card = page.getByRole("link", { name: new RegExp(name) });
  if ((await card.count()) === 0) return;
  await card.first().click();
  await page.waitForURL(/\/groups\/[a-z0-9]+$/i);
  const dialog = page.locator('[data-slot="confirm-dialog"]');
  await expect(async () => {
    await page.getByRole("main").getByRole("button", { name: "Supprimer le foyer" }).click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await dialog.getByRole("button", { name: "Supprimer le foyer" }).click();
  await page.waitForURL(/\/groups$/);
}

async function openUserDeleteDialog(page: Page, row: Locator) {
  const dialog = page.locator('[data-slot="confirm-dialog"]');
  await expect(async () => {
    await row.getByRole("button", { name: /actions pour/i }).click();
    await page.getByRole("menuitem", { name: /supprimer définitivement/i }).click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

async function confirmUserDelete(dialog: Locator, email: string) {
  await dialog.getByRole("textbox").fill(email);
  await dialog.getByRole("button", { name: /supprimer définitivement/i }).click();
  await expect(dialog).toBeHidden();
}

async function deleteUserIfPresent(page: Page, email: string) {
  await page.goto(`/fr/admin/users?q=${encodeURIComponent(email)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const row = page.locator('[data-slot="admin-user-row"]', { hasText: email });
  if ((await row.count()) === 0) return;
  await confirmUserDelete(await openUserDeleteDialog(page, row), email);
}

test.describe("responsive layout (#167)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only viewport probe");

  for (const width of WIDTHS) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test.describe("as a user", () => {
        test.use({ storageState: "tests/e2e/.auth/owner.json" });

        test("pages fit and show the matching navigation", async ({ page }) => {
          test.setTimeout(180_000);
          for (const path of PAGES) await expectLayout(page, path, width);
        });
      });

      test.describe("as an admin", () => {
        test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

        test("admin pages fit and show the matching navigation", async ({ page }) => {
          test.setTimeout(120_000);
          for (const path of ADMIN_PAGES) await expectLayout(page, path, width);
        });
      });
    });
  }

  // Full role names and full amounts are longer than the old « Admin » / « 2,9 € » (#226).
  for (const width of [320, 375]) {
    test.describe(`long labels at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      const fitsInside = (selector: string) =>
        `[...document.querySelectorAll('${selector}')].every((el) => {
          const box = el.getBoundingClientRect();
          return el.scrollWidth <= el.clientWidth && box.right <= document.documentElement.clientWidth;
        })`;

      test.describe("as an admin", () => {
        test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

        test("role badges and selects fit the user rows", async ({ page }) => {
          await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
          const rows = page.locator('[data-slot="admin-user-row"]');
          await expect(rows.first()).toBeVisible();
          await expect(
            rows.locator('[data-slot="badge"]', { hasText: "Super-administrateur" }),
          ).toBeVisible();
          expect(await page.evaluate(fitsInside('[data-slot="admin-user-row"]'))).toBe(true);
          for (const role of await rows.getByRole("combobox").all()) {
            const box = (await role.boundingBox())!;
            expect(box.x + box.width).toBeLessThanOrEqual(width);
          }
        });
      });

      test.describe("as a user", () => {
        test.use({ storageState: "tests/e2e/.auth/owner.json" });

        test("the budget snapshot's full amounts fit the card", async ({ page }) => {
          await page.goto("/fr/dashboard", { waitUntil: "domcontentloaded", timeout: 90_000 });
          const snapshot = page.locator('[data-slot="budget-snapshot"]');
          await expect(snapshot).toBeVisible();
          expect(await page.evaluate(fitsInside('[data-slot="budget-snapshot"]'))).toBe(true);
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              ),
            )
            .toBeLessThanOrEqual(0);
        });
      });
    });
  }

  test.describe("transactions list and filters", () => {
    test.use({ storageState: "tests/e2e/.auth/owner.json" });

    test("at 768px: card list and filter sheet", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(page.getByRole("button", { name: /^filtres/i })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeHidden();
      await expect(page.locator('[data-slot="transaction-row"]').first()).toBeVisible();
      await expect(page.locator('[data-slot="row-label"]').first()).toBeHidden();
    });

    test("at 1024px: inline filters and a readable label column", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
      await expect(page.getByRole("button", { name: "Sorties", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^filtres/i })).toBeHidden();
      const label = page.locator('[data-slot="row-label"]').first();
      await expect(label).toBeVisible();
      expect((await label.boundingBox())!.width).toBeGreaterThan(300);
    });
  });

  test.describe("narrow widths and long names (#224)", () => {
    test.describe("signed out", () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test("at 320px the passkey button wraps inside the login card", async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto("/fr/login", { waitUntil: "domcontentloaded", timeout: 90_000 });
        const passkey = page.getByRole("button", { name: /clé d’accès/i });
        await expect(passkey).toBeVisible();
        await expectFits(passkey, "passkey button text");
        await expectNoPageOverflow(page, "/fr/login at 320px");
      });
    });

    test.describe("as a user", () => {
      test.use({ storageState: "tests/e2e/.auth/owner.json" });

      test("period presets and category filter are not clipped on desktop", async ({ page }) => {
        test.setTimeout(120_000);
        for (const width of [1024, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
          await expect(page.getByRole("button", { name: "Personnalisé" }).first()).toBeVisible();
          await expectFits(
            page.locator('main [data-slot="scroll-fade"]').first(),
            `period presets at ${width}px`,
          );
          await expectFits(
            page.locator('[data-slot="category-filter-label"]'),
            `category filter label at ${width}px`,
          );
        }
        await page.goto("/fr/categories", { waitUntil: "domcontentloaded", timeout: 90_000 });
        await expectFits(page.locator('main [data-slot="scroll-fade"]').first(), "categories tabs");
      });

      test("at 320px the create form stacks Type/Category with matching heights", async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto("/fr/transactions?new=1", {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const type = page.locator("#tx-type");
        const category = page.locator('[data-slot="category-combobox"]');
        await expect(category).toBeVisible({ timeout: 20_000 });
        await expect
          .poll(
            async () =>
              ((await category.boundingBox())?.height ?? 0) -
              ((await type.boundingBox())?.height ?? -1),
            { message: "category vs type field height" },
          )
          .toBe(0);
        await expectFits(category.locator("span").last(), "category combobox value");
      });

      test("at 320px member names keep their room next to the role select", async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto("/fr/groups/e2e-shared-group", {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const row = page.locator('[data-slot="member-row"]', { hasText: "member@e2e.local" });
        await expect(row).toBeVisible();
        await expectFits(row.getByText("E2E Member", { exact: true }), "member name");
        await expectMinWidth(row.getByRole("combobox"), 90, "member role select");
        await expectNoPageOverflow(page, "group detail at 320px");
      });

      test("at 320px insights tiles, group rows and the transaction list are not clipped", async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 320, height: 800 });

        await page.goto("/fr/insights", { waitUntil: "domcontentloaded", timeout: 90_000 });
        await expect(page.locator("main h1")).toBeVisible();
        const tiles = page
          .locator('[data-slot="card"]')
          .filter({ has: page.locator('[data-slot="insights-tile-amount"]') });
        for (const tile of await tiles.all()) await expectFits(tile, "insights tile amount");
        await expectNoPageOverflow(page, "/fr/insights at 320px");

        await page.goto("/fr/groups/e2e-shared-group", {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await expect(page.locator("main h1")).toBeVisible();
        // Names wrap instead of being cut: the whole text is laid out inside the box.
        const names = page.locator(
          '[data-slot="shared-account-name"], [data-slot="invitation-email"]',
        );
        for (const name of await names.all()) {
          await expect
            .poll(() =>
              name.evaluate(
                (el) =>
                  el.scrollWidth <= el.clientWidth &&
                  el.scrollHeight <= el.clientHeight &&
                  getComputedStyle(el).textOverflow !== "ellipsis",
              ),
            )
            .toBe(true);
        }
        await expectNoPageOverflow(page, "group detail at 320px");

        await page.goto("/fr/transactions", { waitUntil: "domcontentloaded", timeout: 90_000 });
        const search = page.getByRole("searchbox", { name: "Rechercher", exact: true });
        await expect(search).toBeVisible();
        // The placeholder is measured, not the (empty) value.
        expect(
          await search.evaluate((el: HTMLInputElement) => {
            const style = getComputedStyle(el, "::placeholder");
            const ctx = document.createElement("canvas").getContext("2d")!;
            ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const box = getComputedStyle(el);
            const room =
              el.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
            return ctx.measureText(el.placeholder).width <= room;
          }),
        ).toBe(true);
        // A long amount may still truncate the label; only the "Liée" pill must not squeeze it.
        for (const label of await page.locator('[data-slot="row-label-mobile"]').all()) {
          expect(
            await label.evaluate((el: HTMLElement) => {
              const pill = el.nextElementSibling as HTMLElement | null;
              return !pill || el.scrollWidth <= el.clientWidth || pill.offsetTop > el.offsetTop;
            }),
          ).toBe(true);
        }
      });

      test("at 390px a long foyer name wraps in the title and the share dialog", async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 390, height: 844 });
        const name = `Foyer au nom particulièrement long pour les tests ${Date.now()}`;
        try {
          await page.goto("/fr/groups", { waitUntil: "domcontentloaded", timeout: 90_000 });
          await expect(async () => {
            await page.getByRole("button", { name: /nouveau foyer/i }).click();
            await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2000 });
          }).toPass({ timeout: 20_000 });
          await page.fill('input[name="name"]', name);
          await page.getByRole("button", { name: /créer le foyer/i }).click();
          const card = page.getByRole("link", { name: new RegExp(name) });
          await expect(card).toBeVisible({ timeout: 15_000 });
          await card.click();
          await page.waitForURL(/\/groups\/[a-z0-9]+$/i);

          const title = page.locator("main h1");
          await expect(title).toHaveAttribute("title", name);
          await expectFits(title, "group title");
          await expect
            .poll(() => title.evaluate((el) => el.scrollHeight <= el.clientHeight), {
              message: "group title clipped vertically",
            })
            .toBe(true);
          // Wrapped onto several lines instead of being cut on one.
          expect((await title.boundingBox())!.height).toBeGreaterThan(40);
          await expectNoPageOverflow(page, "long group title at 390px");

          await page.goto("/fr/accounts", { waitUntil: "domcontentloaded", timeout: 90_000 });
          const account = page
            .locator('[data-slot="card"]')
            .filter({ hasText: "E2E Courant" })
            .last();
          const share = page.getByRole("menuitem", { name: /partager/i });
          await expect(async () => {
            await account.getByRole("button", { name: /^actions pour/i }).click();
            await expect(share).toBeVisible({ timeout: 2000 });
          }).toPass({ timeout: 20_000 });
          await share.click();
          const shareRow = page.locator('[data-slot="share-row"]', { hasText: name });
          await expect(shareRow).toBeVisible();
          await expectFits(shareRow.getByText(name), "share dialog group name");
          await expectMinWidth(shareRow.getByLabel(name), 72, "share access select");
        } finally {
          await deleteGroupIfPresent(page, name);
        }
      });
    });

    test.describe("as a super admin", () => {
      test.use({ storageState: "tests/e2e/.auth/superadmin.json" });

      test("at 375px every user row puts its role control on its own line", async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
        const rows = page.locator('[data-slot="admin-user-row"]');
        await expect(rows.first()).toBeVisible();
        for (const row of await rows.all()) {
          const text = (await row.locator(":scope > div").first().boundingBox())!;
          const control = (await row.locator(":scope > div").last().boundingBox())!;
          expect(control.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
        }
      });

      test("at 390px the user role select stays readable", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/fr/admin/users?q=roles-target", {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const row = page.locator('[data-slot="admin-user-row"]', { hasText: "roles-target" });
        await expect(row).toBeVisible();
        await expectMinWidth(row.getByRole("combobox"), 80, "admin role select");
        await expectNoPageOverflow(page, "admin users at 390px");
      });

      test("at 320px the delete dialog shows a long e-mail in full", async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 320, height: 800 });
        const email = `e2e-delete-dialog-with-a-long-address-${Date.now()}@long-domain-e2e.local`;
        try {
          await page.goto("/fr/admin/users", { waitUntil: "domcontentloaded", timeout: 90_000 });
          await expect(async () => {
            await page.fill("#cu-name", "E2E Long e-mail");
            await page.fill("#cu-email", email);
            await page.getByRole("button", { name: /^créer$/i }).click();
            await expect(page.getByText(/utilisateur créé/i)).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 30_000 });

          await page.goto(`/fr/admin/users?q=${encodeURIComponent(email)}`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          const row = page.locator('[data-slot="admin-user-row"]', { hasText: email });
          await expectMinWidth(row.getByRole("combobox"), 80, "role select next to a long e-mail");
          await expectNoPageOverflow(page, "admin users at 320px");
          const dialog = await openUserDeleteDialog(page, row);

          const label = dialog.locator("label");
          await expect(label).toContainText(email);
          await expectFits(label, "e-mail to type");
          await expectFits(dialog, "delete dialog");
          const [dialogBox, labelBox] = [await dialog.boundingBox(), await label.boundingBox()];
          expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
          expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(
            dialogBox!.x + dialogBox!.width,
          );
          await confirmUserDelete(dialog, email);
        } finally {
          await deleteUserIfPresent(page, email);
        }
      });
    });
  });
});
