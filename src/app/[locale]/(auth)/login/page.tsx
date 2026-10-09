import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { appSettings, getAppName } from "@/server/services/settings/app-settings";
import { listSsoProviders } from "@/server/services/users/identities";
import { postLoginPath } from "@/lib/callback-url";
import { loginSsoError } from "@/lib/sso-errors";
import { LoginForm, type LoginNotice } from "@/components/auth/login-form";
import { pageTitle } from "@/i18n/metadata";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("login");

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    reset?: string;
    deleted?: string;
    error?: string;
    callbackUrl?: string | string[];
  }>;
}) {
  const [{ locale }, { reset, deleted, error, callbackUrl }] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  const redirectTo = postLoginPath(callbackUrl, locale);
  if (await getCurrentUser()) {
    // Failed OAuth/OIDC callbacks land here through onAPIError.errorURL, with an `error` code;
    // a signed-in user only gets one from a Settings > Security link attempt.
    redirect(
      error
        ? `/${locale}/settings/security?error=${encodeURIComponent(String(error))}`
        : redirectTo,
    );
  }
  const [credentialsEnabled, ssoProviders, appName] = await Promise.all([
    appSettings.get<boolean>("credentials_enabled"),
    listSsoProviders(),
    getAppName(),
  ]);
  const notice: LoginNotice | undefined =
    deleted === "1" ? "accountDeleted" : reset === "1" ? "passwordReset" : undefined;

  return (
    <LoginForm
      locale={locale}
      redirectTo={redirectTo}
      notice={notice}
      ssoError={error ? loginSsoError(String(error)) : undefined}
      credentialsEnabled={credentialsEnabled ?? true}
      ssoProviders={ssoProviders}
      appName={appName}
    />
  );
}
