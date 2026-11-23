import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { commitCsvBatch, createCsvBatch, previewCsvBatch } from "@/server/services/imports";

vi.mock("@/server/services/links/auto", () => ({
  autoLinkTransfers: vi.fn().mockRejectedValue(new Error("boom")),
}));

const owner = "autolink_fail_owner";
let accountId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: `${owner}@bilan.local` } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("import with a failing auto-link", () => {
  it("still commits the batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const csv = "Date;Libellé;Débit;Crédit\n03/04/2026;CB BOULANGERIE;4,20;";
    const batch = await createCsvBatch({ accountId, filename: "a.csv", text: csv }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(1);
    const stored = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.status).toBe("COMPLETED");
  });
});
