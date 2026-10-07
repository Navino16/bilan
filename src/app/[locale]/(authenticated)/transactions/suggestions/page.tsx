import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { suggestPairs } from "@/server/services/links";
import { SuggestionsList } from "@/components/transactions/suggestions-list";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("suggestions");

export default async function SuggestionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("transactions.suggestions");
  const pairs = await suggestPairs(user.id);

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
        overline={t("subtitle", { count: pairs.length })}
        title={t("title")}
        subtitle={t("hint")}
      />
      <SuggestionsList items={pairs} />
    </div>
  );
}
