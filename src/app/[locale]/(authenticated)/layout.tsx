import { setRequestLocale } from "next-intl/server";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { NavigationPending } from "@/components/shell/navigation-pending";
import { SkipLink } from "@/components/shell/skip-link";
import { MAIN_ID } from "@/lib/landmarks";
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
      <SkipLink />
      <Sidebar
        user={identity}
        canAdmin={canAdmin}
        appName={appName}
        year={year}
        theme={theme}
        className="hidden lg:flex"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={identity} canAdmin={canAdmin} appName={appName} year={year} theme={theme} />
        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="flex-1 px-4 pt-6 pb-24 outline-none md:px-8 lg:pb-8"
        >
          <NavigationPending className="mx-auto w-full max-w-5xl">{children}</NavigationPending>
        </main>
        <BottomNav className="lg:hidden" />
      </div>
      <RegisterSw />
    </div>
  );
}
