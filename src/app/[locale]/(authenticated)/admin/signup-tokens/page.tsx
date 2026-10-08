import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listSignupTokens, type SignupTokenStatus } from "@/server/services/signup-tokens";
import { appSettings } from "@/server/services/settings/app-settings";
import { SignupTokenCreateForm } from "@/components/admin/signup-token-create-form";
import { SignupTokenActions } from "@/components/admin/signup-token-actions";
import { SectionCard, listHeader } from "@/components/shell/section-card";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { pageTitle } from "@/i18n/metadata";
import { formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<SignupTokenStatus, string> = {
  active: "statusActive",
  revoked: "statusRevoked",
  expired: "statusExpired",
  usedUp: "statusUsedUp",
};

const cols = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px_minmax(0,1fr)_90px_72px]";

export const generateMetadata = pageTitle("adminSignupTokens");

export default async function AdminSignupTokensPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePermission("admin.signup_tokens.manage");
  const t = await getTranslations("admin.signupTokens");
  const [tokens, mode] = await Promise.all([
    listSignupTokens(),
    appSettings.get<string>("registration_mode"),
  ]);
  // Mirrors registerAction's default when the setting is unset.
  const registrationMode = mode ?? "INVITE_ONLY";

  const expiry = (at: Date | null) => (at ? <LocalDateTime value={at} /> : t("never"));

  return (
    <div className="space-y-6">
      {registrationMode !== "INVITE_ONLY" && (
        <Alert data-slot="registration-mode-notice">
          <AlertDescription>
            {registrationMode === "OPEN" ? t("modeOpen") : t("modeDisabled")}{" "}
            <Link href={`/${locale}/admin/app-settings`} className="font-medium underline">
              {t("modeLink")}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard overline={t("createOverline")} title={t("createTitle")} hint={t("createHint")}>
        <SignupTokenCreateForm />
      </SectionCard>

      <SectionCard flush overline={t("listOverline")} title={t("listTitle")}>
        {tokens.length > 0 && (
          <div className={`${listHeader} hidden gap-3 md:grid ${cols}`}>
            <span>{t("token")}</span>
            <span>{t("description")}</span>
            <span>{t("usesCol")}</span>
            <span>{t("expiresCol")}</span>
            <span>{t("status")}</span>
            <span />
          </div>
        )}
        {tokens.map((tk) => {
          const label = t(STATUS_KEY[tk.status]);
          const active = tk.status === "active";
          const used = formatCount(tk.usedCount, locale);
          const max = tk.maxUses === null ? "∞" : formatCount(tk.maxUses, locale);
          return (
            <div
              key={tk.id}
              data-slot="signup-token-row"
              className={`flex items-center justify-between gap-3 border-b px-6 py-3 text-sm last:border-b-0 md:grid ${cols}`}
            >
              <div className="min-w-0">
                <code className="text-xs break-all">{tk.token}</code>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs md:hidden">
                  {tk.description && <span>{tk.description}</span>}
                  <span>{t("uses", { used, max })}</span>
                  <span>
                    {t("expires")} {expiry(tk.expiresAt)}
                  </span>
                  <StatusBadge active={active}>{label}</StatusBadge>
                </div>
              </div>
              <span className="text-muted-foreground hidden truncate md:block">
                {tk.description ?? "—"}
              </span>
              <span className="text-muted-foreground hidden tabular-nums md:block">
                {used} / {max}
              </span>
              <span className="text-muted-foreground hidden md:block">{expiry(tk.expiresAt)}</span>
              <span className="hidden md:block">
                <StatusBadge active={active}>{label}</StatusBadge>
              </span>
              <SignupTokenActions id={tk.id} token={tk.token} active={active} />
            </div>
          );
        })}
        {tokens.length === 0 && (
          <p className="text-muted-foreground px-6 py-5 text-sm">{t("empty")}</p>
        )}
      </SectionCard>
    </div>
  );
}
