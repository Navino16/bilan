import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { locales } from "@/i18n/config";
import { mono, sans, serif } from "@/lib/fonts";
import { THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Bilan",
  description: "Self-hosted multi-user personal finance app",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Bilan" },
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ed" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1114" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
  const messages = await getMessages();

  const isDark = (await cookies()).get(THEME_COOKIE)?.value === "dark";

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full antialiased ${
        isDark ? "dark" : ""
      }`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
