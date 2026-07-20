import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";

export default async function Forbidden() {
  const [t, locale] = await Promise.all([getTranslations("errors"), getLocale()]);
  return (
    <ErrorShell
      code="403"
      title={t("forbidden.title")}
      message={t("forbidden.message")}
      action={{ href: `/${locale}/dashboard`, label: t("back") }}
    />
  );
}
