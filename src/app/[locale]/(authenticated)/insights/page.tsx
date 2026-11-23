import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getInsights } from "@/server/services/dashboard/insights";
import {
  parsePeriodParams,
  clampPeriodToNow,
  parseBaseline,
  comparisonFor,
  INSIGHTS_BASELINE,
} from "@/lib/period";
import { InsightsView } from "@/components/insights/insights-view";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("insights");

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
  const comparison = comparisonFor(period, parseBaseline(sp.vs, period, INSIGHTS_BASELINE));
  const [data, categories] = await Promise.all([
    getInsights(user.id, period, comparison),
    // Display only: shared accounts carry their owner's categories too.
    Promise.all([listForUser(user.id), listForeignCategories(user.id)]).then(([own, foreign]) => [
      ...flattenCategories(own),
      ...flattenCategories(foreign),
    ]),
  ]);

  return (
    <InsightsView
      data={data}
      period={period}
      comparison={comparison}
      categories={categories}
      locale={locale}
    />
  );
}
