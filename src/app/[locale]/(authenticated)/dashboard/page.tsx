import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getDashboard } from "@/server/services/dashboard";
import { parsePeriodParams, previousMonthPeriod } from "@/lib/period";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
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

  const period = parsePeriodParams({ from: sp.from, to: sp.to });
  const previous = previousMonthPeriod(period);
  const [data, categories] = await Promise.all([
    getDashboard(user.id, period, previous),
    listForUser(user.id).then(flattenCategories),
  ]);

  return <DashboardView data={data} period={period} categories={categories} locale={locale} />;
}
