import { getTranslations } from "next-intl/server";
import { formatPeriodLabel, type Comparison } from "@/lib/period";
import { PeriodInProgress } from "./period-in-progress";

// Explains the same-date cut while the period is in progress; nothing once it is over.
export async function ComparisonNote({
  comparison,
  locale,
}: {
  comparison: Comparison;
  locale: string;
}) {
  if (!comparison.elapsedDays) return null;
  const t = await getTranslations("dashboard");
  return (
    <PeriodInProgress>
      {comparison.months.length > 0
        ? t("inProgressAvg", { day: comparison.elapsedDays })
        : t("inProgressPrev", { previous: formatPeriodLabel(comparison.previous, locale) })}
    </PeriodInProgress>
  );
}
