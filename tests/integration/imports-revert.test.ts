import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { insertRows, finalizeBatch } from "@/server/services/imports/commit";
import { createCsvBatch, previewCsvBatch, commitCsvBatch } from "@/server/services/imports";
import { commitPdfBatch } from "@/server/services/imports/pdf-service";
import {
  discardBatch,
  getRevertImpact,
  listRecentImports,
  purgeStaleImports,
  revertImport,
} from "@/server/services/imports/revert";
import { createLink } from "@/server/services/links";
import { createTransaction } from "@/server/services/transactions";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";

const owner = "rev_owner";
const other = "rev_other";
let accA: string;
let accC: string; // opening-balance restore tests
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
  const totals = { imported: 0, skipped: 0, total: 0, hitRuleIds: [] as string[] };
  for (const t of targets) {
    const rows = t.labels.map((rawLabel, i) => ({ date: d(i + 1), amount: -10 - i, rawLabel }));
    const r = await insertRows(
      { batchId: batch.id, accountId: t.accountId },
      rows,
      { id: actor },
      // Batches reuse the same days and amounts: tick them all so none is held as a probable duplicate.
      { autoCategorize: false, includedProbableIds: computeExternalIds(rows) },
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
  accC = (await db.bankAccount.create({ data: { ownerId: owner, name: "C", type: "CHECKING" } }))
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
  await db.transaction.deleteMany({ where: { accountId: { in: [accA, accB, accC] } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: [accA, accB, accC] } } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { id: { in: [accA, accB, accC] } } });
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
      balances: [],
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

    expect(await revertImport(owner, batchId)).toEqual({
      deleted: 2,
      linksDissolved: 1,
      balancesRestored: 0,
      balancesKept: 0,
    });
    expect(await db.transaction.count({ where: { importBatchId: batchId } })).toBe(0);
    expect(await db.transactionLink.findUnique({ where: { id: small.id } })).toBeNull();
    expect(await db.transactionLinkMember.count({ where: { linkId: large.id } })).toBe(2);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("REVERTED");
    expect(batch.importedRows).toBe(2);
    const audit = await db.auditLog.findFirst({
      where: { action: "import.reverted", entityId: batchId },
    });
    expect(audit?.metadata).toEqual({
      deleted: 2,
      linksDissolved: 1,
      balancesRestored: 0,
      balancesKept: 0,
    });
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

  it("takes back the rule hits credited by the reverted import", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Revert hits" } });
    const tag = `RH${Date.now()}`;
    const rule = await db.categorizationRule.create({
      data: { pattern: tag, matchType: "CONTAINS", categoryId: cat.id, userId: owner, hits: 5 },
    });
    const batch = await createCsvBatch(
      {
        accountId: accA,
        filename: "hits.csv",
        text: `Date;Libellé;Débit;Crédit\n01/06/2026;CB ${tag} A;1,00;\n02/06/2026;CB ${tag} B;2,00;`,
      },
      { id: owner },
    );
    const p = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, p.mapping, { id: owner });
    const hits = async () =>
      (await db.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).hits;
    expect(await hits()).toBe(7);
    await revertImport(owner, batch.id);
    expect(await hits()).toBe(5);
    await db.category.delete({ where: { id: cat.id } });
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
describe("discardBatch", () => {
  it("deletes an uncommitted batch and is a no-op once it is gone", async () => {
    const b = await db.importBatch.create({
      data: {
        accountId: accA,
        source: "CSV",
        status: "REVIEW",
        createdById: owner,
        metadata: { text: "raw" },
      },
    });
    await discardBatch(owner, b.id);
    expect(await db.importBatch.findUnique({ where: { id: b.id } })).toBeNull();
    await expect(discardBatch(owner, b.id)).resolves.toBeUndefined();
  });

  it("refuses a committed batch and a stranger", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["KEEP ONE"] }]);
    await expect(discardBatch(owner, batchId)).rejects.toThrow("NOT_DISCARDABLE");
    const b = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    await expect(discardBatch("nobody", b.id)).rejects.toThrow("FORBIDDEN");
  });
});

