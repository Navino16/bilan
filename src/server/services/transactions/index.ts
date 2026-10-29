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
import { type TransactionType } from "@/lib/validation/transaction";
import {
  transactionInputSchema,
  transactionUpdateSchema,
  type TransactionInput,
  type TransactionUpdateInput,
} from "@/lib/schemas/transaction";
import { recordHits, suggest } from "@/server/services/categorization";
import { manualPeriodDate, type YearMonth } from "@/lib/assigned-month";
import { buildSecureFields } from "./secure-fields";
import { syncAutoPeriodDates } from "./period-date";
import { autoLinkTransfers } from "@/server/services/links/auto";
import { linkedTransferLegs, setManualMonth } from "@/server/services/links/month";
import {
  EXPORT_COLUMNS,
  pageRows,
  queryTransactionPage,
  type ExportRow,
  type ListQuery,
  type ListRow,
} from "./list-query";

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
  periodDate: Date;
  periodManual: boolean;
  imported: boolean; // carries a bank dedup key (see `editScope`)
};

async function autoLinkAround(accountId: string, date: Date): Promise<void> {
  try {
    const { ownerId } = await db.bankAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { ownerId: true },
    });
    await autoLinkTransfers(ownerId, { from: date, to: date });
  } catch (e) {
    console.error("auto-link after manual entry failed", e);
  }
}

// Creates a transaction the actor is allowed to write (owner or WRITE share),
// encrypting labels/note and writing per-word search tokens in one DB transaction.
// `categoryId` is taken verbatim (manual choice or import suggestion); auto-suggest
// is wired by callers in 3.3+. Pass `externalId` for imports (dedup); manual = none.
export async function createTransaction(
  input: TransactionInput,
  actor: { id: string },
  opts: { externalId?: string; manuallyCategorized?: boolean; autoLink?: boolean } = {},
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
  if (tx.categoryId) await syncAutoPeriodDates({ ids: [tx.id] });
  await logEvent({
    userId: actor.id,
    action: "transaction.created",
    entity: "Transaction",
    entityId: tx.id,
  });
  // Best-effort: a failed link must not report a saved transaction as failed.
  if (opts.autoLink) await autoLinkAround(data.accountId, data.date);
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
    periodDate: row.periodDate,
    periodManual: row.periodManual,
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
  search?: string; // every word must match a token prefix
  take?: number;
  skip?: number;
};

// Lists transactions across every account visible to the user (owned + shared),
// decrypted, newest first. `search` matches normalized word prefixes via the HMAC
// token index (no plaintext ever touches the query); its count is capped (`capped`).
export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
): Promise<{ items: TransactionListItem[]; total: number; capped: boolean }> {
  const resolved = await resolveListQuery(userId, filters);
  if (!resolved) return { items: [], total: 0, capped: false };
  const { rows, total, capped } = await queryTransactionPage(resolved.query);
  return { items: rows.map(resolved.toItem), total, capped };
}

export type ExportItem = Pick<
  TransactionListItem,
  "id" | "date" | "periodDate" | "amount" | "type" | "label" | "accountName" | "categoryId"
>;

// Every row matching `filters`, newest first, page by page: keyset pagination, no count and
// only the exported columns, so an export's memory and time stay bounded (#301).
export async function* transactionPages(
  userId: string,
  filters: Omit<TransactionFilters, "sort" | "take" | "skip">,
  pageSize = 5000,
): AsyncGenerator<ExportItem[]> {
  const resolved = await resolveListQuery(userId, { ...filters, sort: "date-desc" });
  if (!resolved) return;
  let after: ExportRow | undefined;
  for (;;) {
    const rows = await pageRows<ExportRow>(
      { ...resolved.query, take: pageSize, skip: 0, after },
      {},
      EXPORT_COLUMNS,
    );
    if (rows.length > 0) {
      yield rows.map((r) => ({
        id: r.id,
        date: r.date,
        periodDate: r.periodDate,
        amount: Number(r.amount),
        type: r.type,
        label: decrypt(r.labelEnc, dataKey),
        accountName: resolved.accountName.get(r.accountId) ?? "",
        categoryId: r.categoryId,
      }));
    }
    if (rows.length < pageSize) return;
    after = rows[rows.length - 1];
  }
}

