import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { previewPdfBatch, commitPdfBatch, ImportAccessError } from "@/server/services/imports";

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

async function seedBatch(): Promise<string> {
  const b = await db.importBatch.create({
    data: {
      accountId: courantId,
      source: "PDF",
      filename: "revolut.pdf",
      status: "REVIEW",
      createdById: owner,
      metadata: { bank: "revolut", products: PRODUCTS } as never,
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
});
