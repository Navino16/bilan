import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listAuthProviders } from "@/server/services/settings/auth-providers";
import { AuthProviderForm, type AuthProviderDefaults } from "@/components/admin/auth-provider-form";

export const dynamic = "force-dynamic";

export default async function AdminAuthProvidersPage() {
  await requirePermission("admin.settings.write");
  const t = await getTranslations("admin.authProviders");
  const providers = await listAuthProviders();

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t("listTitle")}</h2>
        {providers.length === 0 && <p className="text-muted-foreground text-sm">{t("empty")}</p>}
        {providers.map((p) => {
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
          return (
            <section key={p.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{p.displayName}</h3>
                <span className="text-muted-foreground text-xs">
                  {p.enabled ? t("on") : t("off")}
                </span>
              </div>
              <AuthProviderForm provider={defaults} />
            </section>
          );
        })}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t("addTitle")}</h2>
        <div className="rounded-lg border p-4">
          <AuthProviderForm />
        </div>
      </section>
    </div>
  );
}
