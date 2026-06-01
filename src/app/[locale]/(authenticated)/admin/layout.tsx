import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";

// RBAC gate for the whole admin section: non-admins are redirected to /403.
// Each page additionally requirePermission's its narrower scope.
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
  await requirePermission("admin.settings.write");
  const t = await getTranslations("admin");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
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
