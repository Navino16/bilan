import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";

export default async function Unauthorized() {
  const [t, locale] = await Promise.all([getTranslations("errors"), getLocale()]);
  return (
    <ErrorShell
      code="401"
      title={t("unauthorized.title")}
      message={t("unauthorized.message")}
      action={{ href: `/${locale}/login`, label: t("back") }}
    />
  );
}
