import { parseDayBounds, toIsoDay } from "@/lib/period";
import { readAmount } from "@/lib/amount";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/validation/transaction";

// `categoryId` URL value selecting transactions with no category.
export const UNCATEGORIZED = "none";

export const TRANSACTION_SORTS = ["date-desc", "date-asc", "amount-asc", "amount-desc"] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];
export const DEFAULT_SORT: TransactionSort = "date-desc";

// URL params cleared by « Reset »; the search box is kept, as on mobile.
export const FILTER_PARAMS = [
  "dir",
  "categoryId",
  "accountId",
  "type",
  "min",
  "max",
  "from",
  "to",
  "sort",
] as const;

export type ParsedTransactionFilters = {
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  direction?: "in" | "out";
  amountMin?: number;
  amountMax?: number;
  search?: string;
  from?: string;
  to?: string;
  sort: TransactionSort;
};

function absAmount(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const r = readAmount(raw);
  return r.ok ? Math.abs(r.value) : undefined;
}

// The /transactions URL params as list filters; unknown or malformed values are dropped.
export function parseTransactionFilters(
  sp: Record<string, string | undefined>,
): ParsedTransactionFilters {
  const out: ParsedTransactionFilters = { sort: DEFAULT_SORT };
  if (sp.accountId) out.accountId = sp.accountId;
  if (sp.categoryId) out.categoryId = sp.categoryId;
  if (TRANSACTION_TYPES.includes(sp.type as TransactionType)) out.type = sp.type as TransactionType;
  if (sp.dir === "in" || sp.dir === "out") out.direction = sp.dir;
  if (TRANSACTION_SORTS.includes(sp.sort as TransactionSort)) out.sort = sp.sort as TransactionSort;
  if (sp.search) out.search = sp.search;

  let min = absAmount(sp.min);
  let max = absAmount(sp.max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) out.amountMin = min;
  if (max !== undefined) out.amountMax = max;

  const bounds = parseDayBounds({ from: sp.from, to: sp.to });
  if (bounds.from) out.from = bounds.from;
  if (bounds.to) out.to = bounds.to;
  return out;
}

export type TransactionsLinkFilter = {
  dir: "in" | "out";
  categoryId?: string | null;
  search?: string;
};

export function transactionsHref(
  locale: string,
  period: { from: Date; to: Date },
  filter: TransactionsLinkFilter,
): string {
  const params = new URLSearchParams({
    from: toIsoDay(period.from),
    to: toIsoDay(period.to),
    dir: filter.dir,
  });
  if (filter.categoryId !== undefined) {
    params.set("categoryId", filter.categoryId ?? UNCATEGORIZED);
  }
  if (filter.search) params.set("search", filter.search);
  return `/${locale}/transactions?${params.toString()}`;
}

export type ExportFilter = { from?: string; to?: string; accountId?: string };

// The CSV export reads the same params as the list (see parseTransactionFilters).
export function exportTransactionsHref(locale: string, filter: ExportFilter): string {
  const params = new URLSearchParams({ locale });
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.accountId) params.set("accountId", filter.accountId);
  return `/api/export/transactions?${params.toString()}`;
}
