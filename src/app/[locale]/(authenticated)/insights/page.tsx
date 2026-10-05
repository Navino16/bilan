import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getCategoryHistory, getInsights } from "@/server/services/dashboard/insights";
import {
  parsePeriodParams,
  previousPeriod,
  clampPeriodToNow,
  periodInProgress,
} from "@/lib/period";
import { InsightsView } from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireSession();

  const period = clampPeriodToNow(parsePeriodParams({ from: sp.from, to: sp.to }));
  const previous = previousPeriod(period);
  const [data, history, categories] = await Promise.all([
    getInsights(user.id, period, previous),
    getCategoryHistory(user.id, period),
    listForUser(user.id).then(flattenCategories),
  ]);

  return (
    <InsightsView
      data={data}
      history={history}
      period={period}
      previous={previous}
      inProgress={periodInProgress(period)}
      categories={categories}
      locale={locale}
    />
  );
}
