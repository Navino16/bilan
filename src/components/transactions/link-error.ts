import { useTranslations } from "next-intl";

const LINK_ERRORS = new Set(["ALREADY_LINKED", "FORBIDDEN", "NOT_FOUND", "TOO_FEW"]);

export function useLinkErrorMessage(): (code: string | undefined) => string {
  const t = useTranslations("transactions.link");
  return (code) => (code && LINK_ERRORS.has(code) ? t(`error.${code}`) : t("failed"));
}
