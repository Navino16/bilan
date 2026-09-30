import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import {
  deleteTransactions,
  getDeleteImpact,
  MAX_DELETE_IDS,
} from "@/server/services/transactions/delete";
import { createLink } from "@/server/services/links";
import { insertRows, finalizeBatch } from "@/server/services/imports/commit";
import { revertImport } from "@/server/services/imports/revert";

const owner = "del_owner";
const other = "del_other";
let accA: string;
let accB: string; // owned by `other`, shared READ with `owner`
let groupId: string;
let budgetId: string;
let seq = 0;

const tx = async (label: string, accountId = accA, actor = owner) =>
  (
    await createTransaction(
      {
        accountId,
        date: `2026-05-${String((seq++ % 28) + 1).padStart(2, "0")}`,
        amount: -5,
        type: "CARD",
        label,
      },
      { id: actor },
    )
  ).id;

const assign = (transactionId: string) =>
  db.budgetAssignment.create({
    data: { budgetId, transactionId, mode: "INCLUDE", assignedById: owner },
  });

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.user.create({ data: { id: owner, email: "del-owner@bilan.local" } });
  await db.user.create({ data: { id: other, email: "del-other@bilan.local" } });
  accA = (await db.bankAccount.create({ data: { ownerId: owner, name: "A", type: "CHECKING" } }))
    .id;
  accB = (await db.bankAccount.create({ data: { ownerId: other, name: "B", type: "CHECKING" } }))
    .id;
  groupId = (await db.group.create({ data: { name: "Del", createdById: other } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: other, role: "OWNER" },
      { groupId, userId: owner, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId: accB, groupId, permission: "READ", createdById: other },
  });
  budgetId = (
    await db.budget.create({
      data: {
        name: "B",
        userId: owner,
        periodType: "MONTH",
        periodStart: new Date(Date.UTC(2026, 4, 1)),
        periodEnd: new Date(Date.UTC(2026, 4, 31)),
        createdById: owner,
      },
    })
  ).id;
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

describe("getDeleteImpact", () => {
  it("counts dissolved links, links left behind and budgeted rows", async () => {
    const small = await tx("Small");
    const large = await tx("Large");
    const budgeted = await tx("Budgeted");
    const plain = await tx("Plain");
    await createLink({ transactionIds: [small, await tx("Small peer")], userId: owner });
    await createLink({
      transactionIds: [large, await tx("Large peer one"), await tx("Large peer two")],
      userId: owner,
    });
    await assign(budgeted);

    expect(await getDeleteImpact(owner, [small, large, budgeted, plain])).toEqual({
      transactions: 4,
      dissolvedLinks: 1,
      leavingLink: 1,
      budgeted: 1,
    });
  });

  it("counts a link whose members are all deleted as dissolved, not left", async () => {
    const both = [await tx("Pair one"), await tx("Pair two")];
    await createLink({ transactionIds: both, userId: owner });
    expect(await getDeleteImpact(owner, both)).toMatchObject({ dissolvedLinks: 1, leavingLink: 0 });
  });

  it("applies the same guards as the deletion", async () => {
    const shared = await tx("Shared read", accB, other);
    await expect(getDeleteImpact(owner, [await tx("Mine"), shared])).rejects.toThrow("FORBIDDEN");
  });
});

