import { getCurrentUser } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { transactionsToCsv, type CsvRow } from "@/server/services/export/csv";
import { parsePeriodParams, toIsoDay } from "@/lib/period";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams;
  const dir = q.get("dir");
  const direction = dir === "in" || dir === "out" ? dir : undefined;
  const from = q.get("from") ?? undefined;
  const to = q.get("to") ?? undefined;
  const period = from || to ? parsePeriodParams({ from, to }) : undefined;

  const [{ items }, tree] = await Promise.all([
    listTransactions(user.id, {
      categoryId: q.get("categoryId") ?? undefined,
      direction,
      search: q.get("search") ?? undefined,
      from: period?.from,
      to: period?.to,
      take: 100_000,
      skip: 0,
    }),
    listForUser(user.id),
  ]);

  const catName = new Map(flattenCategories(tree).map((c) => [c.id, c.name]));
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
