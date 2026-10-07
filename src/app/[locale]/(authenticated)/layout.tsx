import { setRequestLocale } from "next-intl/server";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { RegisterSw } from "@/components/pwa/register-sw";
import { currentUtcYear } from "@/lib/period";
import { hasPermission, requireSession } from "@/server/auth/permissions";
import { getAppName } from "@/server/services/settings/app-settings";
import { currentTheme } from "@/server/theme";

// The authenticated layout is the authoritative auth guard (spec §3.2): it runs
// requireSession() on every request to this segment. The proxy only does a cheap
// cookie sniff for UX redirects.
export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const [canAdmin, appName, theme] = await Promise.all([
    hasPermission(user.id, "admin.settings.write"),
    getAppName(),
    currentTheme(),
  ]);
  const year = currentUtcYear();
  const identity = { name: user.name, email: user.email };

  return (
    <div className="bg-background flex min-h-screen">
      <Sidebar
        user={identity}
        canAdmin={canAdmin}
        appName={appName}
        year={year}
        theme={theme}
        className="hidden md:flex"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={identity} canAdmin={canAdmin} appName={appName} year={year} theme={theme} />
        <main className="flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
        <BottomNav className="md:hidden" />
      </div>
      <RegisterSw />
    </div>
  );
}