describe("deleteTransactions", () => {
  it("deletes the rows and their dependents, dissolving undersized links only", async () => {
    const small = await tx("Gone small");
    const large = await tx("Gone large");
    const budgeted = await tx("Gone budgeted");
    const smallLink = await createLink({
      transactionIds: [small, await tx("Kept small peer")],
      userId: owner,
    });
    const largeLink = await createLink({
      transactionIds: [large, await tx("Kept large one"), await tx("Kept large two")],
      userId: owner,
    });
    await assign(budgeted);
    const ids = [small, large, budgeted];

    expect(await deleteTransactions(owner, ids)).toEqual({ deleted: 3, linksDissolved: 1 });
    expect(await db.transaction.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await db.transactionSearchToken.count({ where: { transactionId: { in: ids } } })).toBe(
      0,
    );
    expect(await db.budgetAssignment.count({ where: { transactionId: budgeted } })).toBe(0);
    expect(await db.transactionLink.findUnique({ where: { id: smallLink.id } })).toBeNull();
    expect(await db.transactionLinkMember.count({ where: { linkId: largeLink.id } })).toBe(2);
  });

  it("writes one audit event per deleted transaction, with its account", async () => {
    const ids = [await tx("Audit one"), await tx("Audit two")];
    await deleteTransactions(owner, ids);
    const events = await db.auditLog.findMany({
      where: { action: "transaction.deleted", entityId: { in: ids } },
    });
    expect(events.map((e) => e.entityId).sort()).toEqual([...ids].sort());
    expect(events.every((e) => e.userId === owner && e.entity === "Transaction")).toBe(true);
    expect(events.map((e) => e.metadata)).toEqual([{ accountId: accA }, { accountId: accA }]);
  });

  it("dissolves a link whose members are all deleted", async () => {
    const both = [await tx("All gone one"), await tx("All gone two")];
    const link = await createLink({ transactionIds: both, userId: owner });
    expect(await deleteTransactions(owner, both)).toEqual({ deleted: 2, linksDissolved: 1 });
    expect(await db.transactionLink.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it("runs overlapping deletions once, with a single audit per row", async () => {
    const ids = [await tx("Race one"), await tx("Race two")];
    const results = await Promise.allSettled([
      deleteTransactions(owner, ids),
      deleteTransactions(owner, ids),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.auditLog.count({ where: { action: "transaction.deleted", entityId: { in: ids } } }),
    ).toBe(2);
  });

  it("ignores duplicate ids", async () => {
    const id = await tx("Duplicate");
    expect(await deleteTransactions(owner, [id, id])).toEqual({ deleted: 1, linksDissolved: 0 });
  });

  it("deletes nothing when one row is on a read-only account", async () => {
    const mine = await tx("Mine kept");
    const shared = await tx("Shared kept", accB, other);
    await expect(deleteTransactions(owner, [mine, shared])).rejects.toThrow("FORBIDDEN");
    expect(await db.transaction.count({ where: { id: { in: [mine, shared] } } })).toBe(2);
  });

  it("refuses a row on an account the actor cannot see", async () => {
    const unshared = (
      await db.bankAccount.create({ data: { ownerId: other, name: "Hidden", type: "CHECKING" } })
    ).id;
    const hidden = await tx("Hidden row", unshared, other);
    await expect(deleteTransactions(owner, [hidden])).rejects.toThrow("FORBIDDEN");
    await db.transaction.deleteMany({ where: { accountId: unshared } });
    await db.bankAccount.delete({ where: { id: unshared } });
  });

  it("deletes nothing when one id does not exist", async () => {
    const mine = await tx("Mine still here");
    await expect(deleteTransactions(owner, [mine, "missing"])).rejects.toThrow("NOT_FOUND");
    expect(await db.transaction.count({ where: { id: mine } })).toBe(1);
  });

  it("rejects an empty or oversized selection", async () => {
    await expect(deleteTransactions(owner, [])).rejects.toThrow("INVALID");
    const tooMany = Array.from({ length: MAX_DELETE_IDS + 1 }, (_, i) => `id${i}`);
    await expect(deleteTransactions(owner, tooMany)).rejects.toThrow("INVALID");
  });

  it("leaves the rest of an imported batch revertable", async () => {
    const batch = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    const rows = ["IMP DEL ONE", "IMP DEL TWO"].map((rawLabel, i) => ({
      date: new Date(Date.UTC(2026, 4, i + 1)),
      amount: -10 - i,
      rawLabel,
    }));
    const r = await insertRows(
      { batchId: batch.id, accountId: accA },
      rows,
      { id: owner },
      {
        autoCategorize: false,
      },
    );
    await finalizeBatch(
      batch.id,
      { imported: r.imported, skipped: 0, total: r.total },
      {
        id: owner,
      },
      [accA],
    );
    const [first] = await db.transaction.findMany({ where: { importBatchId: batch.id } });

    await deleteTransactions(owner, [first.id]);
    expect((await revertImport(owner, batch.id)).deleted).toBe(1);
  });
});
