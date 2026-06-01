import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { RegisterForm } from "@/components/auth/register-form";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Already authenticated → no reason to show the register page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);
  const t = await getTranslations("auth.register");

  return (
    <main className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <Suspense>
        <RegisterForm locale={locale} />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        {t("haveAccount")}{" "}
        <Link href={`/${locale}/login`} className="text-foreground hover:underline">
          {t("loginLink")}
        </Link>
      </p>
    </main>
  );
}
