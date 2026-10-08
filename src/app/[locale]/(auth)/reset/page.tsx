import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetRequestForm } from "@/components/auth/reset-request-form";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("reset");

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.reset");

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <ResetRequestForm />
      <p className="text-muted-foreground text-center text-sm">
        <Link href={`/${locale}/login`} className="text-foreground underline underline-offset-4">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
