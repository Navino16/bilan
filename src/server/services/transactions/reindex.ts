import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { buildSearchTokens } from "./secure-fields";

export type ReindexResult = { transactions: number; tokensBefore: number; tokensAfter: number };

type LabelRow = { id: string; labelEnc: string; labelHash: string; rawLabelEnc: string };
type Reindexed = { id: string; tokens: string[]; labelHash: string; rawLabelHash: string };

// Without rehash, a stored labelHash that doesn't match proves a wrong SEARCH_TOKEN_KEY, which
// would silently rebuild an index no query can hit. After a normalizeText change every row
// mismatches by design: rehash rewrites both equality hashes instead.
function reindexRow(row: LabelRow, rehash: boolean): Reindexed {
  const label = decrypt(row.labelEnc, dataKey);
  const rawLabel = decrypt(row.rawLabelEnc, dataKey);
  const labelHash = hmacForSearch(label, searchKey);
  if (!rehash && labelHash !== row.labelHash) {
    throw new Error(
      `labelHash mismatch on transaction ${row.id}: wrong SEARCH_TOKEN_KEY, or run with --rehash after a normalization change`,
    );
  }
  return {
    id: row.id,
    tokens: buildSearchTokens(label, rawLabel),
    labelHash,
    rawLabelHash: hmacForSearch(rawLabel, searchKey),
  };
}

async function rewriteHashes(tx: Prisma.TransactionClient, rows: Reindexed[]): Promise<void> {
  const caseOf = (pick: (r: Reindexed) => string) =>
    Prisma.join(
      rows.map((r) => Prisma.sql`WHEN ${r.id} THEN ${pick(r)}`),
      " ",
    );
  await tx.$executeRaw`
    UPDATE \`Transaction\`
    SET labelHash = CASE id ${caseOf((r) => r.labelHash)} END,
        rawLabelHash = CASE id ${caseOf((r) => r.rawLabelHash)} END
    WHERE id IN (${Prisma.join(rows.map((r) => r.id))})`;
}

// Rebuilds the TransactionSearchToken rows (#192) of every transaction, or of one account.
// Each batch is one DB transaction with its rows locked (FOR UPDATE), so a concurrent edit
// can't be overwritten with tokens derived from its previous labels.
export async function reindexSearchTokens(
  opts: {
    batchSize?: number;
    rehash?: boolean;
    accountId?: string;
    onProgress?: (p: { done: number; total: number }) => void;
  } = {},
): Promise<ReindexResult> {
  const batchSize = opts.batchSize ?? 500;
  const rehash = opts.rehash ?? false;
  const scope = opts.accountId ? Prisma.sql`AND accountId = ${opts.accountId}` : Prisma.empty;
  const countTokens = () =>
    db.transactionSearchToken.count({
      where: opts.accountId ? { transaction: { accountId: opts.accountId } } : {},
    });
  const [total, tokensBefore] = await Promise.all([
    db.transaction.count({ where: opts.accountId ? { accountId: opts.accountId } : {} }),
    countTokens(),
  ]);

  let cursor = "";
  let done = 0;
  for (;;) {
    const ids = await db.$transaction(async (tx) => {
      const batch = await tx.$queryRaw<LabelRow[]>`
        SELECT id, labelEnc, labelHash, rawLabelEnc FROM \`Transaction\`
        WHERE id > ${cursor} ${scope} ORDER BY id LIMIT ${batchSize} FOR UPDATE`;
      if (batch.length === 0) return [];
      const rows = batch.map((r) => reindexRow(r, rehash));
      await tx.transactionSearchToken.deleteMany({
        where: { transactionId: { in: rows.map((r) => r.id) } },
      });
      await tx.transactionSearchToken.createMany({
        data: rows.flatMap((r) =>
          r.tokens.map((tokenHash) => ({ transactionId: r.id, tokenHash })),
        ),
      });
      if (rehash) await rewriteHashes(tx, rows);
      return rows.map((r) => r.id);
    }, LONG_TX_TIMEOUT);
    if (ids.length === 0) break;
    cursor = ids[ids.length - 1];
    done += ids.length;
    opts.onProgress?.({ done, total });
  }

  return { transactions: done, tokensBefore, tokensAfter: await countTokens() };
}
