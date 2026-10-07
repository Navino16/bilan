import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCurrentSession, requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getMinPasswordLength } from "@/server/services/settings/app-settings";
import { hasPasswordCredential } from "@/server/services/users/password";
import { listSessions } from "@/server/services/users/sessions";
import { listPasskeys } from "@/server/services/users/passkeys";
import { PasskeysControls } from "@/components/settings/passkeys-controls";
import { PasswordControls } from "@/components/settings/password-controls";
import { SessionsControls } from "@/components/settings/sessions-controls";
import { TwoFactorControls } from "@/components/settings/two-factor-controls";
import { PageHeader } from "@/components/shell/page-header";
import { SectionCard } from "@/components/shell/section-card";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("security");

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("settings.security");

  const currentSessionId = (await getCurrentSession())?.session.id ?? null;
  const [row, hasPassword, minPasswordLength, sessions, passkeys] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true } }),
    hasPasswordCredential(user.id),
    getMinPasswordLength(),
    listSessions(user.id, currentSessionId),
    listPasskeys(user.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader overline={t("overline")} title={t("title")} subtitle={t("subtitle")} />

      {hasPassword && (
        <SectionCard
          overline={t("passwordCard.overline")}
          title={t("passwordCard.title")}
          hint={t("passwordCard.hint")}
        >
          <PasswordControls minLength={minPasswordLength} />
        </SectionCard>
      )}

      <SectionCard overline={t("twoFactor")} title={t("twoFactorTitle")} hint={t("twoFactorHint")}>
        <TwoFactorControls enabled={Boolean(row?.twoFactorEnabled)} />
      </SectionCard>

      <SectionCard
        overline={t("sessionsCard.overline")}
        title={t("sessionsCard.title")}
        hint={t("sessionsCard.hint")}
      >
        <SessionsControls sessions={sessions} />
      </SectionCard>

      <SectionCard
        overline={t("passkeysCard.overline")}
        title={t("passkeysCard.title")}
        hint={t("passkeysCard.hint")}
      >
        <PasskeysControls passkeys={passkeys} />
      </SectionCard>
    </div>
  );
}
