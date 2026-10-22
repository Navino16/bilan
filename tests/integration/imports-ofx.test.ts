import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { insertRows } from "@/server/services/imports/commit";
import {
  buildSecureFields,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";
import { createGroup } from "@/server/services/groups";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import {
  commitOfxBatch,
  createOfxBatch,
  previewOfxBatch,
} from "@/server/services/imports/ofx-service";

const owner = "ofx_owner";
const writer = "ofx_writer";
const stranger = "ofx_stranger";
const ids = [owner, writer, stranger];
const GROUP = "ofx_group";

type Trn = { date: string; amount: string; name: string; type?: string; memo?: string };

// Synthetic SGML 1.x statement (invented bank and account numbers).
function ofxFile(opts: {
  trns: Trn[];
  ledger?: { amount: string; asOf: string };
  card?: boolean;
}): Buffer {
  const trns = opts.trns
    .map(
      (t, i) =>
        `<STMTTRN><TRNTYPE>${t.type ?? "DEBIT"}<DTPOSTED>${t.date}<TRNAMT>${t.amount}` +
        `<FITID>F${i}<NAME>${t.name}${t.memo ? `<MEMO>${t.memo}` : ""}</STMTTRN>`,
    )
    .join("\n");
  const ledger = opts.ledger
    ? `<LEDGERBAL><BALAMT>${opts.ledger.amount}<DTASOF>${opts.ledger.asOf}</LEDGERBAL>`
    : "";
  const body = opts.card
    ? `<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<CCACCTFROM><ACCTID>4970000011112222</CCACCTFROM>` +
      `<BANKTRANLIST>${trns}</BANKTRANLIST>${ledger}</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>`
    : `<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><BANKID>99999<BRANCHID>00001` +
      `<ACCTID>00012345678<ACCTTYPE>CHECKING</BANKACCTFROM>` +
      `<BANKTRANLIST>${trns}</BANKTRANLIST>${ledger}</STMTRS></STMTTRNRS></BANKMSGSRSV1>`;
  return Buffer.from(`OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX>\n${body}\n</OFX>\n`);
}

async function newAccount(ownerId = owner, initialBalance = 0): Promise<string> {
  const acc = await db.bankAccount.create({
    data: { ownerId, name: "Courant", type: "CHECKING", initialBalance },
  });
  return acc.id;
}

async function seedExisting(accountId: string, iso: string, amount: number, rawLabel: string) {
  const secure = buildSecureFields({ label: rawLabel, rawLabel });
  const date = new Date(`${iso}T00:00:00.000Z`);
  await db.transaction.create({
    data: {
      accountId,
      date,
      amount,
      type: "OTHER",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      merchantKeyHash: secure.merchantKeyHash,
      externalId: computeExternalIds([{ date, amount, rawLabel }])[0],
      createdById: owner,
    },
  });
}

const initialBalanceOf = async (accountId: string) =>
  Number((await db.bankAccount.findUniqueOrThrow({ where: { id: accountId } })).initialBalance);

async function upload(accountId: string, buffer: Buffer, actor = owner) {
  return (await createOfxBatch({ accountId, filename: "releve.ofx", buffer }, { id: actor })).id;
}

async function cleanup() {
  const accounts = await db.bankAccount.findMany({
    where: { ownerId: { in: ids } },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);
  await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.accountShare.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.group.deleteMany({ where: { name: GROUP } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("insertRows notes", () => {
  it("stores the note of an imported row, null without one", async () => {
    const accountId = await newAccount();
    const batch = await db.importBatch.create({
      data: { accountId, source: "OFX", status: "REVIEW", createdById: owner },
    });
    await insertRows(
      { batchId: batch.id, accountId },
      [
        {
          date: new Date("2031-01-05T00:00:00.000Z"),
          amount: -12.5,
          rawLabel: "CB NOTE SHOP",
          note: "MEMO TEXT",
        },
        { date: new Date("2031-01-06T00:00:00.000Z"), amount: -3, rawLabel: "CB NO NOTE" },
      ],
      { id: owner },
      { autoCategorize: false },
    );
    const txs = await db.transaction.findMany({ where: { accountId }, orderBy: { date: "asc" } });
    expect(decrypt(txs[0].noteEnc!, dataKey)).toBe("MEMO TEXT");
    expect(txs[1].noteEnc).toBeNull();
  });
});

describe("OFX import service", () => {
  it("creates, previews and commits a single-statement file", async () => {
    const accountId = await newAccount();
    const id = await upload(
      accountId,
      ofxFile({
        trns: [
          { date: "20310203", amount: "-12.50", name: "ACME STORE", type: "POS", memo: "REF 42" },
          { date: "20310204", amount: "-40", name: "ACME ENERGY", type: "DIRECTDEBIT" },
          { date: "garbage", amount: "-1", name: "UNREADABLE" },
        ],
      }),
    );
    const preview = await previewOfxBatch(id, owner);
    expect(preview.source).toBe("OFX");
    expect(preview.rejectedCount).toBe(1);
    expect(preview.products).toHaveLength(1);
    const [product] = preview.products;
    expect(product).toMatchObject({
      kind: "BANK",
      accountType: "CHECKING",
      accountLast4: "5678",
      totalRows: 2,
      balance: null,
    });
    expect(product.preview.map((r) => r.type)).toEqual(["CARD", "DIRECT_DEBIT"]);

    const summary = await commitOfxBatch(id, { [product.key]: accountId }, { id: owner });
    expect(summary.importedRows).toBe(2);
    expect(summary.rejectedRows).toBe(1);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    expect(batch.source).toBe("OFX");
    expect(batch.status).toBe("COMPLETED");
    const txs = await db.transaction.findMany({ where: { accountId }, orderBy: { date: "asc" } });
    expect(txs.map((t) => t.type)).toEqual(["CARD", "DIRECT_DEBIT"]);
    expect(decrypt(txs[0].noteEnc!, dataKey)).toBe("REF 42");
    expect(txs[1].noteEnc).toBeNull();
  });

  it("rejects a file without transactions", async () => {
    const accountId = await newAccount();
    await expect(
      upload(accountId, ofxFile({ trns: [], ledger: { amount: "10", asOf: "20310301" } })),
    ).rejects.toThrow("EMPTY");
    await expect(upload(accountId, Buffer.from("not an ofx file"))).rejects.toThrow("PARSE_FAILED");
  });

  it("reports the balance gap", async () => {
    const accountId = await newAccount(owner, 100);
    await seedExisting(accountId, "2031-02-01", -20, "CB EARLIER");
    await seedExisting(accountId, "2031-03-15", -7, "CB AFTER ASOF");
    const id = await upload(
      accountId,
      ofxFile({
        trns: [
          { date: "20310205", amount: "-10", name: "CB GAP ONE" },
          { date: "20310210", amount: "50.25", name: "VIR GAP TWO" },
        ],
        ledger: { amount: "150", asOf: "20310228" },
      }),
    );
    const { balance } = (await previewOfxBatch(id, owner)).products[0];
    expect(balance).toEqual({
      ledger: 150,
      asOf: "2031-02-28",
      base: 80,
      defaultImport: 40.25,
      canAdjust: false, // the account has an earlier transaction
    });
  });

  it("ignores rows after DTASOF in defaultImport and in the adjusted value", async () => {
    const accountId = await newAccount();
    const id = await upload(
      accountId,
      ofxFile({
        trns: [
          { date: "20310305", amount: "-10", name: "CB BEFORE" },
          { date: "20310320", amount: "-5", name: "CB AFTER" },
        ],
        ledger: { amount: "90", asOf: "20310310" },
      }),
    );
    const [product] = (await previewOfxBatch(id, owner)).products;
    expect(product.balance).toMatchObject({ base: 0, defaultImport: -10, canAdjust: true });
    await commitOfxBatch(
      id,
      { [product.key]: accountId },
      { id: owner },
      { adjustBalance: [product.key] },
    );
    expect(await initialBalanceOf(accountId)).toBe(100);
  });

  it("offers the adjustment on an empty account to its owner, not to a WRITE sharer", async () => {
    const accountId = await newAccount();
    const group = await createGroup({ name: GROUP }, owner);
    await db.groupMember.create({ data: { groupId: group.id, userId: writer, role: "MEMBER" } });
    await shareAccountWithGroup(
      { accountId, groupId: group.id, permission: "WRITE" },
      { id: owner },
    );
    const file = ofxFile({
      trns: [{ date: "20310405", amount: "-15", name: "CB SHARED" }],
      ledger: { amount: "85", asOf: "20310430" },
    });

    const ownBatch = await upload(accountId, file);
    expect((await previewOfxBatch(ownBatch, owner)).products[0].balance?.canAdjust).toBe(true);

    const sharerBatch = await upload(accountId, file, writer);
    const [product] = (await previewOfxBatch(sharerBatch, writer)).products;
    expect(product.balance).toMatchObject({ ledger: 85, base: 0, defaultImport: -15 });
    expect(product.balance?.canAdjust).toBe(false);
    await commitOfxBatch(
      sharerBatch,
      { [product.key]: accountId },
      { id: writer },
      { adjustBalance: [product.key] },
    );
    expect(await initialBalanceOf(accountId)).toBe(0);
  });

  it("does not offer the adjustment when the account has an earlier transaction", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, "2031-04-01", -3, "CB OLDER");
    const id = await upload(
      accountId,
      ofxFile({
        trns: [{ date: "20310405", amount: "-15", name: "CB LATER" }],
        ledger: { amount: "85", asOf: "20310430" },
      }),
    );
    expect((await previewOfxBatch(id, owner)).products[0].balance?.canAdjust).toBe(false);
  });

  it("gives no balance block for a CREDITCARD statement", async () => {
    const accountId = await newAccount();
    const id = await upload(
      accountId,
      ofxFile({
        card: true,
        trns: [{ date: "20310405", amount: "-15", name: "CB CARD" }],
        ledger: { amount: "-15", asOf: "20310430" },
      }),
    );
    const [product] = (await previewOfxBatch(id, owner)).products;
    expect(product).toMatchObject({ kind: "CREDITCARD", accountType: null, accountLast4: "2222" });
    expect(product.balance).toBeNull();
  });

  it("adjusts the opening balance at commit", async () => {
    const accountId = await newAccount();
    const id = await upload(
      accountId,
      ofxFile({
        trns: [
          { date: "20310503", amount: "-10", name: "CB ADJ ONE" },
          { date: "20310504", amount: "-20.10", name: "CB ADJ TWO" },
        ],
        ledger: { amount: "470", asOf: "20310531" },
      }),
    );
    const [product] = (await previewOfxBatch(id, owner)).products;
    await commitOfxBatch(
      id,
      { [product.key]: accountId },
      { id: owner },
      { adjustBalance: [product.key] },
    );
    expect(await initialBalanceOf(accountId)).toBe(500.1);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    expect((batch.metadata as { balanceAdjustments?: unknown }).balanceAdjustments).toEqual([
      { accountId, previous: 0, set: 500.1 },
    ]);
    const audit = await db.auditLog.findFirst({
      where: { action: "account.initial_balance_adjusted", entityId: accountId },
    });
    expect(audit).toMatchObject({ userId: owner, entity: "BankAccount" });
    expect(audit?.metadata).toEqual({ previous: 0, set: 500.1, batchId: id });
  });

  it("adjusts against the rows of every statement mapped to the account", async () => {
    const accountId = await newAccount();
    const first = ofxFile({
      trns: [{ date: "20310803", amount: "-10", name: "CB FIRST" }],
      ledger: { amount: "90", asOf: "20310815" },
    }).toString();
    const second = ofxFile({
      trns: [{ date: "20310810", amount: "-20", name: "CB SECOND" }],
      ledger: { amount: "500", asOf: "20310831" },
    }).toString();
    const body = (f: string) => f.slice(f.indexOf("<OFX>") + 5, f.indexOf("</OFX>"));
    const merged = Buffer.from(first.replace("</OFX>", `${body(second)}</OFX>`));
    const id = await upload(accountId, merged);
    const { products } = await previewOfxBatch(id, owner);
    expect(products).toHaveLength(2);
    await commitOfxBatch(
      id,
      { [products[0].key]: accountId, [products[1].key]: accountId },
      { id: owner },
      { adjustBalance: [products[0].key] },
    );
    const { _sum } = await db.transaction.aggregate({
      where: { accountId, date: { lte: new Date("2031-08-15T00:00:00.000Z") } },
      _sum: { amount: true },
    });
    expect((await initialBalanceOf(accountId)) + Number(_sum.amount)).toBeCloseTo(90, 2);
  });

  it("still adjusts when a sibling statement of the same file has earlier rows", async () => {
    const accountId = await newAccount();
    const first = ofxFile({
      trns: [{ date: "20310810", amount: "-10", name: "CB FIRST" }],
      ledger: { amount: "90", asOf: "20310815" },
    }).toString();
    const second = ofxFile({
      trns: [{ date: "20310803", amount: "-20", name: "CB SECOND" }],
      ledger: { amount: "500", asOf: "20310831" },
    }).toString();
    const body = (f: string) => f.slice(f.indexOf("<OFX>") + 5, f.indexOf("</OFX>"));
    const id = await upload(
      accountId,
      Buffer.from(first.replace("</OFX>", `${body(second)}</OFX>`)),
    );
    const { products } = await previewOfxBatch(id, owner);
    expect(products[0].balance?.canAdjust).toBe(true);
    await commitOfxBatch(
      id,
      { [products[0].key]: accountId, [products[1].key]: accountId },
      { id: owner },
      { adjustBalance: [products[0].key] },
    );
    const { _sum } = await db.transaction.aggregate({
      where: { accountId, date: { lte: new Date("2031-08-15T00:00:00.000Z") } },
      _sum: { amount: true },
    });
    expect((await initialBalanceOf(accountId)) + Number(_sum.amount)).toBeCloseTo(90, 2);
    expect(await initialBalanceOf(accountId)).toBe(120);
  });

  it("ignores adjustBalance when it no longer qualifies", async () => {
    const accountId = await newAccount();
    const id = await upload(
      accountId,
      ofxFile({
        trns: [{ date: "20310605", amount: "-10", name: "CB RACE" }],
        ledger: { amount: "90", asOf: "20310630" },
      }),
    );
    const [product] = (await previewOfxBatch(id, owner)).products;
    expect(product.balance?.canAdjust).toBe(true);
    await seedExisting(accountId, "2031-06-01", -1, "CB SNEAKED IN");
    const summary = await commitOfxBatch(
      id,
      { [product.key]: accountId },
      { id: owner },
      { adjustBalance: [product.key] },
    );
    expect(summary.importedRows).toBe(1);
    expect(await initialBalanceOf(accountId)).toBe(0);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    expect(batch.metadata).not.toHaveProperty("balanceAdjustments");
  });

  it("skips probable duplicates unless ticked", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, "2031-07-03", -9.99, "CARTE 03/07 SHOP");
    const id = await upload(
      accountId,
      ofxFile({
        trns: [
          { date: "20310703", amount: "-9.99", name: "CB SHOP" },
          { date: "20310704", amount: "-5", name: "CB OTHER" },
        ],
        ledger: { amount: "100", asOf: "20310731" },
      }),
    );
    const [product] = (await previewOfxBatch(id, owner)).products;
    expect(product.probableCount).toBe(1);
    expect(product.balance).toMatchObject({ base: -9.99, defaultImport: -5 });
    const summary = await commitOfxBatch(id, { [product.key]: accountId }, { id: owner });
    expect(summary).toMatchObject({ importedRows: 1, skippedRows: 1 });
  });

  it("forbids a user who cannot write the account to create, preview or commit a batch", async () => {
    const accountId = await newAccount();
    const file = ofxFile({ trns: [{ date: "20310801", amount: "-4", name: "CB STRANGER" }] });
    await expect(
      createOfxBatch({ accountId, filename: "x.ofx", buffer: file }, { id: stranger }),
    ).rejects.toThrow("FORBIDDEN");
    const id = await upload(accountId, file);
    await expect(previewOfxBatch(id, stranger)).rejects.toThrow("FORBIDDEN");
    await expect(commitOfxBatch(id, { "stmt-0": accountId }, { id: stranger })).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(await db.transaction.count({ where: { accountId } })).toBe(0);
  });

  it("refuses to preview or commit a product mapped to an account the actor cannot write", async () => {
    const accountId = await newAccount();
    const foreignId = await newAccount(stranger);
    const id = await upload(
      accountId,
      ofxFile({ trns: [{ date: "20310802", amount: "-4", name: "CB FOREIGN" }] }),
    );
    await expect(previewOfxBatch(id, owner, { accounts: { "stmt-0": foreignId } })).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(commitOfxBatch(id, { "stmt-0": foreignId }, { id: owner })).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(await db.transaction.count({ where: { accountId: foreignId } })).toBe(0);
  });
});
