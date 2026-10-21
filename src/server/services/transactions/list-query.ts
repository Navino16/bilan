import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { TransactionSort } from "@/lib/transaction-filters";

// A search never counts past this: the list shows "1000+" instead of scanning every match.
export const SEARCH_COUNT_CAP = 1000;
// Token rows (instance-wide) above which a search word is common: walking each account
// newest-first and probing the token index then beats sorting every match (#297).
const COMMON_TOKEN_ROWS = 25_000;

export type ListQuery = {
  accountIds: string[];
  categoryIds?: string[] | null; // null selects uncategorized rows
  type?: string;
  direction?: "in" | "out";
  amountMin?: number;
  amountMax?: number;
  from?: Date;
  to?: Date;
  tokenHashes: string[]; // the row must carry every one
  sort: TransactionSort;
  take: number;
  skip: number;
};

export type ListTuning = { commonTokenRows?: number; countCap?: number };

const ORDER: Record<TransactionSort, string[]> = {
  "date-desc": ["date DESC", "createdAt DESC", "id DESC"],
  "date-asc": ["date ASC", "createdAt ASC", "id ASC"],
  "amount-asc": ["amount ASC", "date DESC", "createdAt DESC", "id DESC"],
  "amount-desc": ["amount DESC", "date DESC", "createdAt DESC", "id DESC"],
};

const orderBy = (sort: TransactionSort, alias: string) =>
  Prisma.raw(ORDER[sort].map((term) => `${alias}.${term}`).join(", "));

// Every filter but the account scope and the search, on alias `t`.
function filterConditions(q: ListQuery): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  if (q.categoryIds === null) conds.push(Prisma.sql`t.categoryId IS NULL`);
  else if (q.categoryIds) conds.push(Prisma.sql`t.categoryId IN (${Prisma.join(q.categoryIds)})`);
  if (q.type) conds.push(Prisma.sql`t.type = ${q.type}`);
  if (q.direction)
    conds.push(q.direction === "in" ? Prisma.sql`t.amount > 0` : Prisma.sql`t.amount < 0`);
  if (q.amountMin !== undefined) {
    conds.push(Prisma.sql`(t.amount >= ${q.amountMin} OR t.amount <= ${-q.amountMin})`);
  }
  if (q.amountMax !== undefined) {
    conds.push(Prisma.sql`t.amount >= ${-q.amountMax} AND t.amount <= ${q.amountMax}`);
  }
  if (q.from) conds.push(Prisma.sql`t.date >= ${q.from}`);
  if (q.to) conds.push(Prisma.sql`t.date <= ${q.to}`);
  return conds;
}

const tokenJoins = (hashes: string[]) =>
  hashes.length === 0
    ? Prisma.empty
    : Prisma.join(
        hashes.map((h, i) => {
          const s = Prisma.raw(`s${i}`);
          return Prisma.sql`JOIN TransactionSearchToken ${s} ON ${s}.tokenHash = ${h} AND ${s}.transactionId = t.id`;
        }),
        " ",
      );

const tokenExists = (hashes: string[]) =>
  hashes.map(
    (h) =>
      Prisma.sql`EXISTS (SELECT 1 FROM TransactionSearchToken s WHERE s.tokenHash = ${h} AND s.transactionId = t.id)`,
  );

async function allCommon(hashes: string[], threshold: number): Promise<boolean> {
  const counts = await Promise.all(
    hashes.map(
      (h) => db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (
          SELECT 1 FROM TransactionSearchToken WHERE tokenHash = ${h} LIMIT ${threshold + 1}
        ) c`,
    ),
  );
  return counts.every(([c]) => Number(c.n) > threshold);
}

export type ListRow = {
  id: string;
  accountId: string;
  date: Date;
  amount: Prisma.Decimal;
  type: string;
  labelEnc: string;
  rawLabelEnc: string;
  noteEnc: string | null;
  categoryId: string | null;
  manuallyCategorized: boolean | number; // tinyint(1) over raw SQL
  externalId: string | null;
};

const COLUMNS = Prisma.raw(
  "t.id, t.accountId, t.date, t.createdAt, t.amount, t.type, t.labelEnc, t.rawLabelEnc, " +
    "t.noteEnc, t.categoryId, t.manuallyCategorized, t.externalId",
);

// One page, in order. A rare search word drives the query from the token index. Otherwise a
// date sort takes each account's top rows from its (accountId, date, createdAt) index and
// merges them: a multi-account IN would sort every row (#300), a common word every match.
async function pageRows(q: ListQuery, tuning: ListTuning): Promise<ListRow[]> {
  const conds = filterConditions(q);
  const searching = q.tokenHashes.length > 0;
  const common =
    searching && (await allCommon(q.tokenHashes, tuning.commonTokenRows ?? COMMON_TOKEN_ROWS));
  if ((common || !searching) && q.sort.startsWith("date")) {
    const perAccount = (accountId: string) => {
      const where = Prisma.join(
        [Prisma.sql`t.accountId = ${accountId}`, ...conds, ...tokenExists(q.tokenHashes)],
        " AND ",
      );
      return Prisma.sql`(SELECT ${COLUMNS} FROM \`Transaction\` t WHERE ${where}
        ORDER BY ${orderBy(q.sort, "t")} LIMIT ${q.skip + q.take})`;
    };
    return db.$queryRaw<ListRow[]>`
      SELECT u.* FROM (${Prisma.join(q.accountIds.map(perAccount), " UNION ALL ")}) u
      ORDER BY ${orderBy(q.sort, "u")} LIMIT ${q.take} OFFSET ${q.skip}`;
  }
  const where = Prisma.join(
    [
      Prisma.sql`t.accountId IN (${Prisma.join(q.accountIds)})`,
      ...conds,
      ...(common ? tokenExists(q.tokenHashes) : []),
    ],
    " AND ",
  );
  return db.$queryRaw<ListRow[]>`
    SELECT ${COLUMNS} FROM \`Transaction\` t ${common ? Prisma.empty : tokenJoins(q.tokenHashes)}
    WHERE ${where} ORDER BY ${orderBy(q.sort, "t")} LIMIT ${q.take} OFFSET ${q.skip}`;
}

// A search count stops at the cap. The token joins can't duplicate a row: (tokenHash,
// transactionId) is unique.
async function countRows(
  q: ListQuery,
  tuning: ListTuning,
): Promise<{ total: number; capped: boolean }> {
  const where = Prisma.join(
    [Prisma.sql`t.accountId IN (${Prisma.join(q.accountIds)})`, ...filterConditions(q)],
    " AND ",
  );
  if (q.tokenHashes.length === 0) {
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM \`Transaction\` t WHERE ${where}`;
    return { total: Number(n), capped: false };
  }
  const cap = tuning.countCap ?? SEARCH_COUNT_CAP;
  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM \`Transaction\` t ${tokenJoins(q.tokenHashes)} WHERE ${where} LIMIT ${cap + 1}
    ) c`;
  return Number(n) > cap ? { total: cap, capped: true } : { total: Number(n), capped: false };
}

export async function queryTransactionPage(
  q: ListQuery,
  tuning: ListTuning = {},
): Promise<{ rows: ListRow[]; total: number; capped: boolean }> {
  const [rows, count] = await Promise.all([pageRows(q, tuning), countRows(q, tuning)]);
  return { rows, ...count };
}
