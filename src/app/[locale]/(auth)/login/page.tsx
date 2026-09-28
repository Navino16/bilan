import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { LoginForm } from "@/components/auth/login-form";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Already authenticated → no reason to show the login page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);
  const t = await getTranslations("auth.login");

  return (
    <main className="space-y-6">
      <header className="text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
      </header>
      <LoginForm locale={locale} />
      <p className="text-muted-foreground text-center text-sm">
        {t("noAccount")}{" "}
        <Link href={`/${locale}/register`} className="text-foreground hover:underline">
          {t("registerLink")}
        </Link>
      </p>
    </main>
  );
}
