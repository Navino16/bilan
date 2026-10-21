import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { searchQueryTerms } from "@/lib/text";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { DEFAULT_SORT, UNCATEGORIZED, type TransactionSort } from "@/lib/transaction-filters";
import { editScope } from "@/lib/transaction-edit";
import { logEvent } from "@/server/services/audit";
import { canWriteAccount, canReadAccount } from "@/server/services/accounts/sharing";
import { isAccountArchived, visibleAccountRefs } from "@/server/services/accounts";
import {
  assertCategoryAssignable,
  CategoryAccessError,
  withDescendants,
} from "@/server/services/categories";
import {
  transactionInputSchema,
  transactionUpdateSchema,
  type TransactionInput,
  type TransactionType,
  type TransactionUpdateInput,
} from "@/lib/validation/transaction";
import { recordHits, suggest } from "@/server/services/categorization";
import { buildSecureFields } from "./secure-fields";

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
  imported: boolean; // carries a bank dedup key (see `editScope`)
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
  if (await isAccountArchived(data.accountId)) throw new TransactionAccessError("ACCOUNT_ARCHIVED");
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
      merchantKeyHash: secure.merchantKeyHash,
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
    imported: row.externalId !== null,
  };
}

export type TransactionListItem = TransactionView & { accountName: string };

export type TransactionFilters = {
  accountId?: string; // a non-visible id yields an empty list
  categoryId?: string; // UNCATEGORIZED selects rows with no category
  type?: TransactionType;
  direction?: "in" | "out"; // amount sign filter (Entrées / Sorties)
  amountMin?: number; // bounds on the absolute amount
  amountMax?: number;
  sort?: TransactionSort;
  from?: Date;
  to?: Date;
  search?: string; // single normalized word → token match
  take?: number;
  skip?: number;
};

const ORDER_BY: Record<TransactionSort, Record<string, "asc" | "desc">[]> = {
  "date-desc": [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  "date-asc": [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  "amount-asc": [{ amount: "asc" }, { date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  "amount-desc": [{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
};

// Lists transactions across every account visible to the user (owned + shared),
// decrypted, newest first. `search` matches one normalized word via the HMAC
// token index (no plaintext ever touches the query).
export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
): Promise<{ items: TransactionListItem[]; total: number }> {
  const visible = await visibleAccountRefs(userId);
  const visibleIds = visible.map((a) => a.id);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const accountIds = filters.accountId
    ? visibleIds.filter((id) => id === filters.accountId)
    : visibleIds;
  if (accountIds.length === 0) return { items: [], total: 0 };

  const where: Record<string, unknown> = { accountId: { in: accountIds } };
  const and: Record<string, unknown>[] = [];
  if (filters.categoryId === UNCATEGORIZED) {
    where.categoryId = null;
  } else if (filters.categoryId) {
    const subtree = (await withDescendants([filters.categoryId])).get(filters.categoryId)!;
    where.categoryId = { in: [...subtree] };
  }
  if (filters.type) where.type = filters.type;
  if (filters.direction) and.push({ amount: filters.direction === "in" ? { gt: 0 } : { lt: 0 } });
  if (filters.amountMin !== undefined) {
    const min = filters.amountMin;
    and.push({ OR: [{ amount: { gte: min } }, { amount: { lte: -min } }] });
  }
  if (filters.amountMax !== undefined) {
    and.push({ amount: { gte: -filters.amountMax, lte: filters.amountMax } });
  }
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  const query = filters.search?.trim();
  if (query) {
    // Multi-word AND: the row must carry a prefix token for every query word
    // (words < 3 chars are dropped, as at indexing). A query made only of
    // too-short words matches nothing rather than everything.
    const words = searchQueryTerms(query);
    if (words.length === 0) {
      where.id = "__no_searchable_word__";
    } else {
      for (const w of words) {
        and.push({ searchTokens: { some: { tokenHash: hmacForSearch(w, searchKey) } } });
      }
    }
  }
  if (and.length > 0) where.AND = and;

  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: ORDER_BY[filters.sort ?? DEFAULT_SORT],
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
    imported: row.externalId !== null,
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

// Edits a transaction (WRITE access). Only label/note when `editScope` says
// "text"; a manual row's raw label follows its label (it has no bank original).
export async function updateTransaction(
  id: string,
  input: TransactionUpdateInput,
  actor: { id: string },
): Promise<void> {
  const data = transactionUpdateSchema.parse(input);
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) throw new TransactionAccessError("NOT_FOUND");
  if (!(await canWriteAccount(actor.id, row.accountId)))
    throw new TransactionAccessError("FORBIDDEN");
  const imported = row.externalId !== null;
  const scope = editScope({ imported, archived: await isAccountArchived(row.accountId) });
  const touchesFigures =
    data.date !== undefined || data.amount !== undefined || data.type !== undefined;
  if (scope === "text" && touchesFigures) throw new TransactionAccessError("LOCKED_FIELDS");

  const oldLabel = decrypt(row.labelEnc, dataKey);
  const oldRaw = decrypt(row.rawLabelEnc, dataKey);
  const oldNote = row.noteEnc ? decrypt(row.noteEnc, dataKey) : null;
  const rawLabel = imported || oldRaw !== oldLabel ? oldRaw : data.label;
  const secure = buildSecureFields({ label: data.label, rawLabel, note: data.note });

  // Rules match the raw label (as on create/import): a rule-assigned category
  // follows it, including back to uncategorized when no rule matches any more.
  let recategorized: { categoryId: string | null; ruleId: string | null } | null = null;
  if (!row.manuallyCategorized && rawLabel !== oldRaw) {
    recategorized = await suggest(rawLabel, { userId: actor.id });
  }

  const fields = [
    data.label !== oldLabel && "label",
    data.note !== oldNote && "note",
    data.date && data.date.getTime() !== row.date.getTime() && "date",
    data.amount !== undefined && data.amount !== Number(row.amount) && "amount",
    data.type && data.type !== row.type && "type",
    recategorized && recategorized.categoryId !== row.categoryId && "category",
  ].filter((f): f is string => Boolean(f));

  await db.transaction.update({
    where: { id },
    data: {
      ...(data.date ? { date: data.date } : {}),
      ...(data.amount !== undefined ? { amount: data.amount } : {}),
      ...(data.type ? { type: data.type } : {}),
      ...(recategorized ? { categoryId: recategorized.categoryId } : {}),
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      merchantKeyHash: secure.merchantKeyHash,
      noteEnc: secure.noteEnc,
      searchTokens: {
        deleteMany: {},
        create: secure.tokens.map((tokenHash) => ({ tokenHash })),
      },
    },
  });
  await logEvent({
    userId: actor.id,
    action: "transaction.updated",
    entity: "Transaction",
    entityId: id,
    metadata: { fields },
  });
  // Best-effort, as on create: a failed counter must not fail a saved edit.
  if (recategorized) await recordHits([recategorized.ruleId]).catch(() => {});
}
