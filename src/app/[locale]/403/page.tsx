import { getTranslations, setRequestLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";

// Kept as a real, bookmarkable route (requirePermission now uses forbidden()
// instead of redirecting here). Reuses the shared shell + `errors` copy.
export default async function ForbiddenPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("errors");
  return (
    <ErrorShell
      code="403"
      title={t("forbidden.title")}
      message={t("forbidden.message")}
      action={{ href: `/${locale}/dashboard`, label: t("back") }}
    />
  );
}
