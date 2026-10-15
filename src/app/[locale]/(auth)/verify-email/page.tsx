import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/permissions";
import { pageTitle } from "@/i18n/metadata";

// Better Auth's /verify-email lands here, with `?error=<code>` when the link failed.
export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("verifyEmail");

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const [{ locale }, { error }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const [t, user] = await Promise.all([getTranslations("auth.verifyEmail"), getCurrentUser()]);
  const failure = error ? (error === "TOKEN_EXPIRED" ? "expired" : "invalid") : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{failure ? t("failedTitle") : t("title")}</h1>
      </header>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${failure}`)}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground text-center text-sm">{t("body")}</p>
      )}
      <Link
        href={user ? `/${locale}/groups` : `/${locale}/login`}
        className={buttonVariants({ className: "w-full" })}
      >
        {user ? t("continue") : t("signIn")}
      </Link>
    </div>
  );
}
