"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Tag } from "lucide-react";
import { CategoryLabel, type CategoryLabelData } from "@/components/transactions/bits";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryChange, CategoryTrend } from "@/lib/insights";
import { Dot, HATCH, ROW_LINK } from "./bits";

const CHART_HEIGHT = 28;

export type ChangeView = CategoryChange & {
  color: string;
  href: string;
  category: CategoryLabelData | undefined;
};
export type TrendView = Omit<CategoryTrend, "children"> & ChangeView & { children: ChangeView[] };

// `months` are the bars' labels; `highlight` flags the bars of the displayed period.
export function CategoryTrends({
  trends,
  uncategorized,
  months,
  highlight,
  inProgress,
  averaged,
  locale,
}: {
  trends: TrendView[];
  uncategorized: { amount: number; href: string } | null;
  months: string[];
  highlight: boolean[];
  inProgress: boolean;
  averaged: boolean;
  locale: string;
}) {
  const t = useTranslations("insights");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [stableOpen, setStableOpen] = useState(false);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const signed = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
  const pct = (c: CategoryChange) =>
    c.reference
      ? formatPercent(c.diff / c.reference, locale, { signed: true })
      : c.current
        ? t("new")
        : "";
  const tone = (diff: number) =>
    diff > 0 ? "var(--expense)" : diff < 0 ? "var(--income)" : "var(--muted-foreground)";
  const fromTo = (c: CategoryChange) =>
    `${averaged ? `${t("historyAverage")} ` : ""}${money.format(c.reference)} → ${money.format(c.current)}`;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const headline = (c: ChangeView) => (
    <div className="flex items-center gap-2 text-sm">
      <Dot color={c.color} />
      <CategoryLabel category={c.category} fallback={t("noCategory")} className="flex-1" />
      <span className="font-semibold tabular-nums" style={{ color: tone(c.diff) }}>
        {c.diff ? signed.format(c.diff) : "="}
      </span>
      <span className="text-muted-foreground w-12 text-right text-[11.5px] tabular-nums">
        {pct(c)}
      </span>
    </div>
  );

  const row = (c: TrendView) => {
    const expandable = c.children.length > 1 || c.children[0]?.categoryId !== c.categoryId;
    const expanded = open.has(c.categoryId);
    const body = (
      <>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{headline(c)}</div>
          {expandable ? (
            <ChevronDown
              aria-hidden
              className={cn(
                "text-muted-foreground size-4 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
            />
          ) : (
            <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
          )}
        </div>
        <div className="flex items-end gap-3 pl-[18px]">
          <span className="text-muted-foreground min-w-0 flex-1 text-[11.5px] tabular-nums">
            {fromTo(c)}
          </span>
          <MiniBars
            trend={c}
            highlight={highlight}
            inProgress={inProgress}
            title={t("trendAverage", { amount: money.format(c.average) })}
            months={months}
            format={(v) => money.format(v)}
          />
        </div>
      </>
    );
    return (
      <li key={c.categoryId} data-slot="trend-row" className="flex flex-col">
        {expandable ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => toggle(c.categoryId)}
            className={cn("flex flex-col gap-1.5 text-left", ROW_LINK)}
          >
            {body}
          </button>
        ) : (
          <Link href={c.href} className={cn("flex flex-col gap-1.5", ROW_LINK)}>
            {body}
          </Link>
        )}
        {expandable && expanded && (
          <ul data-slot="trend-children" className="mt-1 ml-[18px] flex flex-col border-l pl-2">
            {c.children.map((child) => (
              <li key={child.categoryId}>
                <Link href={child.href} className={cn("flex flex-col gap-0.5", ROW_LINK)}>
                  {headline(child)}
                  <span className="text-muted-foreground pl-[18px] text-[11px] tabular-nums">
                    {fromTo(child)}
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={c.href}
                className={cn("text-primary flex items-center gap-1 text-[12.5px]", ROW_LINK)}
              >
                {t("seeTransactions")}
                <ChevronRight aria-hidden className="size-3.5" />
              </Link>
            </li>
          </ul>
        )}
      </li>
    );
  };

  const moving = trends.filter((c) => !c.stable);
  const stable = trends.filter((c) => c.stable);

  return (
    <div className="flex flex-col gap-3">
      {uncategorized && (
        <Link
          href={uncategorized.href}
          data-slot="insights-uncategorized"
          className="hover:bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}
          >
            <Tag className="size-3" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            {t("uncategorized", { amount: money.format(uncategorized.amount) })}
          </span>
          <span className="text-primary shrink-0 text-[12.5px] font-medium">{t("toSort")}</span>
          <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
        </Link>
      )}
      {trends.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noData")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {moving.map(row)}
          {stable.length > 0 && (
            <li data-slot="trend-stable" className="flex flex-col border-t pt-2">
              <button
                type="button"
                aria-expanded={stableOpen}
                onClick={() => setStableOpen((o) => !o)}
                className={cn("flex items-center gap-2 text-left text-sm", ROW_LINK)}
              >
                <span className="font-medium">{t("stable")}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[12px]">
                  {t("stableCount", { count: stable.length })}
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "text-muted-foreground size-4 shrink-0 transition-transform",
                    stableOpen && "rotate-180",
                  )}
                />
              </button>
              {stableOpen && <ul className="mt-2 flex flex-col gap-2.5">{stable.map(row)}</ul>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Each category on its own scale: a common one crushes the small ones (#420).
function MiniBars({
  trend,
  highlight,
  inProgress,
  title,
  months,
  format,
}: {
  trend: TrendView;
  highlight: boolean[];
  inProgress: boolean;
  title: string;
  months: string[];
  format: (v: number) => string;
}) {
  const { values, average, color } = trend;
  const max = Math.max(average, ...values);
  const last = values.length - 1;
  return (
    <div
      aria-hidden
      data-slot="trend-chart"
      title={`${title}\n${values.map((v, i) => `${months[i]}: ${format(v)}`).join("\n")}`}
      className="relative flex w-[120px] shrink-0 items-end gap-px sm:w-[156px]"
      style={{ height: CHART_HEIGHT }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          data-slot="trend-bar"
          className="flex-1 rounded-t-[2px]"
          style={{
            height: v && max ? Math.max(2, (v / max) * CHART_HEIGHT) : 0,
            backgroundColor: color,
            opacity: highlight[i] ? 1 : 0.35,
            ...(inProgress && i === last && { backgroundImage: HATCH }),
          }}
        />
      ))}
      {average > 0 && (
        <span
          aria-hidden
          data-slot="trend-average"
          className="border-foreground/70 absolute inset-x-0 border-t border-dashed"
          style={{ bottom: (average / max) * CHART_HEIGHT }}
        />
      )}
    </div>
  );
}
