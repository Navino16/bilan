import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { overline } from "@/components/transactions/bits";
import { Card } from "@/components/ui/card";
import { TwoFactorControls } from "@/components/settings/two-factor-controls";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("settings.security");

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { twoFactorEnabled: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader overline={t("overline")} title={t("title")} subtitle={t("subtitle")} />

      <Card className="max-w-2xl gap-4 p-6">
        <div>
          <div className={overline}>{t("twoFactor")}</div>
          <div className="font-display text-xl">{t("twoFactorTitle")}</div>
          <p className="text-muted-foreground mt-1 text-sm">{t("twoFactorHint")}</p>
        </div>
        <TwoFactorControls enabled={Boolean(row?.twoFactorEnabled)} />
      </Card>
    </div>
  );
}
