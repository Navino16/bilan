import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import type { ImportHistoryItem } from "@/server/services/imports/revert";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { ImportHistoryActions } from "./import-history-actions";

function StatusBadge({ status, label }: { status: ImportHistoryItem["status"]; label: string }) {
  return status === "REVERTED" ? (
    <span className="border-border text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-[11.5px]">
      {label}
    </span>
  ) : (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px]"
      style={{ background: "var(--income-bg)", color: "var(--income)" }}
    >
      {label}
    </span>
  );
}

export async function ImportHistory({ items }: { items: ImportHistoryItem[] }) {
  const t = await getTranslations("import.history");

  return (
    <Card className="gap-4 p-6 text-left" data-slot="import-history">
      <div>
        <div className={overline}>{t("overline")}</div>
        <div className="font-display text-xl">{t("title")}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li
              key={it.id}
              data-slot="import-history-row"
              className="bg-muted flex items-center gap-2.5 rounded-lg px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{it.filename ?? it.source}</span>
                  <StatusBadge status={it.status} label={t(`status.${it.status}`)} />
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-[11.5px]">
                  {it.source} · <LocalDateTime value={it.createdAt} />
                  {it.accountNames.map((name) => ` · ${name}`)}
                </div>
                <div className="text-muted-foreground text-[11.5px]">
                  {t("rows", { imported: it.importedRows, skipped: it.skippedRows })}
                </div>
              </div>
              {it.status === "COMPLETED" ? (
                <ImportHistoryActions batchId={it.id} />
              ) : (
                <span aria-hidden className="size-8 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
