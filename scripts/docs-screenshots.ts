import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// Regenerates docs/images/{en,fr}/*.png against a production build served on the
// `npm run docs:db` database (see scripts/docs-db.sh): `npm run docs:screenshots`.
const BASE_URL = (process.env.DOCS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.DOCS_EMAIL ?? "dev@bilan.local";
const PASSWORD = process.env.DOCS_PASSWORD ?? "dev-password-123";
const LOCALES = ["en", "fr"] as const;
const OUT_DIR = path.resolve("docs/images");

type Locale = (typeof LOCALES)[number];
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

type Shot = {
  name: string;
  path: string;
  fullPage?: boolean;
  maxHeight?: number;
  mobile?: boolean;
  prepare?: (page: Page) => Promise<void>;
  cleanup?: (page: Page) => Promise<void>;
};

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

// The first click on a freshly hydrating page can be dropped: retry until the target shows.
async function clickUntilVisible(trigger: Locator, target: Locator) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await target.isVisible()) return;
    await trigger.click();
    try {
      await target.waitFor({ state: "visible", timeout: 3_000 });
      return;
    } catch {}
  }
  throw new Error(`${target} never became visible`);
}

async function gotoLink(page: Page, link: Locator) {
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`${link} has no href`);
  await page.goto(new URL(href, BASE_URL).toString());
}

function importCsv(): { name: string; mimeType: string; buffer: Buffer } {
  // Previous month early in the month, so no row is dated in the future.
  const now = new Date();
  if (now.getDate() < 12) now.setDate(0);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const monthName = now
    .toLocaleString("fr-FR", { month: "long" })
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const rows: [string, string, string][] = [
    ["02", "CB CARREFOUR MARKET", "-54,20"],
    ["03", "PRLV EDF", "-89,00"],
    ["05", "VIR SALAIRE ACME", "2450,00"],
    ["07", "CB SNCF CONNECT", "-38,50"],
    ["09", "CB BOULANGERIE DU PORT", "-6,80"],
    ["12", "CB NETFLIX", "-13,49"],
  ];
  const csv = [
    "Date;Libellé;Montant",
    ...rows.map(
      ([day, label, amount]) => `${day}/${month}/${now.getFullYear()};${label};${amount}`,
    ),
  ].join("\n");
  return {
    name: `releve-${monthName}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  };
}

function rulesFile(): { name: string; mimeType: string; buffer: Buffer } {
  const rule = (pattern: string, ...category: string[]) => ({
    pattern,
    matchType: "CONTAINS",
    caseSensitive: false,
    priority: 100,
    enabled: true,
    category: category.map((name) => ({ name })),
  });
  const file = {
    format: "bilan-rules",
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: [
      rule("CARREFOUR", "Alimentation", "Courses"),
      rule("SNCF", "Transport", "Transports en commun"),
      rule("PHARMACIE", "Santé", "Pharmacie"),
      rule("VETERINAIRE", "Animaux", "Vétérinaire"),
      rule("DECATHLON", "Loisirs", "Sport"),
    ],
  };
  return {
    name: "bilan-rules.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file), "utf8"),
  };
}

const SHOTS: Shot[] = [
  { name: "dashboard", path: "/dashboard", fullPage: true },
  { name: "insights", path: "/insights", fullPage: true },
  { name: "accounts", path: "/accounts" },
  { name: "transactions", path: "/transactions" },
  {
    name: "transaction-detail",
    path: "/transactions",
    prepare: (page) =>
      clickUntilVisible(
        page.locator('[data-slot="transaction-row"]').first(),
        page.getByRole("dialog"),
      ),
  },
  { name: "suggestions", path: "/transactions/suggestions" },
  { name: "import", path: "/import" },
  {
    name: "import-preview",
    path: "/import",
    prepare: async (page) => {
      const firstRow = page.locator('[data-slot="import-preview-row"]').first();
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.locator('input[type="file"]').setInputFiles(importCsv());
        try {
          await firstRow.waitFor({ state: "visible", timeout: 15_000 });
          return;
        } catch {}
      }
      throw new Error("the import preview never showed");
    },
    // Cancelling discards the pending import batch the upload created.
    cleanup: async (page) => {
      const discarded = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("button", { name: /^(Cancel|Annuler)$/ }).click();
      await discarded;
    },
  },
  { name: "categories", path: "/categories" },
  {
    name: "rules",
    path: "/categories",
    prepare: (page) =>
      clickUntilVisible(
        page.getByRole("button", { name: /^(Rules|Règles)/ }),
        page.getByRole("button", { name: /^(New rule|Nouvelle règle)$/ }),
      ),
  },
  {
    name: "rules-import",
    path: "/categories",
    prepare: async (page) => {
      await clickUntilVisible(
        page.getByRole("button", { name: /^(Rules|Règles)/ }),
        page.getByRole("button", { name: /^(New rule|Nouvelle règle)$/ }),
      );
      await clickUntilVisible(
        page.getByRole("button", { name: /^(Import|Importer)$/ }),
        page.getByRole("dialog"),
      );
      const dialog = page.getByRole("dialog");
      await dialog.locator("#rules-import-file").setInputFiles(rulesFile());
      await dialog.getByRole("button", { name: /^(Continue|Continuer)$/ }).click();
      const rows = dialog.locator('[data-slot="rules-import-category"]');
      await rows.first().waitFor({ state: "visible", timeout: 15_000 });
      const mapped = rows.filter({ hasText: /Vétérinaire/ });
      await mapped.getByRole("button", { name: /^(Map to|Associer à)$/ }).click();
      await mapped.locator('[data-slot="category-combobox"]').click();
      await page.getByRole("menuitem", { name: /Divers/ }).click();
      await dialog
        .locator('[data-slot="rules-import-conflict"]')
        .getByRole("button", { name: /^(Move|Déplacer)$/ })
        .click();
    },
    // The review step wrote nothing: closing it leaves the data set untouched.
    cleanup: (page) => page.keyboard.press("Escape"),
  },
  { name: "budgets", path: "/budgets" },
  {
    name: "budget-detail",
    path: "/budgets",
    prepare: (page) => gotoLink(page, page.locator('main a[href*="/budgets/"]').first()),
  },
  { name: "groups", path: "/groups" },
  {
    name: "group-detail",
    path: "/groups",
    fullPage: true,
    prepare: (page) => gotoLink(page, page.locator('main a[href*="/groups/"]').first()),
  },
  { name: "settings-security", path: "/settings/security", fullPage: true },
  { name: "settings-data", path: "/settings/data" },
  { name: "admin-users", path: "/admin/users", fullPage: true },
  { name: "admin-signup-tokens", path: "/admin/signup-tokens", fullPage: true },
  { name: "admin-auth-providers", path: "/admin/auth-providers", fullPage: true },
  { name: "admin-smtp", path: "/admin/smtp", fullPage: true },
  { name: "admin-app-settings", path: "/admin/app-settings", fullPage: true },
  { name: "admin-audit", path: "/admin/audit", fullPage: true, maxHeight: 2400 },
  { name: "mobile-dashboard", path: "/dashboard", mobile: true },
  { name: "mobile-transactions", path: "/transactions", mobile: true },
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Lets entry animations (sheets, charts) finish.
  await page.waitForTimeout(800);
}

// Full-page shots grow the viewport to the page height rather than using `fullPage`, so the
// sidebar (sized to the viewport) runs down the whole image.
async function capture(
  page: Page,
  locale: Locale,
  shot: Pick<Shot, "name" | "fullPage" | "maxHeight">,
) {
  if (shot.fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({
      width: DESKTOP.viewport.width,
      height: Math.min(height, shot.maxHeight ?? Infinity),
    });
  }
  await settle(page);
  await page.screenshot({ path: path.join(OUT_DIR, locale, `${shot.name}.png`) });
  console.log(`  ${locale}/${shot.name}.png`);
}

async function newContext(browser: Browser, mobile: boolean, storageState?: StorageState) {
  const context = await browser.newContext({
    ...(mobile ? MOBILE : DESKTOP),
    colorScheme: "light",
    storageState,
  });
  await context.addCookies([{ name: "bilan-theme", value: "light", url: BASE_URL }]);
  return context;
}

async function captureLogin(browser: Browser, locale: Locale) {
  const context = await newContext(browser, false);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/${locale}/login`);
  await capture(page, locale, { name: "login" });
  await context.close();
}

