import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { getMappingView, type MappingView } from "@/server/services/bank-sync/mapping";
import { BankMappingForm } from "@/components/accounts/bank-mapping-form";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("bankMapping");

export default async function BankMappingPage({
  params,
}: {
  params: Promise<{ locale: string; connectionId: string }>;
}) {
  const { locale, connectionId } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("accounts.bankSync.mapping");
  let view: MappingView;
  try {
    view = await getMappingView(user.id, connectionId);
  } catch (e) {
    if (e instanceof BankSyncError) notFound();
    throw e;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        overline={t("overline")}
        title={t("title", { bank: view.aspspName })}
        subtitle={t("intro")}
      />
      <BankMappingForm view={view} />
    </div>
  );
}
