import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getDashboard } from "@/server/services/dashboard";
import { getCurrentBudget } from "@/server/services/budgets";
import { parsePeriodParams, clampPeriodToNow, parseBaseline, comparisonFor } from "@/lib/period";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string; vs?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireSession();

  const period = clampPeriodToNow(parsePeriodParams({ from: sp.from, to: sp.to }));
  const comparison = comparisonFor(period, parseBaseline(sp.vs, period));
  const [data, categories, budget] = await Promise.all([
    getDashboard(user.id, period, comparison),
    // Display only: shared accounts carry their owner's categories too.
    Promise.all([listForUser(user.id), listForeignCategories(user.id)]).then(([own, foreign]) => [
      ...flattenCategories(own),
      ...flattenCategories(foreign),
    ]),
    getCurrentBudget(user.id),
  ]);

  return (
    <DashboardView
      data={data}
      period={period}
      comparison={comparison}
      categories={categories}
      budget={budget}
      locale={locale}
    />
  );
}
