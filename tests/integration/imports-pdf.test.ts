import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { ImportAccessError } from "@/server/services/imports";
import { previewPdfBatch, commitPdfBatch } from "@/server/services/imports/pdf-service";

const owner = "pdf_owner";
const stranger = "pdf_stranger";
let courantId: string;
let depotId: string;

const PRODUCTS = [
  {
    key: "compte",
    rows: [{ date: "2025-01-03T00:00:00.000Z", amount: 30, rawLabel: "VIR JOHN DOE" }],
  },
  {
    key: "depot",
    rows: [{ date: "2025-01-10T00:00:00.000Z", amount: 50, rawLabel: "VERSEMENT DEPOT" }],
  },
];

async function seedBatch(products = PRODUCTS): Promise<string> {
  const b = await db.importBatch.create({
    data: {
      accountId: courantId,
      source: "PDF",
      filename: "revolut.pdf",
      status: "REVIEW",
      createdById: owner,
      metadata: { bank: "revolut", products } as never,
    },
  });
  return b.id;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "pdf-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "pdf-stranger@bilan.local" } });
  courantId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  depotId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Dépôt", type: "SAVINGS" } })
  ).id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId: { in: [courantId, depotId] } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: [courantId, depotId] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("PDF import pipeline", () => {
  it("pages each product's preview independently", async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({
      date: "2025-02-03T00:00:00.000Z",
      amount: -(i + 1),
      rawLabel: `CB PDF PAGE ${i}`,
    }));
    const b = await db.importBatch.create({
      data: {
        accountId: courantId,
        source: "PDF",
        filename: "long.pdf",
        status: "REVIEW",
        createdById: owner,
        metadata: { bank: null, products: [{ key: "compte", rows }, PRODUCTS[1]] } as never,
      },
    });
    const p = await previewPdfBatch(b.id, owner, { pages: { compte: 1 } });
    const [compte, depot] = p.products;
    expect(compte.totalRows).toBe(70);
    expect(compte.page).toBe(1);
    expect(compte.preview).toHaveLength(20);
    expect(compte.preview[0].rawLabel).toBe("CB PDF PAGE 50");
    expect(depot.page).toBe(0);
  });

  it("forbids preview for a user who cannot write the account", async () => {
    const id = await seedBatch();
    await expect(previewPdfBatch(id, stranger)).rejects.toBeInstanceOf(ImportAccessError);
  });

  it("previews products with the detected bank and suggestions", async () => {
    const id = await seedBatch();
    const preview = await previewPdfBatch(id, owner);
    expect(preview.bank).toBe("revolut");
    expect(preview.products.map((p) => p.key)).toEqual(["compte", "depot"]);
    expect(preview.products[0].preview[0].amount).toBe(30);
  });

  it("commits each product to its mapped account; an unmapped product is skipped", async () => {
    const id = await seedBatch();
    const summary = await commitPdfBatch(id, { compte: courantId }, { id: owner }); // depot unmapped → ignored
    expect(summary.importedRows).toBe(1);
    const courantRows = await db.transaction.findMany({ where: { accountId: courantId } });
    const depotRows = await db.transaction.findMany({ where: { accountId: depotId } });
    expect(courantRows).toHaveLength(1);
    expect(depotRows).toHaveLength(0);
    expect(decrypt(courantRows[0].rawLabelEnc, dataKey)).toContain("JOHN DOE");
  });

  it("maps both products to distinct accounts in one pass", async () => {
    const id = await seedBatch();
    const summary = await commitPdfBatch(id, { compte: courantId, depot: depotId }, { id: owner });
    expect(summary.importedRows).toBe(1); // courant row deduped (imported in the previous test); depot is new
    expect(summary.skippedRows).toBe(1);
    const depotRows = await db.transaction.findMany({ where: { accountId: depotId } });
    expect(depotRows).toHaveLength(1);
    expect(Number(depotRows[0].amount)).toBe(50);
  });

  it("rejects a mapping to an account the actor cannot write", async () => {
    const id = await seedBatch();
    await expect(commitPdfBatch(id, { compte: "nope" }, { id: owner })).rejects.toBeInstanceOf(
      ImportAccessError,
    );
  });

  it("flags duplicates against the account each product is mapped to", async () => {
    const own = [
      PRODUCTS[0],
      {
        key: "depot",
        rows: [{ date: "2025-03-10T00:00:00.000Z", amount: 7, rawLabel: "VERSEMENT DEDUP" }],
      },
    ];
    const id = await seedBatch(own);
    await commitPdfBatch(id, { depot: depotId }, { id: owner });
    const again = await seedBatch(own);
    const onUpload = await previewPdfBatch(again, owner);
    expect(onUpload.products[1].duplicateCount).toBe(0);
    const mapped = await previewPdfBatch(again, owner, { accounts: { depot: depotId } });
    expect(mapped.products[1].duplicateCount).toBe(1);
    expect(mapped.products[1].preview[0].isDuplicate).toBe(true);
    await expect(previewPdfBatch(id, owner)).rejects.toThrow("NOT_COMMITTABLE");
  });

  it("flags a probable duplicate per product and skips it unless ticked", async () => {
    const own = [
      {
        key: "compte",
        rows: [{ date: "2027-03-10T00:00:00.000Z", amount: -9, rawLabel: "CB PDF SHOP" }],
      },
      {
        key: "depot",
        rows: [
          { date: "2027-03-11T00:00:00.000Z", amount: 20, rawLabel: "VERSEMENT PROB" },
          { date: "2027-03-12T00:00:00.000Z", amount: 21, rawLabel: "VERSEMENT FRESH" },
        ],
      },
    ];
    await commitPdfBatch(
      await seedBatch(own),
      { compte: courantId, depot: depotId },
      { id: owner },
    );

    const again = [
      {
        key: "compte",
        rows: [{ date: "2027-03-10T00:00:00.000Z", amount: -9, rawLabel: "CB PDF SHOP 10/03" }],
      },
      {
        key: "depot",
        rows: [
          { date: "2027-03-11T00:00:00.000Z", amount: 20, rawLabel: "VERSEMENT PROB 11/03" },
          { date: "2027-03-13T00:00:00.000Z", amount: 22, rawLabel: "VERSEMENT NEW" },
        ],
      },
    ];
    const accounts = { compte: courantId, depot: depotId };
    const id = await seedBatch(again);
    const p = await previewPdfBatch(id, owner, { accounts });
    expect(p.products.map((x) => x.probableCount)).toEqual([1, 1]);
    expect(p.products[1].viewRows).toBe(2);
    expect(p.products[1].preview[0].probableOf).toBe("VERSEMENT PROB");

    const only = await previewPdfBatch(id, owner, { accounts, probableOnly: true });
    expect(only.products.map((x) => x.viewRows)).toEqual([1, 1]);
    expect(only.products[1].totalRows).toBe(2);
    expect(only.products[1].preview.map((r) => r.rawLabel)).toEqual(["VERSEMENT PROB 11/03"]);

    const summary = await commitPdfBatch(id, accounts, { id: owner });
    expect(summary.importedRows).toBe(1);
    expect(summary.skippedRows).toBe(2);
  });

  it("doesn't skip a row as probable because another product of the batch just inserted it", async () => {
    const same = { date: "2027-04-10T00:00:00.000Z", amount: -5 };
    const id = await seedBatch([
      { key: "compte", rows: [{ ...same, rawLabel: "CB PDF ALPHA" }] },
      { key: "depot", rows: [{ ...same, rawLabel: "CB PDF BETA" }] },
    ]);
    const summary = await commitPdfBatch(
      id,
      { compte: courantId, depot: courantId },
      { id: owner },
    );
    expect(summary.importedRows).toBe(2);
    expect(summary.skippedRows).toBe(0);
  });

  it("refuses a preview mapped to an account the actor cannot write", async () => {
    const foreign = await db.bankAccount.create({
      data: { ownerId: stranger, name: "Autre", type: "CHECKING" },
    });
    const id = await seedBatch();
    await expect(previewPdfBatch(id, owner, { accounts: { depot: foreign.id } })).rejects.toThrow(
      "FORBIDDEN",
    );
  });
});
