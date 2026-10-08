import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResetConfirmForm } from "@/components/auth/reset-confirm-form";
import { isResetTokenValid } from "@/server/services/users/password-reset";
import { getMinPasswordLength } from "@/server/services/settings/app-settings";
import { pageTitle } from "@/i18n/metadata";

// Checks the token against the DB on every visit.
export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("resetConfirm");

export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [t, valid, minPasswordLength] = await Promise.all([
    getTranslations("auth.resetConfirm"),
    isResetTokenValid(token),
    getMinPasswordLength(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        {valid && <p className="text-muted-foreground text-sm">{t("subtitle")}</p>}
      </header>
      {valid ? (
        <ResetConfirmForm token={token} locale={locale} minPasswordLength={minPasswordLength} />
      ) : (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{t("error.invalidToken")}</AlertDescription>
          </Alert>
          <p className="text-center text-sm">
            <Link
              href={`/${locale}/reset`}
              className="text-foreground underline underline-offset-4"
            >
              {t("requestAgain")}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
