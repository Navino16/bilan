import { getCurrentUser } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { transactionsToCsv, type CsvRow } from "@/server/services/export/csv";
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
    sort: undefined,
    from: from ? dayStart(from) : undefined,
    to: to ? dayEnd(to) : undefined,
  };

  // Paginate through the full result set so the export is never silently
  // truncated (RGPD/portability must be complete). `total` bounds the loop.
  const PAGE = 10_000;
  const items: Awaited<ReturnType<typeof listTransactions>>["items"] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await listTransactions(user.id, { ...filters, take: PAGE, skip });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) break;
  }
  const [tree, foreign] = await Promise.all([listForUser(user.id), listForeignCategories(user.id)]);

  const catName = new Map(
    [...flattenCategories(tree), ...flattenCategories(foreign)].map((c) => [c.id, c.name]),
  );
  const rows: CsvRow[] = items.map((i) => ({
    date: toIsoDay(i.date),
    amount: i.amount,
    type: i.type,
    label: i.label,
    accountName: i.accountName,
    categoryName: i.categoryId ? (catName.get(i.categoryId) ?? null) : null,
  }));

  const tType = await getTranslations({ locale, namespace: "transactions.types" });
  const typeLabels = Object.fromEntries(TRANSACTION_TYPES.map((type) => [type, tType(type)]));
  const csv = transactionsToCsv(rows, locale, typeLabels);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-transactions-${toIsoDay(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
