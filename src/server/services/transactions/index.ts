import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch, tokenize } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { UNCATEGORIZED } from "@/lib/transaction-filters";
import { logEvent } from "@/server/services/audit";
import { canWriteAccount, canReadAccount } from "@/server/services/accounts/sharing";
import { listVisibleForUser } from "@/server/services/accounts";
import {
  assertCategoryAssignable,
  CategoryAccessError,
  withDescendants,
} from "@/server/services/categories";
import {
  transactionInputSchema,
  type TransactionInput,
  type TransactionType,
} from "@/lib/validation/transaction";
import { buildSecureFields, computeExternalId } from "./secure-fields";

export class TransactionAccessError extends Error {}

// Rejects a categoryId the actor may not attach (forged id outside their own /
// group-visible categories), surfacing it as a transaction-level FORBIDDEN.
async function assertAssignableCategory(
  categoryId: string | null | undefined,
  actorId: string,
): Promise<void> {
  try {
    await assertCategoryAssignable(categoryId, actorId);
  } catch (e) {
    if (e instanceof CategoryAccessError) throw new TransactionAccessError("FORBIDDEN");
    throw e;
  }
}

export type TransactionView = {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  categoryId: string | null;
  manuallyCategorized: boolean;
};

// Creates a transaction the actor is allowed to write (owner or WRITE share),
// encrypting labels/note and writing per-word search tokens in one DB transaction.
// `categoryId` is taken verbatim (manual choice or import suggestion); auto-suggest
// is wired by callers in 3.3+. Pass `externalId` for imports (dedup); manual = none.
export async function createTransaction(
  input: TransactionInput,
  actor: { id: string },
  opts: { externalId?: string; manuallyCategorized?: boolean } = {},
): Promise<{ id: string }> {
  const data = transactionInputSchema.parse(input);
  if (!(await canWriteAccount(actor.id, data.accountId))) {
    throw new TransactionAccessError("FORBIDDEN");
  }
  await assertAssignableCategory(data.categoryId, actor.id);
  const rawLabel = data.rawLabel?.trim() ? data.rawLabel : data.label;
  const secure = buildSecureFields({ label: data.label, rawLabel, note: data.note });
  const externalId = opts.externalId ?? null; // manual entries have no externalId (no auto-dedup)

  const tx = await db.transaction.create({
    data: {
      accountId: data.accountId,
      date: data.date,
      amount: data.amount,
      type: data.type,
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      noteEnc: secure.noteEnc,
      categoryId: data.categoryId ?? null,
      manuallyCategorized: opts.manuallyCategorized ?? Boolean(data.categoryId),
      externalId,
      createdById: actor.id,
      searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
    },
  });
  await logEvent({
    userId: actor.id,
    action: "transaction.created",
    entity: "Transaction",
    entityId: tx.id,
  });
  return { id: tx.id };
}

// Decrypts a single transaction for a user who can read its account.
export async function getTransactionForUser(
  id: string,
  userId: string,
): Promise<TransactionView | null> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) return null;
  if (!(await canReadAccount(userId, row.accountId))) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    label: decrypt(row.labelEnc, dataKey),
    rawLabel: decrypt(row.rawLabelEnc, dataKey),
    note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
    categoryId: row.categoryId,
    manuallyCategorized: row.manuallyCategorized,
  };
}

export type TransactionListItem = TransactionView & { accountName: string };

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string; // UNCATEGORIZED selects rows with no category
  type?: TransactionType;
  direction?: "in" | "out"; // amount sign filter (Entrées / Sorties)
  from?: Date;
  to?: Date;
  search?: string; // single normalized word → token match
  take?: number;
  skip?: number;
};

// Lists transactions across every account visible to the user (owned + shared),
// decrypted, newest first. `search` matches one normalized word via the HMAC
// token index (no plaintext ever touches the query).
export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
): Promise<{ items: TransactionListItem[]; total: number }> {
  const visible = await listVisibleForUser(userId);
  const visibleIds = visible.map((a) => a.id);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const accountIds =
    filters.accountId && visibleIds.includes(filters.accountId) ? [filters.accountId] : visibleIds;
  if (accountIds.length === 0) return { items: [], total: 0 };

  const where: Record<string, unknown> = { accountId: { in: accountIds } };
  if (filters.categoryId === UNCATEGORIZED) {
    where.categoryId = null;
  } else if (filters.categoryId) {
    const subtree = (await withDescendants([filters.categoryId])).get(filters.categoryId)!;
    where.categoryId = { in: [...subtree] };
  }
  if (filters.type) where.type = filters.type;
  if (filters.direction) where.amount = filters.direction === "in" ? { gt: 0 } : { lt: 0 };
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  const query = filters.search?.trim();
  if (query) {
    // Multi-word AND: the row must carry a token for every normalized word in
    // the query (words < 3 chars are dropped — same rule as indexing). A query
    // made only of too-short words matches nothing rather than everything.
    const words = tokenize(query);
    if (words.length === 0) {
      where.id = "__no_searchable_word__";
    } else {
      where.AND = words.map((w) => ({
        searchTokens: { some: { tokenHash: hmacForSearch(w, searchKey) } },
      }));
    }
  }

  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: filters.take ?? 100,
      skip: filters.skip ?? 0,
    }),
    db.transaction.count({ where }),
  ]);

  const items: TransactionListItem[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    label: decrypt(row.labelEnc, dataKey),
    rawLabel: decrypt(row.rawLabelEnc, dataKey),
    note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
    categoryId: row.categoryId,
    manuallyCategorized: row.manuallyCategorized,
    accountName: accountName.get(row.accountId) ?? "",
  }));
  return { items, total };
}

// Sets a transaction's category (manual override). Requires WRITE on the account.
export async function recategorizeTransaction(
  id: string,
  categoryId: string | null,
  actor: { id: string },
): Promise<void> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) throw new TransactionAccessError("NOT_FOUND");
  if (!(await canWriteAccount(actor.id, row.accountId)))
    throw new TransactionAccessError("FORBIDDEN");
  await assertAssignableCategory(categoryId, actor.id);
  await db.transaction.update({
    where: { id },
    data: { categoryId, manuallyCategorized: true },
  });
  await logEvent({
    userId: actor.id,
    action: "transaction.recategorized",
    entity: "Transaction",
    entityId: id,
  });
}

export { computeExternalId };
