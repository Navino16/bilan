import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";
import { getAppName } from "@/server/services/settings/app-settings";

export default async function NotFound() {
  const [t, tMeta, locale, appName] = await Promise.all([
    getTranslations("errors"),
    getTranslations("meta.titles"),
    getLocale(),
    getAppName(),
  ]);
  return (
    <ErrorShell
      landmark={false}
      code="404"
      title={t("notFound.title")}
      message={t("notFound.message")}
      action={{ href: `/${locale}/dashboard`, label: t("back") }}
      documentTitle={`${tMeta("notFound")} · ${appName}`}
    />
  );
}
