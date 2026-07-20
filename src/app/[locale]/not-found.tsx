import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";

// Catches unmatched paths under a locale (e.g. /fr/nope) — rendered inside the
// [locale] layout, so it's styled + localized. The root app/not-found.tsx covers
// truly top-level (locale-less) misses.
export default async function LocaleNotFound() {
  const [t, locale] = await Promise.all([getTranslations("errors"), getLocale()]);
  return (
    <ErrorShell
      code="404"
      title={t("notFound.title")}
      message={t("notFound.message")}
      action={{ href: `/${locale}/dashboard`, label: t("back") }}
    />
  );
}
