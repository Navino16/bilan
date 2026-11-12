import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight, Tag, Unlink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { transactionsHref } from "@/lib/transaction-filters";
import type { Period } from "@/lib/period";
import type { DashboardData } from "@/server/services/dashboard";

const ITEM = "flex items-center gap-3 rounded-lg border px-3 py-2.5";

// What needs the user's attention in the displayed period; nothing renders when all is done.
export async function TodoCard({
  uncategorized,
  neutral,
  period,
  locale,
}: {
  uncategorized: DashboardData["uncategorized"];
  neutral: DashboardData["neutral"];
  period: Period;
  locale: string;
}) {
  const t = await getTranslations("dashboard.todo");
  const items = [
    ...(["out", "in"] as const)
      .filter((dir) => uncategorized[dir].count > 0)
      .map((dir) => ({
        key: dir,
        icon: Tag,
        label: t(dir === "out" ? "uncategorizedOut" : "uncategorizedIn", {
          count: uncategorized[dir].count,
        }),
        amount: formatMoney(
          dir === "out" ? -uncategorized[dir].amount : uncategorized[dir].amount,
          locale,
        ),
        href: transactionsHref(locale, period, { dir, categoryId: null }),
      })),
    ...(neutral.count > 0
      ? [
          {
            key: "neutral",
            icon: Unlink,
            label: t("unlinkedNeutral", { count: neutral.count }),
            amount: formatMoney(neutral.amount, locale),
            href: neutral.categoryId
              ? transactionsHref(locale, period, { categoryId: neutral.categoryId })
              : null,
          },
        ]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <Card
      className="gap-3 p-4.5 md:flex-row md:items-center md:gap-6 md:px-6 md:py-4"
      data-slot="dashboard-todo"
    >
      <div className="font-display shrink-0 text-xl">{t("title")}</div>
      <div className="flex min-w-0 flex-col gap-2 md:flex-1">
        {items.map(({ key, icon: Icon, label, amount, href }) => {
          const body = (
            <>
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full"
                style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-sm">{label}</span>
              <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
              {href && (
                <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              )}
            </>
          );
          return href ? (
            <Link
              key={key}
              href={href}
              data-slot="dashboard-todo-item"
              className={`${ITEM} hover:bg-muted/60`}
            >
              {body}
            </Link>
          ) : (
            <div key={key} data-slot="dashboard-todo-item" className={ITEM}>
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
