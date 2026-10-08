import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { postLoginPath } from "@/lib/callback-url";
import { LoginForm, type LoginNotice, type SsoError } from "@/components/auth/login-form";
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
  // Already authenticated → no reason to show the login page.
  if (await getCurrentUser()) redirect(redirectTo);
  const notice: LoginNotice | undefined =
    deleted === "1" ? "accountDeleted" : reset === "1" ? "passwordReset" : undefined;
  // Better Auth's onAPIError.errorURL lands failed OAuth/OIDC callbacks here.
  const ssoError: SsoError | undefined = error
    ? error === "banned"
      ? "disabled"
      : "ssoFailed"
    : undefined;

  return (
    <main>
      <LoginForm locale={locale} redirectTo={redirectTo} notice={notice} ssoError={ssoError} />
    </main>
  );
}
