import { getCurrentUser } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { transactionsToCsv, type CsvRow } from "@/server/services/export/csv";
import { dayEnd, dayStart, parseDayBounds, toIsoDay } from "@/lib/period";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams;
  const dir = q.get("dir");
  const direction: "in" | "out" | undefined = dir === "in" || dir === "out" ? dir : undefined;
  const from = q.get("from") ?? undefined;
  const to = q.get("to") ?? undefined;
  const bounds = parseDayBounds({ from, to });

  const filters = {
    categoryId: q.get("categoryId") ?? undefined,
    direction,
    search: q.get("search") ?? undefined,
    from: bounds.from ? dayStart(bounds.from) : undefined,
    to: bounds.to ? dayEnd(bounds.to) : undefined,
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

  const csv = transactionsToCsv(rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-transactions-${toIsoDay(new Date())}.csv"`,
    },
  });
}