describe("purgeStaleImports", () => {
  it("deletes old uncommitted batches only", async () => {
    const old = new Date(Date.now() - 48 * 3600_000);
    const stale = await db.importBatch.create({
      data: {
        accountId: accA,
        source: "CSV",
        status: "PARSING",
        createdById: owner,
        createdAt: old,
      },
    });
    const fresh = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    const done = await committedBatch([{ accountId: accA, labels: ["OLD DONE"] }]);
    await db.importBatch.update({ where: { id: done }, data: { createdAt: old } });

    expect(await purgeStaleImports(new Date(Date.now() - 24 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect(await db.importBatch.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.importBatch.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.importBatch.findUnique({ where: { id: done } })).not.toBeNull();
  });
});

describe("listRecentImports", () => {
  it("lists committed and reverted batches of writable accounts, newest first", async () => {
    const kept = await committedBatch([{ accountId: accA, labels: ["HIST ONE"] }]);
    const undone = await committedBatch([{ accountId: accA, labels: ["HIST TWO"] }]);
    await revertImport(owner, undone);
    const foreign = await committedBatch([{ accountId: accB, labels: ["HIST B"] }], other);

    const items = await listRecentImports(owner);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(kept);
    expect(ids).toContain(undone);
    expect(ids).not.toContain(foreign); // B is READ-only for owner
    expect(items.find((i) => i.id === undone)?.status).toBe("REVERTED");
    expect(items.find((i) => i.id === kept)?.accountNames).toEqual(["A"]);
    expect(items.every((i) => i.status === "COMPLETED" || i.status === "REVERTED")).toBe(true);
    const times = items.map((i) => i.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe("commit claim", () => {
  it("lets only one of two concurrent commits run, with correct counters", async () => {
    const csv = `Date;Libellé;Débit;Crédit
11/05/2026;CB CLAIM ONE;4,00;
12/05/2026;CB CLAIM TWO;5,00;`;
    const batch = await createCsvBatch(
      { accountId: accA, filename: "claim.csv", text: csv },
      { id: owner },
    );
    const { mapping } = await previewCsvBatch(batch.id, owner);
    const results = await Promise.allSettled([
      commitCsvBatch(batch.id, mapping, { id: owner }),
      commitCsvBatch(batch.id, mapping, { id: owner }),
    ]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("NOT_COMMITTABLE");
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.importedRows).toBe(2);
    expect(await db.transaction.count({ where: { importBatchId: batch.id } })).toBe(2);
  });

  it("rolls back a commit that fails halfway, so a discard leaves no orphan rows", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Half" } });
    const rule = await db.categorizationRule.create({
      data: { pattern: "HALF", matchType: "CONTAINS", categoryId: cat.id, userId: owner },
    });
    const batch = await db.importBatch.create({
      data: {
        accountId: accA,
        source: "PDF",
        status: "REVIEW",
        createdById: owner,
        metadata: {
          products: [
            { key: "p1", rows: [{ date: d(3).toISOString(), amount: -7, rawLabel: "HALF ONE" }] },
            { key: "p2", rows: [{ date: d(4).toISOString(), amount: -8, rawLabel: "HALF TWO" }] },
          ],
        },
      },
    });
    // p2 targets B, read-only for owner: the commit fails after p1 was inserted.
    await expect(commitPdfBatch(batch.id, { p1: accA, p2: accB }, { id: owner })).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(await db.transaction.count({ where: { importBatchId: batch.id } })).toBe(0);
    expect(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({
      status: "REVIEW",
      importedRows: 0,
    });
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).hits).toBe(
      0,
    );
    const orphansBefore = await db.transaction.count({
      where: { accountId: accA, importBatchId: null },
    });
    await discardBatch(owner, batch.id);
    expect(await db.transaction.count({ where: { accountId: accA, importBatchId: null } })).toBe(
      orphansBefore,
    );
  });

  it("keeps a batch being committed out of reach of discard and purge", async () => {
    const committing = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "COMMITTING", createdById: owner },
    });
    await expect(discardBatch(owner, committing.id)).rejects.toThrow("NOT_DISCARDABLE");
    await purgeStaleImports(new Date(Date.now() - 24 * 3600_000));
    expect(await db.importBatch.findUnique({ where: { id: committing.id } })).not.toBeNull();
  });

  it("purges a batch stuck committing for over a day, with its rows", async () => {
    const old = new Date(Date.now() - 48 * 3600_000);
    const stuck = await db.importBatch.create({
      data: {
        accountId: accA,
        source: "CSV",
        status: "COMMITTING",
        createdById: owner,
        createdAt: old,
      },
    });
    await insertRows(
      { batchId: stuck.id, accountId: accA },
      [{ date: d(5), amount: -3, rawLabel: "STUCK ONE" }],
      { id: owner },
      { autoCategorize: false },
    );
    await purgeStaleImports(new Date(Date.now() - 24 * 3600_000));
    expect(await db.importBatch.findUnique({ where: { id: stuck.id } })).toBeNull();
    expect(
      await db.transaction.count({
        where: { accountId: accA, externalId: { not: null }, importBatchId: null },
      }),
    ).toBe(0);
  });
});

describe("opening balance on revert", () => {
  // A COMPLETED batch that adjusted accC's opening balance, as finalizeBatch records it.
  async function adjustedBatch(previous: number, set: number, current: string): Promise<string> {
    await db.bankAccount.update({ where: { id: accC }, data: { initialBalance: current } });
    const batch = await db.importBatch.create({
      data: {
        accountId: accC,
        source: "OFX",
        filename: "test.ofx",
        status: "COMPLETED",
        createdById: owner,
        completedAt: new Date(),
        metadata: {
          fileSizeBytes: 1,
          accountIds: [accC],
          balanceAdjustments: [{ accountId: accC, previous, set }],
        },
      },
    });
    return batch.id;
  }
  const balanceOfC = async () =>
    (await db.bankAccount.findUniqueOrThrow({ where: { id: accC } })).initialBalance.toString();

  it("getRevertImpact lists the balance change", async () => {
    const id = await adjustedBatch(100, 1234.56, "1234.56");
    expect((await getRevertImpact(owner, id)).balances).toEqual([
      { accountName: "C", previous: 100, set: 1234.56, restore: true },
    ]);
  });

  it("flags a balance edited since the import as not restorable", async () => {
    const id = await adjustedBatch(100, 1234.56, "999.00");
    expect((await getRevertImpact(owner, id)).balances[0]).toMatchObject({ restore: false });
  });

  it("restores the opening balance on revert", async () => {
    const id = await adjustedBatch(100, 1234.56, "1234.56");
    const res = await revertImport(owner, id);
    expect(res).toMatchObject({ balancesRestored: 1, balancesKept: 0 });
    expect(await balanceOfC()).toBe("100");
    const logged = await db.auditLog.findMany({
      where: { action: "account.initial_balance_restored", entityId: accC },
    });
    expect(logged).toHaveLength(1);
  });

  it("compares at cent precision (float artefact in the stored number)", async () => {
    const id = await adjustedBatch(0, 0.1 + 0.2, "0.30");
    expect((await getRevertImpact(owner, id)).balances[0].restore).toBe(true);
    expect(await revertImport(owner, id)).toMatchObject({ balancesRestored: 1, balancesKept: 0 });
    expect(await balanceOfC()).toBe("0");
  });

  it("keeps a hand-edited opening balance", async () => {
    const id = await adjustedBatch(100, 1234.56, "777.77");
    const res = await revertImport(owner, id);
    expect(res).toMatchObject({ balancesRestored: 0, balancesKept: 1 });
    expect(await balanceOfC()).toBe("777.77");
  });

  it("keeps the adjustments in the metadata once reverted", async () => {
    const id = await adjustedBatch(100, 1234.56, "1234.56");
    await revertImport(owner, id);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    expect((batch.metadata as { balanceAdjustments: unknown[] }).balanceAdjustments).toHaveLength(
      1,
    );
  });
});
