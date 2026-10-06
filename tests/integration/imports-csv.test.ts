import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import {
  createCsvBatch,
  previewCsvBatch,
  commitCsvBatch,
  ImportAccessError,
} from "@/server/services/imports";

const owner = "imp_owner";
const stranger = "imp_stranger";
let accountId: string;

const CSV = `Date;Libellé;Débit;Crédit
05/03/2026;CB CARREFOUR CITY;82,37;
06/03/2026;VIR SEPA SALAIRE;;2450,00`;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "imp-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "imp-stranger@bilan.local" } });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("CSV import pipeline", () => {
  it("rejects creating a batch on an account the actor cannot write", async () => {
    await expect(
      createCsvBatch({ accountId, filename: "x.csv", text: CSV }, { id: stranger }),
    ).rejects.toBeInstanceOf(ImportAccessError);
  });

  it("previews with a detected mapping and per-row suggestions", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.totalRows).toBe(2);
    expect(preview.mapping.date).toBe("Date");
    expect(preview.mapping.debit).toBe("Débit");
    expect(preview.preview[0].amount).toBe(-82.37);
    expect(preview.preview[1].amount).toBe(2450);
  });

  it("commits rows: encrypts labels, writes tokens, sets counters and status", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march2.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(2);
    expect(summary.skippedRows).toBe(0);

    const rows = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      include: { searchTokens: true },
    });
    expect(rows).toHaveLength(2);
    const carrefour = rows.find((r) => decrypt(r.rawLabelEnc, dataKey).includes("CARREFOUR"))!;
    expect(carrefour.rawLabelEnc).not.toContain("CARREFOUR");
    expect(carrefour.searchTokens.length).toBeGreaterThan(0);
    expect(Number(carrefour.amount)).toBe(-82.37);

    const updated = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.importedRows).toBe(2);
  });

  it("dedups a re-import of the same file: 0 imported, all skipped", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march3.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(0);
    expect(summary.skippedRows).toBe(2);
  });

  it("honours per-row edits: category override + excluded row", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Courses" } });
    const csv = `Date;Libellé;Débit;Crédit
10/04/2026;CB EDIT KEEP;11,11;
11/04/2026;CB EDIT DROP;22,22;`;
    const batch = await createCsvBatch(
      { accountId, filename: "edit.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const keep = preview.preview.find((r) => r.rawLabel === "CB EDIT KEEP")!;
    const drop = preview.preview.find((r) => r.rawLabel === "CB EDIT DROP")!;

    const summary = await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      { overrides: { [keep.externalId]: cat.id }, excludedIds: [drop.externalId] },
    );
    expect(summary.importedRows).toBe(1);

    const rows = await db.transaction.findMany({ where: { importBatchId: batch.id } });
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].rawLabelEnc, dataKey)).toBe("CB EDIT KEEP");
    expect(rows[0].categoryId).toBe(cat.id);
    expect(rows[0].manuallyCategorized).toBe(true);
  });

  it("drops an override category the actor does not own (IDOR guard)", async () => {
    const foreign = await db.category.create({ data: { userId: stranger, name: "Stranger cat" } });
    const csv = `Date;Libellé;Débit;Crédit\n12/04/2026;CB IDOR ${Date.now()};5,00;`;
    const batch = await createCsvBatch(
      { accountId, filename: "idor.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const row = preview.preview[0];

    await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      { autoCategorize: false, overrides: { [row.externalId]: foreign.id } },
    );
    const tx = await db.transaction.findFirstOrThrow({ where: { importBatchId: batch.id } });
    expect(tx.categoryId).toBeNull(); // foreign category dropped
    expect(tx.manuallyCategorized).toBe(false);
  });

  it("counts a hit on the matched rule for each auto-categorized imported row", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Hits" } });
    const tag = `H${Date.now()}`;
    const hit = await db.categorizationRule.create({
      data: { pattern: `${tag}MATCH`, matchType: "CONTAINS", categoryId: cat.id, userId: owner },
    });
    const idle = await db.categorizationRule.create({
      data: { pattern: `${tag}IDLE`, matchType: "CONTAINS", categoryId: cat.id, userId: owner },
    });
    const csv = `Date;Libellé;Débit;Crédit
01/05/2026;CB ${tag}MATCH ONE;1,00;
02/05/2026;CB ${tag}MATCH TWO;2,00;
03/05/2026;CB ${tag}MATCH FORCED;3,00;
04/05/2026;CB ${tag}MATCH DROPPED;4,00;
06/05/2026;CB ${tag}MATCH CLEARED;6,00;
05/05/2026;CB OTHER ${tag};5,00;`;
    const batch = await createCsvBatch(
      { accountId, filename: "hits.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id: hit.id } })).hits).toBe(0);

    const byLabel = (l: string) => preview.preview.find((r) => r.rawLabel.includes(l))!.externalId;
    await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      {
        overrides: { [byLabel("FORCED")]: cat.id, [byLabel("CLEARED")]: "" },
        excludedIds: [byLabel("DROPPED")],
      },
    );
    const hits = async (id: string) =>
      (await db.categorizationRule.findUniqueOrThrow({ where: { id } })).hits;
    expect(await hits(hit.id)).toBe(2);
    expect(await hits(idle.id)).toBe(0);
    const cleared = await db.transaction.findMany({ where: { importBatchId: batch.id } });
    const clearedRow = cleared.find((r) => decrypt(r.rawLabelEnc, dataKey).includes("CLEARED"))!;
    expect(clearedRow.categoryId).toBeNull();
    expect(clearedRow.manuallyCategorized).toBe(true);

    // Re-import: duplicates add nothing, only the previously excluded row counts.
    const again = await createCsvBatch(
      { accountId, filename: "hits2.csv", text: csv },
      { id: owner },
    );
    const p2 = await previewCsvBatch(again.id, owner);
    await commitCsvBatch(again.id, p2.mapping, { id: owner });
    expect(await hits(hit.id)).toBe(3);

    const off = await createCsvBatch(
      {
        accountId,
        filename: "hits3.csv",
        text: `Date;Libellé;Débit;Crédit\n07/05/2026;CB ${tag}MATCH OFF;7,00;`,
      },
      { id: owner },
    );
    const p3 = await previewCsvBatch(off.id, owner);
    await commitCsvBatch(off.id, p3.mapping, { id: owner }, { autoCategorize: false });
    expect(await hits(hit.id)).toBe(3);
  });

  it("trims the raw CSV text from metadata once committed", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "trim.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.metadata).toEqual({
      fileSizeBytes: Buffer.byteLength(CSV),
      accountIds: [accountId],
    });
  });

  it("refuses to commit a batch twice", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "twice.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    await expect(commitCsvBatch(batch.id, preview.mapping, { id: owner })).rejects.toThrow(
      "NOT_COMMITTABLE",
    );
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.status).toBe("COMPLETED");
  });
});
