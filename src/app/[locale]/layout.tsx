import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { locales } from "@/i18n/config";
import { ClientMessages } from "@/i18n/client-messages";
import { DocumentShell } from "@/components/shell/document-shell";
import { SYSTEM_THEME_COLORS, THEME_COLOR } from "@/lib/theme";
import { currentTheme } from "@/server/theme";
import { getAppName } from "@/server/services/settings/app-settings";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await getAppName();
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: "Self-hosted multi-user personal finance app",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: appName },
    icons: { icon: "/icon.png", apple: "/apple-icon.png" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  return {
    themeColor: theme === "system" ? SYSTEM_THEME_COLORS : THEME_COLOR[theme],
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();

  setRequestLocale(locale);

  return (
    <DocumentShell lang={locale}>
      <ClientMessages scope="root" locale={locale}>
        {children}
      </ClientMessages>
    </DocumentShell>
  );
}
