import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppName } from "@/server/services/settings/app-settings";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, appName] = await Promise.all([getTranslations("app"), getAppName()]);
  return (
    <div className="bg-background flex min-h-screen w-full flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="font-display text-3xl leading-none">{appName}</div>
          <p className="text-muted-foreground mt-1 text-sm">{t("tagline")}</p>
        </div>
        <div className="bg-card rounded-xl border p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
