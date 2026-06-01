import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetConfirmForm } from "@/components/auth/reset-confirm-form";

export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.resetConfirm");

  return (
    <main className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <ResetConfirmForm token={token} locale={locale} />
    </main>
  );
}
