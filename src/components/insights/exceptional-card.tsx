import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CategoryLabel, type CategoryLabelData } from "@/components/transactions/bits";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { EXCEPTIONAL_MIN_AMOUNT, type ExceptionalExpense } from "@/lib/exceptional";
import type { InsightsData } from "@/lib/insights";
import { CardTitle, ROW_LINK } from "./bits";
import { ShowAll } from "./show-all";

const EXCEPTIONAL_SHOWN = 8;

export async function ExceptionalCard({
  exceptional,
  categoryOf,
  hrefOf,
  locale,
}: {
  exceptional: InsightsData["exceptional"];
  categoryOf: (id: string | null) => CategoryLabelData | undefined;
  hrefOf: (expense: ExceptionalExpense) => string;
  locale: string;
}) {
  const t = await getTranslations("insights");
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const rounded = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const { expenses, total, share } = exceptional;

  const row = (e: ExceptionalExpense) => (
    <li key={e.id} data-slot="exceptional-row">
      <Link
        href={hrefOf(e)}
        title={t("exceptionalAverageTitle", { amount: rounded.format(e.average) })}
        className={cn("flex flex-col gap-0.5", ROW_LINK)}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="min-w-0 truncate">{e.label}</span>
          <span className="ml-auto shrink-0 pl-1 font-semibold tabular-nums">
            {money.format(e.amount)}
          </span>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-[11.5px]">
          <CategoryLabel
            category={categoryOf(e.categoryId)}
            fallback={t("noCategory")}
            className="flex-1"
          />
          <span className="shrink-0 tabular-nums">
            {t("exceptionalMeta", {
              date: day.format(e.date),
              average: rounded.format(e.average),
            })}
          </span>
        </div>
      </Link>
    </li>
  );

  return (
    <Card className="gap-4 p-4.5 md:p-6" data-slot="insights-exceptional">
      <CardTitle
        title={t("exceptionalTitle")}
        sub={t("exceptionalSub", { amount: rounded.format(EXCEPTIONAL_MIN_AMOUNT) })}
      />
      {expenses.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noExceptional")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-display text-2xl tabular-nums">{money.format(total)}</span>
            <span data-slot="exceptional-share" className="text-muted-foreground text-[12px]">
              {t("exceptionalShare", { share: formatPercent(share, locale) })}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
            {expenses.slice(0, EXCEPTIONAL_SHOWN).map(row)}
            {expenses.length > EXCEPTIONAL_SHOWN && (
              <ShowAll
                label={t("exceptionalShowAll", { count: expenses.length })}
                lessLabel={t("exceptionalShowLess")}
              >
                {expenses.slice(EXCEPTIONAL_SHOWN).map(row)}
              </ShowAll>
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
