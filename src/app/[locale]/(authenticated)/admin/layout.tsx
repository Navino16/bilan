import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";

// Until the full authenticated shell lands (1.6), the admin section guards itself
// (requireSession here; each page additionally requirePermission's its scope).
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSession();
  const t = await getTranslations("admin");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <header className="space-y-3">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <nav className="text-muted-foreground flex gap-4 text-sm">
          <Link href={`/${locale}/admin/users`} className="hover:text-foreground">
            {t("nav.users")}
          </Link>
          <Link href={`/${locale}/admin/signup-tokens`} className="hover:text-foreground">
            {t("nav.signupTokens")}
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
