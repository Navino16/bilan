import { getTranslations } from "next-intl/server";
import { formatPeriodLabel, type Comparison } from "@/lib/period";
import { PeriodInProgress } from "./period-in-progress";

// Explains the same-date cut while the period is in progress, or what an upcoming one holds.
export async function ComparisonNote({
  comparison,
  locale,
}: {
  comparison: Comparison;
  locale: string;
}) {
  const t = await getTranslations("dashboard");
  if (comparison.upcoming) return <PeriodInProgress>{t("upcoming")}</PeriodInProgress>;
  if (!comparison.elapsedDays) return null;
  return (
    <PeriodInProgress>
      {comparison.months.length > 0
        ? t("inProgressAvg", { day: comparison.elapsedDays })
        : t("inProgressPrev", { previous: formatPeriodLabel(comparison.previous, locale) })}
    </PeriodInProgress>
  );
}
