import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { LoginForm } from "@/components/auth/login-form";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string }>;
}) {
  const [{ locale }, { reset }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  // Already authenticated → no reason to show the login page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);

  return (
    <main>
      <LoginForm locale={locale} notice={reset === "1" ? "passwordReset" : undefined} />
    </main>
  );
}
