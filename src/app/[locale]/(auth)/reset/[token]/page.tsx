import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResetConfirmForm } from "@/components/auth/reset-confirm-form";
import { isResetTokenValid } from "@/server/services/users/password-reset";

// Checks the token against the DB on every visit.
export const dynamic = "force-dynamic";

export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [t, valid] = await Promise.all([
    getTranslations("auth.resetConfirm"),
    isResetTokenValid(token),
  ]);

  return (
    <main className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        {valid && <p className="text-muted-foreground text-sm">{t("subtitle")}</p>}
      </header>
      {valid ? (
        <ResetConfirmForm token={token} locale={locale} />
      ) : (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{t("error.invalidToken")}</AlertDescription>
          </Alert>
          <p className="text-center text-sm">
            <Link href={`/${locale}/reset`} className="text-foreground hover:underline">
              {t("requestAgain")}
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}
