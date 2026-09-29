import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { insertRows, finalizeBatch } from "@/server/services/imports/commit";
import { getRevertImpact, revertImport } from "@/server/services/imports/revert";
import { createLink } from "@/server/services/links";
import { createTransaction } from "@/server/services/transactions";

const owner = "rev_owner";
const other = "rev_other";
let accA: string;
let accB: string; // owned by `other`, shared READ with `owner`
let groupId: string;

const d = (day: number) => new Date(Date.UTC(2026, 4, day));

async function committedBatch(
  targets: { accountId: string; labels: string[] }[],
  actor = owner,
): Promise<string> {
  const batch = await db.importBatch.create({
    data: {
      accountId: targets[0].accountId,
      source: "PDF",
      filename: "test.pdf",
      status: "REVIEW",
      createdById: actor,
      metadata: { products: [], fileSizeBytes: 1 },
    },
  });
  const totals = { imported: 0, skipped: 0, total: 0 };
  for (const t of targets) {
    const rows = t.labels.map((rawLabel, i) => ({ date: d(i + 1), amount: -10 - i, rawLabel }));
    const r = await insertRows(
      { batchId: batch.id, accountId: t.accountId },
      rows,
      { id: actor },
      {
        autoCategorize: false,
      },
    );
    totals.imported += r.imported;
    totals.total += r.total;
  }
  await finalizeBatch(
    batch.id,
    totals,
    { id: actor },
    targets.map((t) => t.accountId),
  );
  return batch.id;
}

const manual = async (day: number, label: string) =>
  (
    await createTransaction(
      {
        accountId: accA,
        date: `2026-05-${String(day).padStart(2, "0")}`,
        amount: 5,
        type: "CARD",
        label,
      },
      { id: owner },
    )
  ).id;

const txIds = async (batchId: string) =>
  (await db.transaction.findMany({ where: { importBatchId: batchId }, select: { id: true } })).map(
    (t) => t.id,
  );

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.user.create({ data: { id: owner, email: "rev-owner@bilan.local" } });
  await db.user.create({ data: { id: other, email: "rev-other@bilan.local" } });
  accA = (await db.bankAccount.create({ data: { ownerId: owner, name: "A", type: "CHECKING" } }))
    .id;
  accB = (await db.bankAccount.create({ data: { ownerId: other, name: "B", type: "CHECKING" } }))
    .id;
  groupId = (await db.group.create({ data: { name: "Rev", createdById: other } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: other, role: "OWNER" },
      { groupId, userId: owner, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId: accB, groupId, permission: "READ", createdById: other },
  });
});

afterAll(async () => {
  await db.transactionLink.deleteMany({ where: { createdById: { in: [owner, other] } } });
  await db.budget.deleteMany({ where: { userId: owner } });
  await db.transaction.deleteMany({ where: { accountId: { in: [accA, accB] } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: [accA, accB] } } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { id: { in: [accA, accB] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.$disconnect();
});

describe("revertImport", () => {
  it("reports the impact: linked, budgeted and edited rows", async () => {
    const batchId = await committedBatch([
      { accountId: accA, labels: ["IMP ONE", "IMP TWO", "IMP THREE"] },
    ]);
    const [t1, t2, t3] = await txIds(batchId);
    await createLink({ transactionIds: [t1, await manual(9, "Outside")], userId: owner });
    const budget = await db.budget.create({
      data: {
        name: "B",
        userId: owner,
        periodType: "MONTH",
        periodStart: d(1),
        periodEnd: d(31),
        createdById: owner,
      },
    });
    await db.budgetAssignment.create({
      data: { budgetId: budget.id, transactionId: t2, mode: "INCLUDE", assignedById: owner },
    });
    await db.transaction.update({ where: { id: t3 }, data: { manuallyCategorized: true } });

    expect(await getRevertImpact(owner, batchId)).toEqual({
      transactions: 3,
      linked: 1,
      budgeted: 1,
      edited: 1,
    });
  });

  it("deletes the rows, dissolves a link left with one member, keeps a larger one", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["LNK ONE", "LNK TWO"] }]);
    const [t1, t2] = await txIds(batchId);
    const small = await createLink({
      transactionIds: [t1, await manual(20, "Small")],
      userId: owner,
    });
    const large = await createLink({
      transactionIds: [t2, await manual(21, "Large one"), await manual(22, "Large two")],
      userId: owner,
    });

    expect(await revertImport(owner, batchId)).toEqual({ deleted: 2, linksDissolved: 1 });
    expect(await db.transaction.count({ where: { importBatchId: batchId } })).toBe(0);
    expect(await db.transactionLink.findUnique({ where: { id: small.id } })).toBeNull();
    expect(await db.transactionLinkMember.count({ where: { linkId: large.id } })).toBe(2);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("REVERTED");
    expect(batch.importedRows).toBe(2);
    const audit = await db.auditLog.findFirst({
      where: { action: "import.reverted", entityId: batchId },
    });
    expect(audit?.metadata).toEqual({ deleted: 2, linksDissolved: 1 });
  });

  it("dissolves a link whose members were all in the batch", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["ALL ONE", "ALL TWO"] }]);
    const link = await createLink({ transactionIds: await txIds(batchId), userId: owner });
    expect((await revertImport(owner, batchId)).linksDissolved).toBe(1);
    expect(await db.transactionLink.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it("lets the same rows be imported again afterwards", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["AGAIN ONE"] }]);
    await revertImport(owner, batchId);
    const again = await committedBatch([{ accountId: accA, labels: ["AGAIN ONE"] }]);
    expect(await db.transaction.count({ where: { importBatchId: again } })).toBe(1);
  });

  it("refuses a second revert, and a batch that is not completed", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["TWICE ONE"] }]);
    await revertImport(owner, batchId);
    await expect(revertImport(owner, batchId)).rejects.toThrow("NOT_REVERTIBLE");
    const review = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    await expect(revertImport(owner, review.id)).rejects.toThrow("NOT_REVERTIBLE");
  });

  it("runs concurrent reverts once", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["RACE ONE", "RACE TWO"] }]);
    const results = await Promise.allSettled([
      revertImport(owner, batchId),
      revertImport(owner, batchId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("refuses the whole revert when one account of the batch is not writable", async () => {
    await db.accountShare.create({
      data: { accountId: accA, groupId, permission: "WRITE", createdById: owner },
    });
    // B is READ-only for owner: the revert must not touch A's rows either.
    const batchId = await committedBatch(
      [
        { accountId: accB, labels: ["PDF B"] },
        { accountId: accA, labels: ["PDF A"] },
      ],
      other,
    );
    await expect(revertImport(owner, batchId)).rejects.toThrow("FORBIDDEN");
    expect(await db.transaction.count({ where: { importBatchId: batchId } })).toBe(2);
  });
});
