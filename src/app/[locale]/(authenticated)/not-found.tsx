import { getTranslations, getLocale } from "next-intl/server";
import { ErrorShell } from "@/components/shell/error-shell";

export default async function NotFound() {
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
