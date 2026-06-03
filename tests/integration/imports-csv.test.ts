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
});
