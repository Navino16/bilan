import { useTranslations } from "next-intl";

export function OrSeparator() {
  const t = useTranslations("auth.login");
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="bg-border h-px flex-1" />
      {t("or")}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}
