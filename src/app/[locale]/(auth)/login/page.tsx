import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { LoginForm, type LoginNotice } from "@/components/auth/login-form";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string; deleted?: string }>;
}) {
  const [{ locale }, { reset, deleted }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  // Already authenticated → no reason to show the login page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);
  const notice: LoginNotice | undefined =
    deleted === "1" ? "accountDeleted" : reset === "1" ? "passwordReset" : undefined;

  return (
    <main>
      <LoginForm locale={locale} notice={notice} />
    </main>
  );
}
