import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { suggestPairs } from "@/server/services/links";
import { SuggestionsList } from "@/components/transactions/suggestions-list";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("transactions.suggestions");
  const pairs = await suggestPairs(user.id);

  return (
    <div className="space-y-5">
      <PageHeader overline={t("subtitle", { count: pairs.length })} title={t("title")} />
      <SuggestionsList items={pairs} />
    </div>
  );
}
