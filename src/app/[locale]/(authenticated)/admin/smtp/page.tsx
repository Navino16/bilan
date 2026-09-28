import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { getSmtpConfig } from "@/server/services/settings/smtp";
import { SmtpForm } from "@/components/admin/smtp-form";
import { SectionCard } from "@/components/shell/section-card";

export const dynamic = "force-dynamic";

export default async function AdminSmtpPage() {
  await requirePermission("admin.settings.write");
  const t = await getTranslations("admin.smtp");
  const cfg = await getSmtpConfig();

  return (
    <SectionCard overline={t("overline")} title={t("title")} hint={t("subtitle")}>
      <SmtpForm
        defaults={
          cfg
            ? {
                host: cfg.host,
                port: cfg.port,
                secure: cfg.secure,
                username: cfg.username,
                fromAddress: cfg.fromAddress,
                fromName: cfg.fromName,
                enabled: cfg.enabled,
              }
            : null
        }
      />
    </SectionCard>
  );
}
