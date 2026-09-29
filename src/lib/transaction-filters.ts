import { toIsoDay } from "@/lib/period";

// `categoryId` URL value selecting transactions with no category.
export const UNCATEGORIZED = "none";

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
