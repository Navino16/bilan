import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getDashboard } from "@/server/services/dashboard";
import { parsePeriodParams, previousPeriod, clampPeriodToNow } from "@/lib/period";
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
  const [data, categories] = await Promise.all([
    getDashboard(user.id, period, previous),
    listForUser(user.id).then(flattenCategories),
  ]);

  return <InsightsView data={data} period={period} categories={categories} locale={locale} />;
}