async function resolveListQuery(
  userId: string,
  filters: TransactionFilters,
): Promise<{
  query: ListQuery;
  accountName: Map<string, string>;
  toItem: (row: ListRow) => TransactionListItem;
} | null> {
  const visible = await visibleAccountRefs(userId);
  const visibleIds = visible.map((a) => a.id);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const accountIds = filters.accountId
    ? visibleIds.filter((id) => id === filters.accountId)
    : visibleIds;
  if (accountIds.length === 0) return null;

  let categoryIds: string[] | null | undefined;
  if (filters.categoryId === UNCATEGORIZED) {
    categoryIds = null;
  } else if (filters.categoryId) {
    categoryIds = [...(await withDescendants([filters.categoryId])).get(filters.categoryId)!];
  }
  // Multi-word AND: the row must carry a prefix token for every query word
  // (words < 3 chars are dropped, as at indexing). A query made only of
  // too-short words matches nothing rather than everything.
  const query = filters.search?.trim();
  const words = query ? searchQueryTerms(query) : [];
  if (query && words.length === 0) return null;

  return {
    accountName,
    query: {
      accountIds,
      categoryIds,
      type: filters.type,
      direction: filters.direction,
      amountMin: filters.amountMin,
      amountMax: filters.amountMax,
      from: filters.from,
      to: filters.to,
      tokenHashes: words.map((w) => hmacForSearch(w, searchKey)),
      sort: filters.sort ?? DEFAULT_SORT,
      take: filters.take ?? 100,
      skip: filters.skip ?? 0,
    },
    toItem: (row) => ({
      id: row.id,
      accountId: row.accountId,
      date: row.date,
      amount: Number(row.amount),
      type: row.type,
      label: decrypt(row.labelEnc, dataKey),
      rawLabel: decrypt(row.rawLabelEnc, dataKey),
      note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
      categoryId: row.categoryId,
      manuallyCategorized: Boolean(row.manuallyCategorized),
      periodDate: row.periodDate,
      periodManual: Boolean(row.periodManual),
      imported: row.externalId !== null,
      accountName: accountName.get(row.accountId) ?? "",
    }),
  };
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
  await syncAutoPeriodDates({ ids: [id] });
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

  const redated = data.date !== undefined && data.date.getTime() !== row.date.getTime();
  // A manual month survives a date edit; landing inside it pins the new date (spec, #341).
  const manualPeriod =
    redated && row.periodManual
      ? {
          periodDate: manualPeriodDate(
            data.date!,
            row.periodDate.getUTCFullYear(),
            row.periodDate.getUTCMonth() + 1,
          ),
        }
      : {};

  await db.transaction.update({
    where: { id },
    data: {
      ...(data.date ? { date: data.date } : {}),
      ...manualPeriod,
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
  if (redated || recategorized) await syncAutoPeriodDates({ ids: [id] });
  // Best-effort, as on create: a failed counter must not fail a saved edit.
  if (recategorized) await recordHits([recategorized.ruleId]).catch(() => {});
}

// Assigns a transaction to a month by hand (#341), or back to the automatic one with `null`.
export async function setTransactionMonth(
  id: string,
  month: YearMonth | null,
  actor: { id: string },
): Promise<void> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) throw new TransactionAccessError("NOT_FOUND");
  if (!(await canWriteAccount(actor.id, row.accountId)))
    throw new TransactionAccessError("FORBIDDEN");
  const rows = [row, ...(await linkedTransferLegs(id, actor.id))];
  const ids = rows.map((r) => r.id);
  if (month) {
    await setManualMonth(rows, month);
  } else {
    await db.transaction.updateMany({ where: { id: { in: ids } }, data: { periodManual: false } });
    await syncAutoPeriodDates({ ids });
  }
  const key = month ? `${month.year}-${String(month.month).padStart(2, "0")}` : null;
  for (const entityId of ids) {
    await logEvent({
      userId: actor.id,
      action: "transaction.month_set",
      entity: "Transaction",
      entityId,
      metadata: { month: key },
    });
  }
}
