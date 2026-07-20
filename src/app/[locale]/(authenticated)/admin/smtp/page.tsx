import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { getSmtpConfig } from "@/server/services/settings/smtp";
import { SmtpForm } from "@/components/admin/smtp-form";

export const dynamic = "force-dynamic";

export default async function AdminSmtpPage() {
  await requirePermission("admin.settings.write");
  const t = await getTranslations("admin.smtp");
  const cfg = await getSmtpConfig();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">{t("title")}</h2>
      <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
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
    </div>
  );
}
