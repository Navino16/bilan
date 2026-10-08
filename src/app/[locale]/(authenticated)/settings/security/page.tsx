import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCurrentSession, requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getMinPasswordLength } from "@/server/services/settings/app-settings";
import { hasPasswordCredential } from "@/server/services/users/password";
import { listSessions } from "@/server/services/users/sessions";
import { listPasskeys } from "@/server/services/users/passkeys";
import { listIdentities } from "@/server/services/users/identities";
import { linkSsoError } from "@/lib/sso-errors";
import { IdentitiesControls, type IdentityNotice } from "@/components/settings/identities-controls";
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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // Set by the identity link callbacks (Better Auth appends `error` on failure).
  searchParams: Promise<{ linked?: string; error?: string }>;
}) {
  const [{ locale }, { linked, error }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("settings.security");

  const currentSessionId = (await getCurrentSession())?.session.id ?? null;
  const [row, hasPassword, minPasswordLength, sessions, passkeys, identities] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true } }),
    hasPasswordCredential(user.id),
    getMinPasswordLength(),
    listSessions(user.id, currentSessionId),
    listPasskeys(user.id),
    listIdentities(user.id),
  ]);
  const linkedName = identities.linked.find((i) => i.providerId === linked)?.displayName;
  const identityNotice: IdentityNotice | undefined = error
    ? { linkError: linkSsoError(String(error)) }
    : linkedName
      ? { linked: linkedName }
      : undefined;

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

      <SectionCard
        overline={t("identitiesCard.overline")}
        title={t("identitiesCard.title")}
        hint={t("identitiesCard.hint")}
      >
        <IdentitiesControls identities={identities} notice={identityNotice} />
      </SectionCard>
    </div>
  );
}
