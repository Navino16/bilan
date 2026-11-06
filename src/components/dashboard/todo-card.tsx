import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { formatMoney } from "@/lib/format";
import { transactionsHref } from "@/lib/transaction-filters";
import type { Period } from "@/lib/period";
import type { DashboardData } from "@/server/services/dashboard";

// What needs the user's attention in the displayed period; nothing renders when all is done.
export async function TodoCard({
  uncategorized,
  period,
  locale,
}: {
  uncategorized: DashboardData["uncategorized"];
  period: Period;
  locale: string;
}) {
  const items = (["out", "in"] as const).filter((dir) => uncategorized[dir].count > 0);
  if (items.length === 0) return null;
  const t = await getTranslations("dashboard.todo");
  return (
    <Card className="gap-3 p-4.5 md:p-6" data-slot="dashboard-todo">
      <div>
        <div className={overline}>{t("overline")}</div>
        <div className="font-display text-xl">{t("title")}</div>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((dir) => (
          <Link
            key={dir}
            href={transactionsHref(locale, period, { dir, categoryId: null })}
            data-slot="dashboard-todo-item"
            className="hover:bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-2.5"
          >
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full"
              style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}
            >
              <Tag className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-sm">
              {t(dir === "out" ? "uncategorizedOut" : "uncategorizedIn", {
                count: uncategorized[dir].count,
              })}
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {formatMoney(
                dir === "out" ? -uncategorized[dir].amount : uncategorized[dir].amount,
                locale,
              )}
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </Link>
        ))}
      </div>
    </Card>
  );
}
