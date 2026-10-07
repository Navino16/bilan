import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";
import { LoginForm } from "@/components/auth/login-form";

// Reads the session (DB) to bounce already-authenticated users, so it must be dynamic.
export const dynamic = "force-dynamic";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Already authenticated → no reason to show the login page.
  if (await getCurrentUser()) redirect(`/${locale}/dashboard`);

  return (
    <main>
      <LoginForm locale={locale} />
    </main>
  );
}
