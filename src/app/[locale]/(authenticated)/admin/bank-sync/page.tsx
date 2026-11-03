import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { bankSyncRedirectUrl, getBankSyncConfig } from "@/server/services/bank-sync/config";
import { BankSyncForm } from "@/components/admin/bank-sync-form";
import { SectionCard } from "@/components/shell/section-card";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("adminBankSync");

export default async function AdminBankSyncPage() {
  await requirePermission("admin.security.write");
  const t = await getTranslations("admin.bankSync");
  const cfg = await getBankSyncConfig();

  return (
    <SectionCard overline={t("overline")} title={t("title")} hint={t("subtitle")}>
      <BankSyncForm
        defaults={
          cfg ? { applicationId: cfg.applicationId, enabled: cfg.enabled, hasKey: true } : null
        }
        redirectUrl={bankSyncRedirectUrl()}
      />
    </SectionCard>
  );
}
