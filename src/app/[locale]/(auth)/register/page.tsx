import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { appSettings } from "@/server/services/settings/app-settings";
import { listSsoProviders } from "@/server/services/users/identities";
import { RegisterForm } from "@/components/auth/register-form";
import { pageTitle } from "@/i18n/metadata";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("register");

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Already authenticated → no reason to show the register page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);
  const t = await getTranslations("auth.register");
  const [mode, credentialsEnabled] = await Promise.all([
    appSettings.get<string>("registration_mode").then((m) => m ?? "INVITE_ONLY"),
    appSettings.get<boolean>("credentials_enabled"),
  ]);
  const ssoProviders = mode === "OPEN" ? await listSsoProviders({ signUpOnly: true }) : [];

  return (
    <main className="space-y-6">
      <header className="text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
      </header>
      <Suspense>
        <RegisterForm
          locale={locale}
          mode={mode}
          credentialsEnabled={credentialsEnabled ?? true}
          ssoProviders={ssoProviders}
        />
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
