import { getTranslations, setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAppName } from "@/server/services/settings/app-settings";
import { currentTheme } from "@/server/theme";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tShell, appName, theme] = await Promise.all([
    getTranslations("app"),
    getTranslations("shell"),
    getAppName(),
    currentTheme(),
  ]);
  return (
    <div className="bg-background flex min-h-screen w-full flex-col">
      <div className="flex items-center justify-end gap-3 px-4 pt-4">
        <ThemeToggle label={tShell("themeToggle")} theme={theme} />
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="font-display text-3xl leading-none">{appName}</div>
            <p className="text-muted-foreground mt-1 text-sm">{t("tagline")}</p>
          </div>
          <div className="bg-card rounded-xl border p-6 shadow-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
