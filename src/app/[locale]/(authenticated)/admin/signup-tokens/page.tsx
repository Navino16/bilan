import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listSignupTokens } from "@/server/services/signup-tokens";
import { SignupTokenCreateForm } from "@/components/admin/signup-token-create-form";
import { RevokeTokenButton } from "@/components/admin/revoke-token-button";

export const dynamic = "force-dynamic";

// Module-level (not in the component) so the Date.now() comparison isn't flagged
// as an impure render call. Returns an i18n key suffix.
function statusKey(tk: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
}): "statusRevoked" | "statusExpired" | "statusUsedUp" | "statusActive" {
  if (tk.revokedAt) return "statusRevoked";
  if (tk.expiresAt && tk.expiresAt.getTime() < Date.now()) return "statusExpired";
  if (tk.maxUses !== null && tk.usedCount >= tk.maxUses) return "statusUsedUp";
  return "statusActive";
}

export default async function AdminSignupTokensPage() {
  await requirePermission("admin.signup_tokens.manage");
  const t = await getTranslations("admin.signupTokens");
  const tokens = await listSignupTokens();

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t("createTitle")}</h2>
        <SignupTokenCreateForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("listTitle")}</h2>
        <div className="border-border divide-border divide-y rounded-lg border">
          {tokens.map((tk) => (
            <div key={tk.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <div className="min-w-0">
                <code className="text-xs break-all">{tk.token}</code>
                <div className="text-muted-foreground text-xs">
                  {tk.description ? `${tk.description} · ` : ""}
                  {t("uses", { used: tk.usedCount, max: tk.maxUses ?? "∞" })} · {t(statusKey(tk))}
                </div>
              </div>
              {!tk.revokedAt && <RevokeTokenButton id={tk.id} />}
            </div>
          ))}
          {tokens.length === 0 && (
            <div className="text-muted-foreground px-4 py-3 text-sm">{t("empty")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
