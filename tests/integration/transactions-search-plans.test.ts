import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { hmacForSearch } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";
import { searchQueryTerms } from "@/lib/text";
import type { TransactionSort } from "@/lib/transaction-filters";
import { createTransaction, listTransactions } from "@/server/services/transactions";
import { queryTransactionPage, type ListQuery } from "@/server/services/transactions/list-query";

const owner = "splan_owner";
const accounts: string[] = [];
let food = "";

const LABELS = [
  "Carrefour Market",
  "Carrefour City",
  "Cardif Assurance",
  "Monoprix Paris",
  "Paiement carte Monoprix",
  "Paiement carte Carrefour",
  "Gibert Joseph",
  "Salaire",
];

// The list before #297: Prisma's relation filter, one EXISTS per word.
async function prismaIds(q: ListQuery): Promise<string[]> {
  const order: Record<TransactionSort, Record<string, "asc" | "desc">[]> = {
    "date-desc": [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    "date-asc": [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    "amount-asc": [{ amount: "asc" }, { date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    "amount-desc": [{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  };
  const rows = await db.transaction.findMany({
    where: {
      accountId: { in: q.accountIds },
      ...(q.categoryIds === null ? { categoryId: null } : {}),
      ...(q.categoryIds ? { categoryId: { in: q.categoryIds } } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to ? { date: { gte: q.from, lte: q.to } } : {}),
      AND: [
        ...(q.direction ? [{ amount: q.direction === "in" ? { gt: 0 } : { lt: 0 } }] : []),
        ...(q.amountMin !== undefined
          ? [{ OR: [{ amount: { gte: q.amountMin } }, { amount: { lte: -q.amountMin } }] }]
          : []),
        ...(q.amountMax !== undefined ? [{ amount: { gte: -q.amountMax, lte: q.amountMax } }] : []),
        ...q.tokenHashes.map((tokenHash) => ({ searchTokens: { some: { tokenHash } } })),
      ],
    },
    orderBy: order[q.sort],
    take: q.take,
    skip: q.skip,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const hashes = (search: string) => searchQueryTerms(search).map((w) => hmacForSearch(w, searchKey));

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "splan-owner@bilan.local" } });
  for (const name of ["Courant", "Joint", "Livret"]) {
    const a = await db.bankAccount.create({ data: { ownerId: owner, name, type: "CHECKING" } });
    accounts.push(a.id);
  }
  food = (await db.category.create({ data: { userId: owner, name: "Courses" } })).id;
  // 3 accounts × 8 labels over 12 days: same-day rows across accounts exercise the merge.
  for (let i = 0; i < 48; i++) {
    const label = LABELS[i % LABELS.length];
    await createTransaction(
      {
        accountId: accounts[i % accounts.length],
        date: `2026-03-${String(1 + (i % 12)).padStart(2, "0")}`,
        amount: label === "Salaire" ? 2000 : -((i * 7) % 90) - 1,
        type: i % 5 === 0 ? "DIRECT_DEBIT" : "CARD",
        label,
        ...(i % 3 === 0 ? { categoryId: food } : {}),
      },
      { id: owner },
    );
  }
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("transaction search plans (#297)", () => {
  const cases: [string, Partial<ListQuery> & { search: string }][] = [
    ["a common prefix", { search: "car" }],
    ["one word", { search: "carrefour" }],
    ["several words", { search: "paiement carte monoprix" }],
    ["a word with no match", { search: "leclerc" }],
    ["oldest first", { search: "car", sort: "date-asc" }],
    ["by amount", { search: "car", sort: "amount-asc" }],
    ["a later page", { search: "car", take: 5, skip: 7 }],
    [
      "every filter",
      {
        search: "car",
        type: "CARD",
        direction: "out",
        amountMin: 10,
        amountMax: 80,
        from: new Date("2026-03-03"),
        to: new Date("2026-03-10T23:59:59Z"),
      },
    ],
    ["a category", { search: "car", categoryIds: [] as string[] }],
    ["uncategorized rows", { search: "car", categoryIds: null }],
    ["one account", { search: "car", accountIds: [] as string[] }],
  ];

  it.each(cases)("returns the same page as the Prisma filter for %s", async (_, c) => {
    const { search, ...rest } = c;
    const q: ListQuery = {
      accountIds: accounts,
      tokenHashes: hashes(search),
      sort: "date-desc",
      take: 10,
      skip: 0,
      ...rest,
    };
    if (q.categoryIds?.length === 0) q.categoryIds = [food];
    if (q.accountIds.length === 0) q.accountIds = [accounts[1]];
    const expected = await prismaIds(q);
    const byTokens = await queryTransactionPage(q, { commonTokenRows: Number.MAX_SAFE_INTEGER });
    const byAccount = await queryTransactionPage(q, { commonTokenRows: 0 });
    expect(byTokens.rows.map((r) => r.id)).toEqual(expected);
    expect(byAccount.rows.map((r) => r.id)).toEqual(expected);
    expect(byTokens.total).toBe(byAccount.total);
  });

  it("caps a search count but not a plain one", async () => {
    const q: ListQuery = {
      accountIds: accounts,
      tokenHashes: hashes("car"),
      sort: "date-desc",
      take: 10,
      skip: 0,
    };
    const all = await queryTransactionPage(q);
    expect(all).toMatchObject({ total: 30, capped: false });
    expect(await queryTransactionPage(q, { countCap: 30 })).toMatchObject({
      total: 30,
      capped: false,
    });
    expect(await queryTransactionPage(q, { countCap: 29 })).toMatchObject({
      total: 29,
      capped: true,
    });
    const plain = await queryTransactionPage({ ...q, tokenHashes: [] }, { countCap: 1 });
    expect(plain).toMatchObject({ total: 48, capped: false });
  });

  it("lists the search results decrypted, in the page order", async () => {
    const { items, total, capped } = await listTransactions(owner, { search: "monoprix", take: 4 });
    expect({ total, capped }).toEqual({ total: 12, capped: false });
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(["Monoprix Paris", "Paiement carte Monoprix"]),
    );
    expect(items[0]).toMatchObject({
      date: expect.any(Date),
      amount: expect.any(Number),
      manuallyCategorized: false,
      imported: false,
      accountName: expect.any(String),
    });
    const dates = items.map((i) => i.date.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});
