import { getCurrentUser } from "@/server/auth/permissions";
import { transactionPages, type ExportItem } from "@/server/services/transactions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { csvHeader, csvLines, type CsvRow } from "@/server/services/export/csv";
import { assignedMonthKey } from "@/lib/assigned-month";
import { streamOf } from "@/server/http/stream";
import { dayEnd, dayStart, toIsoDay } from "@/lib/period";
import { parseTransactionFilters } from "@/lib/transaction-filters";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { getTranslations } from "next-intl/server";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const requested = q.get("locale");
  const locale: Locale = locales.find((l) => l === requested) ?? defaultLocale;

  // Same filters as the list; the CSV stays in date order whatever the list sort.
  const { from, to, ...rest } = parseTransactionFilters(Object.fromEntries(q));
  const filters = {
    ...rest,
    from: from ? dayStart(from) : undefined,
    to: to ? dayEnd(to) : undefined,
  };

  const [tree, foreign] = await Promise.all([listForUser(user.id), listForeignCategories(user.id)]);
  const catName = new Map(
    [...flattenCategories(tree), ...flattenCategories(foreign)].map((c) => [c.id, c.name]),
  );
  const tType = await getTranslations({ locale, namespace: "transactions.types" });
  const typeLabels = Object.fromEntries(TRANSACTION_TYPES.map((type) => [type, tType(type)]));
  const toRow = (i: ExportItem): CsvRow => ({
    date: toIsoDay(i.date),
    amount: i.amount,
    type: i.type,
    label: i.label,
    accountName: i.accountName,
    categoryName: i.categoryId ? (catName.get(i.categoryId) ?? null) : null,
    assignedMonth: assignedMonthKey(i.date, i.periodDate),
  });

  // Every matching row, never silently truncated (RGPD/portability must be complete).
  async function* csv() {
    yield csvHeader(locale);
    for await (const page of transactionPages(user!.id, filters)) {
      yield csvLines(page.map(toRow), locale, typeLabels);
    }
  }
  return new Response(streamOf(csv()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-transactions-${toIsoDay(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
