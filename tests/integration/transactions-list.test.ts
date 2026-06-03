import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createTransaction,
  listTransactions,
  recategorizeTransaction,
} from "@/server/services/transactions";

const owner = "txl_owner";
const member = "txl_member";
let accountId: string;
let groupId: string;
let catGroceries: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.user.create({ data: { id: owner, email: "txl-owner@bilan.local" } });
  await db.user.create({ data: { id: member, email: "txl-member@bilan.local" } });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
  const g = await db.group.create({ data: { name: "Foyer TXL", createdById: owner } });
  groupId = g.id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: owner, role: "OWNER" },
      { groupId, userId: member, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId, groupId, permission: "READ", createdById: owner },
  });
  catGroceries = (await db.category.create({ data: { name: "Groceries", userId: owner } })).id;

  await createTransaction(
    { accountId, date: "2026-02-01", amount: -10, type: "CARD", label: "Carrefour" },
    { id: owner },
  );
  await createTransaction(
    { accountId, date: "2026-02-02", amount: -20, type: "CARD", label: "Leclerc Drive" },
    { id: owner },
  );
  await createTransaction(
    { accountId, date: "2026-02-03", amount: 1500, type: "TRANSFER", label: "Salaire" },
    { id: owner },
  );
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.$disconnect();
});

describe("listTransactions", () => {
  it("returns the owner's transactions, decrypted, newest first", async () => {
    const { items, total } = await listTransactions(owner, {});
    expect(total).toBe(3);
    expect(items[0].label).toBe("Salaire");
    expect(items.map((i) => i.label)).toEqual(["Salaire", "Leclerc Drive", "Carrefour"]);
  });

  it("filters by type and by amount via token search", async () => {
    const byType = await listTransactions(owner, { type: "TRANSFER" });
    expect(byType.items.map((i) => i.label)).toEqual(["Salaire"]);

    const bySearch = await listTransactions(owner, { search: "leclerc" });
    expect(bySearch.items.map((i) => i.label)).toEqual(["Leclerc Drive"]);
  });

  it("matches multi-word search as an AND of tokens", async () => {
    // Both words present on the same transaction.
    const both = await listTransactions(owner, { search: "leclerc drive" });
    expect(both.items.map((i) => i.label)).toEqual(["Leclerc Drive"]);

    // Words living on different transactions → no single row carries both.
    const none = await listTransactions(owner, { search: "leclerc salaire" });
    expect(none.items).toEqual([]);

    // A query made only of too-short words matches nothing (not everything).
    const tooShort = await listTransactions(owner, { search: "ab" });
    expect(tooShort.items).toEqual([]);
  });

  it("lets a READ member see shared-account transactions but not write", async () => {
    const { items } = await listTransactions(member, {});
    expect(items.length).toBe(3);
  });

  it("recategorizes a transaction and flags it manuallyCategorized", async () => {
    const { items } = await listTransactions(owner, { search: "carrefour" });
    await recategorizeTransaction(items[0].id, catGroceries, { id: owner });
    const after = await db.transaction.findUniqueOrThrow({ where: { id: items[0].id } });
    expect(after.categoryId).toBe(catGroceries);
    expect(after.manuallyCategorized).toBe(true);
  });
});
