"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { assignedMonth, monthChoices, type YearMonth } from "@/lib/assigned-month";
import { formatMonthYear } from "@/lib/format";
import { setTransactionMonthAction } from "@/server/transport/actions/transactions";
import { Pill } from "./bits";

type DateLike = Date | string;

const toDate = (d: DateLike) => (typeof d === "string" ? new Date(d) : d);

// "Counted in <month>" when the transaction counts toward another month than its date (#341).
export function AssignedMonthBadge({ date, periodDate }: { date: DateLike; periodDate: DateLike }) {
  const t = useTranslations("transactions.assignedMonth");
  const locale = useLocale();
  const month = assignedMonth(toDate(date), toDate(periodDate));
  if (!month) return null;
  const first = new Date(Date.UTC(month.year, month.month - 1, 1));
  return (
    <Pill className="text-foreground">
      {t("countedIn", { month: formatMonthYear(first, locale) })}
    </Pill>
  );
}

const monthValue = (m: YearMonth) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const monthOf = (d: Date): YearMonth => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });

export function AssignedMonthField({
  id,
  date,
  periodDate,
  periodManual,
}: {
  id: string;
  date: DateLike;
  periodDate: DateLike;
  periodManual: boolean;
}) {
  const t = useTranslations("transactions.assignedMonth");
  const locale = useLocale();
  const current = monthValue(monthOf(toDate(periodDate)));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function save(month: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("month", month);
    startTransition(async () => {
      const r = await setTransactionMonthAction(null, fd);
      setFailed(!r?.ok);
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={t("label")}
          value={current}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
          className="w-48"
        >
          {monthChoices(toDate(date), toDate(periodDate)).map((m) => (
            <option key={monthValue(m)} value={monthValue(m)}>
              {formatMonthYear(new Date(Date.UTC(m.year, m.month - 1, 1)), locale)}
            </option>
          ))}
        </NativeSelect>
        {periodManual && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => save("")}
          >
            {t("backToAuto")}
          </Button>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-destructive text-xs">
          {t("failed")}
        </p>
      )}
    </div>
  );
}
