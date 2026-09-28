import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listSignupTokens } from "@/server/services/signup-tokens";
import { SignupTokenCreateForm } from "@/components/admin/signup-token-create-form";
import { RevokeTokenButton } from "@/components/admin/revoke-token-button";
import { SectionCard, listHeader } from "@/components/shell/section-card";
import { StatusBadge } from "@/components/admin/status-badge";

export const dynamic = "force-dynamic";

type TokenStatus = "statusRevoked" | "statusExpired" | "statusUsedUp" | "statusActive";

// Module-level (not in the component) so the Date.now() comparison isn't flagged
// as an impure render call. Returns an i18n key suffix.
function statusKey(tk: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
}): TokenStatus {
  if (tk.revokedAt) return "statusRevoked";
  if (tk.expiresAt && tk.expiresAt.getTime() < Date.now()) return "statusExpired";
  if (tk.maxUses !== null && tk.usedCount >= tk.maxUses) return "statusUsedUp";
  return "statusActive";
}

const cols = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_90px_96px]";

export default async function AdminSignupTokensPage() {
  await requirePermission("admin.signup_tokens.manage");
  const t = await getTranslations("admin.signupTokens");
  const tokens = await listSignupTokens();

  return (
    <div className="space-y-6">
      <SectionCard overline={t("createOverline")} title={t("createTitle")} hint={t("createHint")}>
        <SignupTokenCreateForm />
      </SectionCard>

      <SectionCard flush overline={t("listOverline")} title={t("listTitle")}>
        {tokens.length > 0 && (
          <div className={`${listHeader} hidden gap-3 md:grid ${cols}`}>
            <span>{t("token")}</span>
            <span>{t("description")}</span>
            <span>{t("usesCol")}</span>
            <span>{t("status")}</span>
            <span />
          </div>
        )}
        {tokens.map((tk) => {
          const status = statusKey(tk);
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
                  <span>{t("uses", { used: tk.usedCount, max: tk.maxUses ?? "∞" })}</span>
                  <StatusBadge active={status === "statusActive"}>{t(status)}</StatusBadge>
                </div>
              </div>
              <span className="text-muted-foreground hidden truncate md:block">
                {tk.description ?? "—"}
              </span>
              <span className="text-muted-foreground hidden tabular-nums md:block">
                {tk.usedCount} / {tk.maxUses ?? "∞"}
              </span>
              <span className="hidden md:block">
                <StatusBadge active={status === "statusActive"}>{t(status)}</StatusBadge>
              </span>
              <div className="flex justify-end">
                {!tk.revokedAt && <RevokeTokenButton id={tk.id} />}
              </div>
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
