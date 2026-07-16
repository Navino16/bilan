import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { suggestPairs } from "@/server/services/links";
import { SuggestionsList } from "@/components/transactions/suggestions-list";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("transactions.suggestions");
  const pairs = await suggestPairs(user.id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="space-y-1">
        <div className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {t("subtitle", { count: pairs.length })}
        </div>
        <h1 className="font-display text-3xl leading-none">{t("title")}</h1>
      </header>
      <SuggestionsList items={pairs} />
    </div>
  );
}
