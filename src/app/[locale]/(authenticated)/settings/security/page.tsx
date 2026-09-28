import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { TwoFactorControls } from "@/components/settings/two-factor-controls";
import { PageHeader } from "@/components/shell/page-header";
import { SectionCard } from "@/components/shell/section-card";

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

      <SectionCard overline={t("twoFactor")} title={t("twoFactorTitle")} hint={t("twoFactorHint")}>
        <TwoFactorControls enabled={Boolean(row?.twoFactorEnabled)} />
      </SectionCard>
    </div>
  );
}
