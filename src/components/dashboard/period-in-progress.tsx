import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function PeriodInProgress({ previousLabel }: { previousLabel: string }) {
  const t = await getTranslations("dashboard");
  return (
    <p
      data-slot="period-in-progress"
      className="text-muted-foreground flex items-start gap-1.5 text-[12.5px]"
    >
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {t("periodInProgress", { previous: previousLabel })}
    </p>
  );
}
