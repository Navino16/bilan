import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { syncAutoPeriodDates } from "@/server/services/transactions/period-date";
import {
  createTransaction,
  recategorizeTransaction,
  setTransactionMonth,
  TransactionAccessError,
  updateTransaction,
} from "@/server/services/transactions";
import { insertRows } from "@/server/services/imports/commit";
import { createRule } from "@/server/services/categorization";
import { applyRule } from "@/server/services/categorization/apply";
import { deleteGroup } from "@/server/services/groups";
import { eraseUser } from "@/server/services/rgpd";

const owner = "period_owner";
const stranger = "period_stranger";
let accountId: string;
let sal: string;
let plain: string;

async function insert(
  date: string,
  categoryId: string | null,
  extra: { periodDate?: string; periodManual?: boolean } = {},
): Promise<string> {
  const s = buildSecureFields({ label: "VIR SALAIRE", rawLabel: "VIR SALAIRE" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      ...(extra.periodDate ? { periodDate: new Date(extra.periodDate) } : {}),
      periodManual: extra.periodManual ?? false,
      amount: 2000,
      type: "TRANSFER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

async function periodDay(id: string): Promise<string> {
  const row = await db.transaction.findUniqueOrThrow({ where: { id } });
  return row.periodDate.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "period-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "period-stranger@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  sal = (await db.category.create({ data: { userId: owner, name: "Salaire", shiftDays: 5 } })).id;
  plain = (await db.category.create({ data: { userId: owner, name: "Divers" } })).id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.categorizationRule.deleteMany({ where: { userId: owner } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("periodDate column", () => {
  it("defaults to the transaction date", async () => {
    const id = await insert("2026-10-31T00:00:00.000Z", sal);
    expect(await periodDay(id)).toBe("2026-10-31");
  });
});

describe("syncAutoPeriodDates", () => {
  it("shifts the last N days of the month to the 1st of the next one", async () => {
    const cases: [string, string][] = [
      ["2026-10-31", "2026-11-01"],
      ["2026-10-27", "2026-11-01"],
      ["2026-10-26", "2026-10-26"],
      ["2027-02-24", "2027-03-01"],
      ["2027-02-23", "2027-02-23"],
      ["2026-12-30", "2027-01-01"],
    ];
    const ids = await Promise.all(cases.map(([day]) => insert(`${day}T00:00:00.000Z`, sal)));
    await syncAutoPeriodDates({ categoryIds: [sal] });
    for (const [i, [, expected]] of cases.entries()) {
      expect(await periodDay(ids[i])).toBe(expected);
    }
  });

  it("leaves a manual assignment alone", async () => {
    const id = await insert("2026-10-31T00:00:00.000Z", sal, {
      periodDate: "2026-10-31T00:00:00.000Z",
      periodManual: true,
    });
    await syncAutoPeriodDates({ ids: [id] });
    expect(await periodDay(id)).toBe("2026-10-31");
  });

  it("puts rows without the option back on their real date", async () => {
    const other = await insert("2026-10-31T00:00:00.000Z", plain, {
      periodDate: "2026-11-01T00:00:00.000Z",
    });
    const none = await insert("2026-10-31T00:00:00.000Z", null, {
      periodDate: "2026-11-01T00:00:00.000Z",
    });
    await syncAutoPeriodDates({ ids: [other, none] });
    expect(await periodDay(other)).toBe("2026-10-31");
    expect(await periodDay(none)).toBe("2026-10-31");
  });

  it("does nothing on an empty scope", async () => {
    expect(await syncAutoPeriodDates({ ids: [] })).toBe(0);
    expect(await syncAutoPeriodDates({ categoryIds: [] })).toBe(0);
  });
});

describe("transaction writes keep periodDate in sync", () => {
  const actor = { id: owner };
  const manualTx = (date: string, categoryId: string | null, label = "VIR") =>
    createTransaction(
      {
        accountId,
        date: new Date(date),
        amount: 2000,
        type: "TRANSFER",
        label,
        categoryId: categoryId ?? undefined,
      },
      actor,
    );

  it("shifts a created transaction", async () => {
    const { id } = await manualTx("2026-10-30T00:00:00.000Z", sal);
    expect(await periodDay(id)).toBe("2026-11-01");
  });

  it("follows a recategorization, back to the real date when uncategorized", async () => {
    const { id } = await manualTx("2026-10-30T00:00:00.000Z", plain);
    expect(await periodDay(id)).toBe("2026-10-30");
    await recategorizeTransaction(id, sal, actor);
    expect(await periodDay(id)).toBe("2026-11-01");
    await recategorizeTransaction(id, null, actor);
    expect(await periodDay(id)).toBe("2026-10-30");
  });

  it("lets a manual month win, and goes back to automatic", async () => {
    const { id } = await manualTx("2026-10-30T00:00:00.000Z", sal);
    await setTransactionMonth(id, { year: 2026, month: 10 }, actor);
    let row = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.periodManual).toBe(true);
    expect(await periodDay(id)).toBe("2026-10-30");

    await recategorizeTransaction(id, plain, actor);
    await recategorizeTransaction(id, sal, actor);
    expect(await periodDay(id)).toBe("2026-10-30");

    await setTransactionMonth(id, null, actor);
    row = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.periodManual).toBe(false);
    expect(await periodDay(id)).toBe("2026-11-01");
  });

  it("assigns a past month", async () => {
    const { id } = await manualTx("2026-01-15T00:00:00.000Z", null);
    await setTransactionMonth(id, { year: 2025, month: 12 }, actor);
    expect(await periodDay(id)).toBe("2025-12-01");
  });

  it("keeps a manual month across a date edit", async () => {
    const { id } = await manualTx("2026-10-20T00:00:00.000Z", null);
    await setTransactionMonth(id, { year: 2026, month: 11 }, actor);
    const edit = (date: string) =>
      updateTransaction(id, { label: "VIR", date, amount: 2000 }, actor);
    await edit("2026-11-12");
    expect(await periodDay(id)).toBe("2026-11-12");
    await edit("2026-10-05");
    expect(await periodDay(id)).toBe("2026-11-01");
  });

  it("re-evaluates the automatic shift on a date edit", async () => {
    const { id } = await manualTx("2026-10-10T00:00:00.000Z", sal);
    expect(await periodDay(id)).toBe("2026-10-10");
    await updateTransaction(id, { label: "VIR", date: "2026-10-30", amount: 2000 }, actor);
    expect(await periodDay(id)).toBe("2026-11-01");
  });

  it("refuses a month change without write access", async () => {
    const { id } = await manualTx("2026-10-10T00:00:00.000Z", null);
    await expect(
      setTransactionMonth(id, { year: 2026, month: 11 }, { id: stranger }),
    ).rejects.toBeInstanceOf(TransactionAccessError);
  });

  it("shifts imported rows categorized by a rule, and rows a rule re-applies to", async () => {
    const rule = await createRule(
      { pattern: "ACME PAIE", matchType: "CONTAINS", categoryId: sal },
      actor,
    );
    const { id: existing } = await manualTx("2026-09-29T00:00:00.000Z", null, "VIR ACME PAIE");
    await applyRule(rule.id, actor);
    expect(await periodDay(existing)).toBe("2026-10-01");

    const batch = await db.importBatch.create({
      data: { accountId, source: "CSV", status: "REVIEW", createdById: owner },
    });
    await insertRows(
      { batchId: batch.id, accountId },
      [{ date: new Date("2026-10-30T00:00:00.000Z"), amount: 2100, rawLabel: "VIR ACME PAIE OCT" }],
      actor,
    );
    const imported = await db.transaction.findFirstOrThrow({ where: { importBatchId: batch.id } });
    expect(imported.categoryId).toBe(sal);
    expect(await periodDay(imported.id)).toBe("2026-11-01");
  });
});

describe("cascaded category deletions put shifted rows back on their real date", () => {
  it("on household deletion", async () => {
    const group = await db.group.create({ data: { name: "Foyer Shift", createdById: owner } });
    await db.groupMember.create({ data: { groupId: group.id, userId: owner, role: "OWNER" } });
    const cat = await db.category.create({
      data: { groupId: group.id, name: "Paie foyer", shiftDays: 5 },
    });
    const id = await insert("2026-10-30T00:00:00.000Z", cat.id);
    await syncAutoPeriodDates({ ids: [id] });
    expect(await periodDay(id)).toBe("2026-11-01");

    await deleteGroup(group.id, { id: owner });
    expect(await periodDay(id)).toBe("2026-10-30");
  });

  it("on user erasure, for their categories on someone else's account", async () => {
    const erased = "period_erased";
    await db.user.deleteMany({ where: { id: erased } });
    await db.user.create({ data: { id: erased, email: "period-erased@bilan.local" } });
    const cat = await db.category.create({
      data: { userId: erased, name: "Paie partagée", shiftDays: 5 },
    });
    const id = await insert("2026-10-30T00:00:00.000Z", cat.id);
    await syncAutoPeriodDates({ ids: [id] });
    expect(await periodDay(id)).toBe("2026-11-01");

    await eraseUser(db, erased);
    expect(await periodDay(id)).toBe("2026-10-30");
  });
});
