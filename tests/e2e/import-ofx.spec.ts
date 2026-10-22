import { test, expect, type Page } from "@playwright/test";

type OfxRow = { day: string; amount: string; name: string };

// Synthetic OFX 1.x (SGML: unclosed leaves); bank and account numbers are invented.
function ofx(rows: OfxRow[], ledger: { amount: string; day: string }): Buffer {
  const trns = rows
    .map(
      (r, i) =>
        `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${r.day}<TRNAMT>${r.amount}<FITID>E2E${i}<NAME>${r.name}</STMTTRN>`,
    )
    .join("\n");
  return Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>99999<BRANCHID>00001<ACCTID>0000E2E04321<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20210301<DTEND>20210303
${trns}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${ledger.amount}<DTASOF>${ledger.day}</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`,
    "utf8",
  );
}

// Rows sum to 80.00; each test imports into its own fresh account (opening balance 0),
// so the file starts the account's history and nothing in it is a duplicate.
const rowsFor = (stamp: number): OfxRow[] => [
  { day: "20210301", amount: "-12.34", name: `CB OFX SHOP ${stamp}` },
  { day: "20210302", amount: "100.00", name: `VIR OFX SALARY ${stamp}` },
  { day: "20210303", amount: "-7.66", name: `PRLV OFX POWER ${stamp}` },
];

async function createAccount(page: Page, name: string) {
  await page.goto("/fr/accounts");
  await expect(async () => {
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="initialBalance"]', "0");
  await page.getByRole("button", { name: /créer le compte/i }).click();
  await expect(page.locator('[data-slot="card"]').filter({ hasText: name }).last()).toBeVisible();
}

// Keeps the persistent e2e DB from piling up test accounts (newest = default import target).
async function deleteAccount(page: Page, name: string) {
  await page.goto("/fr/accounts");
  const card = page.locator('[data-slot="card"]').filter({ hasText: name }).last();
  await expect(async () => {
    await card.getByRole("button", { name: /^actions pour/i }).click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/saisissez/i).fill(name);
  await dialog.getByRole("button", { name: /supprimer définitivement/i }).click();
  await expect(page.getByText(name)).toHaveCount(0);
}

async function upload(page: Page, account: string, name: string, buffer: Buffer) {
  await page.goto("/fr/import");
  // The only select before a file is picked: the upload account.
  await page.locator("select").first().selectOption({ label: account });
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/import/ofx") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/x-ofx",
    buffer,
  });
  return uploaded;
}

async function validate(page: Page) {
  const committed = page.waitForResponse(
    (r) => r.url().includes("/commit") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /valider l’import/i }).click();
  const res = await committed;
  await expect(page.getByRole("link", { name: /voir les transactions/i })).toBeVisible({
    timeout: 15_000,
  });
  return res.request().postDataJSON();
}

test.describe("OFX import (wizard)", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  // Also runs after a failed test.
  let created: string | null = null;
  test.afterEach(async ({ page }) => {
    if (created) await deleteAccount(page, created);
    created = null;
  });

  const rows = (page: Page) => page.locator('[data-slot="import-preview-row"]');
  const balance = (page: Page) => page.locator('[data-slot="import-ofx-balance"]');

  test("a .ofx file that isn't OFX is rejected", async ({ page }) => {
    await page.goto("/fr/import");
    await page.locator('input[type="file"]').setInputFiles({
      name: "not-really.ofx",
      mimeType: "application/x-ofx",
      buffer: Buffer.from("Date;Label;Amount\n01/03/2021;NOPE;1,00\n"),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: "Impossible de lire le fichier." }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a consistent statement matches the bank balance, imports, and flags probable duplicates", async ({
    page,
  }) => {
    const stamp = Date.now();
    const account = `OFX ${stamp}`;
    created = account;
    await createAccount(page, account);

    const res = await upload(
      page,
      account,
      `statement-${stamp}.ofx`,
      ofx(rowsFor(stamp), { amount: "80.00", day: "20210303" }),
    );
    expect(res.ok()).toBe(true);
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(balance(page)).toContainText("Solde banque au 3 mars 2021");
    await expect(balance(page)).toContainText("80,00");
    await expect(balance(page)).toContainText("Les soldes concordent");
    await expect(page.getByLabel(/caler le solde initial/i)).toHaveCount(0);

    const sent = await validate(page);
    expect(sent.adjustBalance).toEqual([]);
    await page.goto(`/fr/transactions?search=${stamp}`);
    await expect(
      page
        .locator('[data-slot="transaction-row"]')
        .filter({ hasText: `VIR OFX SALARY ${stamp}` })
        .first(),
    ).toBeVisible();

    // Same day + amount under another label: a probable duplicate, which the live
    // balance counts only once ticked.
    await upload(
      page,
      account,
      `again-${stamp}.ofx`,
      ofx([{ day: "20210301", amount: "-12.34", name: `CB OTHER LABEL ${stamp}` }], {
        amount: "80.00",
        day: "20210303",
      }),
    );
    const probable = rows(page).filter({ hasText: `CB OTHER LABEL ${stamp}` });
    await expect(probable.getByText("Doublon probable").first()).toBeVisible({ timeout: 15_000 });
    await expect(balance(page)).toContainText("Les soldes concordent");
    await probable.locator('input[type="checkbox"]:visible').check();
    await expect(balance(page)).toContainText("Écart\u00a0: 12,34");
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
  });

  test("an opening-balance gap can be adjusted at commit", async ({ page }) => {
    const stamp = Date.now();
    const account = `OFX gap ${stamp}`;
    created = account;
    await createAccount(page, account);

    await upload(
      page,
      account,
      `gap-${stamp}.ofx`,
      ofx(rowsFor(stamp), { amount: "130.00", day: "20210303" }),
    );
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(balance(page)).toContainText("Écart\u00a0: 50,00");

    // Unticking the +100 row moves the balance after import, so the gap with it.
    const salary = rows(page)
      .filter({ hasText: `VIR OFX SALARY ${stamp}` })
      .locator('input[type="checkbox"]:visible');
    await salary.uncheck();
    await expect(balance(page)).toContainText("Écart\u00a0: 150,00");
    await salary.check();
    await expect(balance(page)).toContainText("Écart\u00a0: 50,00");

    await page.getByLabel(/caler le solde initial/i).check();
    const sent = await validate(page);
    expect(sent.adjustBalance).toHaveLength(1);

    await page.goto("/fr/accounts");
    await expect(
      page
        .locator('[data-slot="card"]')
        .filter({ hasText: account })
        .last()
        .locator('[data-slot="account-balance"]'),
    ).toContainText("130,00");
  });
});
