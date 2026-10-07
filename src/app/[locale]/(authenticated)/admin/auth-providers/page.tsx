import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { authProviderImpact, listAuthProviders } from "@/server/services/settings/auth-providers";
import { AuthProviderForm, type AuthProviderDefaults } from "@/components/admin/auth-provider-form";
import { SectionCard } from "@/components/shell/section-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

const TYPE_KEY = {
  credentials: "typeCredentials",
  oidc: "typeOidc",
  google: "typeGoogle",
} as const;

export const generateMetadata = pageTitle("adminAuthProviders");

export default async function AdminAuthProvidersPage() {
  await requirePermission("admin.settings.write");
  const t = await getTranslations("admin.authProviders");
  const providers = await listAuthProviders();
  const impacts = await Promise.all(providers.map((p) => authProviderImpact(p)));

  return (
    <div className="space-y-6">
      {providers.length === 0 && (
        <SectionCard overline={t("listOverline")} title={t("listTitle")} hint={t("empty")} />
      )}
      {providers.map((p, i) => {
        const defaults: AuthProviderDefaults = {
          key: p.key,
          type: p.type,
          displayName: p.displayName,
          enabled: p.enabled,
          issuer: p.issuer,
          clientId: p.clientId,
          scopes: p.scopes,
          config: (p.config as AuthProviderDefaults["config"]) ?? null,
        };
        const typeKey = TYPE_KEY[p.type as keyof typeof TYPE_KEY];
        return (
          <SectionCard
            key={p.id}
            overline={typeKey ? t(typeKey) : p.type}
            title={p.displayName}
            action={<StatusBadge active={p.enabled}>{p.enabled ? t("on") : t("off")}</StatusBadge>}
          >
            <AuthProviderForm provider={defaults} impact={impacts[i]} />
          </SectionCard>
        );
      })}

      <SectionCard overline={t("addOverline")} title={t("addTitle")} hint={t("addHint")}>
        <AuthProviderForm />
      </SectionCard>
    </div>
  );
}
