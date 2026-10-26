import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getDashboard } from "@/server/services/dashboard";
import { getCurrentBudget } from "@/server/services/budgets";
import { listVisibleForUser } from "@/server/services/accounts";
import { getOnboardingState } from "@/server/services/onboarding";
import { getAppName } from "@/server/services/settings/app-settings";
import { parsePeriodParams, clampPeriodToNow, parseBaseline, comparisonFor } from "@/lib/period";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { WelcomeCard } from "@/components/onboarding/welcome-card";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("dashboard");

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

  const onboarding = await getOnboardingState(user.id);
  if (!onboarding.hasTransaction) {
    const [t, tWelcome, appName] = await Promise.all([
      getTranslations("dashboard"),
      getTranslations("onboarding.welcome"),
      getAppName(),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader overline={t("overline")} title={tWelcome("title", { appName })} />
        <WelcomeCard state={onboarding} />
      </div>
    );
  }

  const period = clampPeriodToNow(parsePeriodParams({ from: sp.from, to: sp.to }));
  const comparison = comparisonFor(period, parseBaseline(sp.vs, period));
  const [data, categories, budget, accounts] = await Promise.all([
    getDashboard(user.id, period, comparison),
    // Display only: shared accounts carry their owner's categories too.
    Promise.all([listForUser(user.id), listForeignCategories(user.id)]).then(([own, foreign]) => [
      ...flattenCategories(own),
      ...flattenCategories(foreign),
    ]),
    getCurrentBudget(user.id),
    listVisibleForUser(user.id),
  ]);

  return (
    <DashboardView
      data={data}
      period={period}
      comparison={comparison}
      categories={categories}
      budget={budget}
      accounts={accounts}
      locale={locale}
    />
  );
}
