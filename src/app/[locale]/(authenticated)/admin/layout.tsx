import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasPermission, requirePermission, requireAdmin2fa } from "@/server/auth/permissions";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";

// RBAC gate for the whole admin section: non-admins are redirected to /403.
// Each page additionally requirePermission's its narrower scope.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePermission("admin.settings.write");
  await requireAdmin2fa(locale);
  const t = await getTranslations("admin");

  // Mirrors each page's own requirePermission, so no tab leads to a 403.
  const tabs = [
    { path: "users", key: "users", permission: "admin.users.read" },
    { path: "signup-tokens", key: "signupTokens", permission: "admin.signup_tokens.manage" },
    { path: "auth-providers", key: "authProviders", permission: "admin.settings.write" },
    { path: "smtp", key: "smtp", permission: "admin.settings.write" },
    { path: "app-settings", key: "appSettings", permission: "admin.settings.write" },
    { path: "audit", key: "audit", permission: "admin.audit.read" },
  ] as const;
  const allowed = await Promise.all(tabs.map((tab) => hasPermission(user.id, tab.permission)));
  const items = tabs
    .filter((_, i) => allowed[i])
    .map((tab) => ({ href: `/${locale}/admin/${tab.path}`, label: t(`nav.${tab.key}`) }));

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader overline={t("overline")} title={t("title")} />
        <AdminNav items={items} />
      </div>
      {children}
    </div>
  );
}
