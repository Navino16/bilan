"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useNow } from "next-intl";
import { OrdinalText } from "@/components/ordinal-text";
import { listHeader } from "@/components/shell/section-card";
import { formatLongDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ActivityEntry = { id: string; at: Date; action: string; clientName: string };

const noop = () => () => {};
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

// The server can't know the viewer's time zone: its HTML groups by UTC day without times,
// then the browser regroups by local day and names today and yesterday (as LocalDateTime).
export function ActivityTimeline({
  entries,
  today,
  yesterday,
}: {
  entries: ActivityEntry[];
  today: string;
  yesterday: string;
}) {
  const locale = useLocale();
  const now = useNow();
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const dayOf = inBrowser ? localDay : utcDay;
  const groups: { day: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayOf(entry.at);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  const relative = new Map<string, string>();
  if (inBrowser) {
    relative.set(localDay(now), today);
    relative.set(
      localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
      yesterday,
    );
  }
  const thisYear = inBrowser ? String(now.getFullYear()) : null;
  const dayLabel = (day: string) =>
    relative.get(day) ??
    formatLongDay(day, locale, { year: thisYear === null || !day.startsWith(thisYear) });
  const twelveHour = /h1[12]/.test(
    new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle ?? "",
  );

  return (
    <div data-slot="mcp-activity">
      {groups.map((group) => (
        <section key={group.day} className="border-t first:border-t-0">
          <h3 className={listHeader}>
            <time dateTime={group.day}>
              <OrdinalText text={dayLabel(group.day)} />
            </time>
          </h3>
          <ul>
            {group.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-baseline gap-3 border-t px-4 py-2 first:border-t-0 sm:px-6"
              >
                <time
                  dateTime={entry.at.toISOString()}
                  className={cn(
                    "text-muted-foreground shrink-0 text-xs tabular-nums",
                    twelveHour ? "w-14" : "w-10",
                  )}
                >
                  {inBrowser && formatTime(entry.at, locale)}
                </time>
                <span className="min-w-0 flex-1 text-sm">{entry.action}</span>
                <span
                  className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs"
                  title={entry.clientName}
                >
                  {entry.clientName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
