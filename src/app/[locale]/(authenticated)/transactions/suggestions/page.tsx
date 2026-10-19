import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listIgnoredSuggestions, suggestPairs } from "@/server/services/links";
import { getLinkSuggestionSettings } from "@/server/services/users/preferences";
import { SuggestionsList } from "@/components/transactions/suggestions-list";
import { SuggestionSettings } from "@/components/transactions/suggestion-settings";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { pageTitle } from "@/i18n/metadata";
import { getAppName } from "@/server/services/settings/app-settings";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("suggestions");

export default async function SuggestionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("transactions.suggestions");
  const tTx = await getTranslations("transactions");
  const [pairs, ignored, appName, settings] = await Promise.all([
    suggestPairs(user.id),
    listIgnoredSuggestions(user.id),
    getAppName(),
    getLinkSuggestionSettings(user.id),
  ]);

  return (
    <div className="space-y-5">
      <Link
        href={`/${locale}/transactions`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        {t("back")}
      </Link>
      <PageHeader
        overline={tTx("title")}
        title={t("title")}
        badges={<Badge variant="secondary">{t("subtitle", { count: pairs.length })}</Badge>}
        subtitle={
          <>
            <p>{t("hint", { appName })}</p>
            <p data-slot="suggestion-criteria" className="mt-1">
              {t("criteria", {
                days: settings.windowDays,
                amount: formatMoney(settings.minAmount, locale),
              })}
            </p>
          </>
        }
        actions={<SuggestionSettings settings={settings} />}
      />
      <SuggestionsList items={pairs} ignored={ignored} />
    </div>
  );
}
