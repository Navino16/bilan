import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getCategoryHistory, getInsights } from "@/server/services/dashboard/insights";
import { parsePeriodParams, clampPeriodToNow, parseBaseline, comparisonFor } from "@/lib/period";
import { InsightsView } from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
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
  const [data, history, categories] = await Promise.all([
    getInsights(user.id, period, comparison),
    getCategoryHistory(user.id, period),
    listForUser(user.id).then(flattenCategories),
  ]);

  return (
    <InsightsView
      data={data}
      history={history}
      period={period}
      comparison={comparison}
      categories={categories}
      locale={locale}
    />
  );
}
