import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";
import { getAppName } from "@/server/services/settings/app-settings";

// Catches unmatched paths under a locale (e.g. /fr/nope) — rendered inside the
// [locale] layout, so it's styled + localized. The root app/not-found.tsx covers
// truly top-level (locale-less) misses.
export default async function LocaleNotFound() {
  const [t, tMeta, locale, appName] = await Promise.all([
    getTranslations("errors"),
    getTranslations("meta.titles"),
    getLocale(),
    getAppName(),
  ]);
  return (
    <ErrorShell
      code="404"
      title={t("notFound.title")}
      message={t("notFound.message")}
      action={{ href: `/${locale}/dashboard`, label: t("back") }}
      documentTitle={`${tMeta("notFound")} · ${appName}`}
    />
  );
}