// A single sign-in for the whole run: the login rate limiter is in-memory.
async function signIn(browser: Browser): Promise<StorageState> {
  const context = await newContext(browser, false);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/en/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

// Ends the run's own session so reruns don't pile up "other devices" on the security page.
async function signOut(context: BrowserContext) {
  const response = await context.request.post(`${BASE_URL}/api/auth/sign-out`, {
    headers: { origin: BASE_URL },
    data: {},
  });
  if (!response.ok()) console.warn(`sign-out failed: HTTP ${response.status()}`);
}

async function main() {
  const browser = await chromium.launch();
  let desktop: BrowserContext | undefined;
  try {
    const state = await signIn(browser);
    desktop = await newContext(browser, false, state);
    const mobile = await newContext(browser, true, state);
    for (const locale of LOCALES) {
      console.log(`${locale}:`);
      await mkdir(path.join(OUT_DIR, locale), { recursive: true });
      await captureLogin(browser, locale);
      for (const shot of SHOTS) {
        const page = await (shot.mobile ? mobile : desktop).newPage();
        try {
          await page.goto(`${BASE_URL}/${locale}${shot.path}`);
          await settle(page);
          await shot.prepare?.(page);
          await capture(page, locale, shot);
        } finally {
          await shot.cleanup?.(page).catch((error: unknown) => console.warn(error));
          await page.close();
        }
      }
    }
  } finally {
    if (desktop) await signOut(desktop);
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
