"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import type { SyncedAccountInfo } from "@/server/services/bank-sync/status";
import { syncNowAction, type SyncNowState } from "@/server/transport/actions/bank-sync";

const noop = () => () => {};
const SYNCABLE = ["ACTIVE", "ERROR"];

// The server renders the day; the browser switches to a relative time, which depends on its clock.
function useSyncedAgo(at: Date | null): string | null {
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!at) return null;
  return inBrowser ? format.relativeTime(at, now) : formatDate(at, locale);
}

export function BankSyncStatus({ info }: { info: SyncedAccountInfo }) {
  const t = useTranslations("accounts.bankSync");
  const locale = useLocale();
  const router = useRouter();
  const [result, setResult] = useState<SyncNowState | null>(null);
  const [pending, startTransition] = useTransition();
  const ago = useSyncedAgo(info.lastSyncAt);

  function syncNow() {
    setResult(null);
    startTransition(async () => {
      let res: SyncNowState;
      try {
        res = await syncNowAction(info.connectionId);
      } catch {
        res = { ok: false, error: "FAILED" };
      }
      setResult(res);
      router.refresh();
    });
  }

  const errorText = (code: string) =>
    code === "RATE_LIMITED_LOCAL"
      ? t("status.tooSoon")
      : t.has(`error.${code}`)
        ? t(`error.${code as "FAILED"}`)
        : t("error.FAILED");

  return (
    <div className="space-y-1 pt-2 text-xs" data-slot="bank-sync-status">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {ago
            ? t("status.synced", { ago, bank: info.aspspName })
            : t("status.neverSynced", { bank: info.aspspName })}
        </span>
        {info.status !== "ACTIVE" && (
          <Badge variant="destructive">{t(`connections.status.${info.status as "ACTIVE"}`)}</Badge>
        )}
      </div>
      {info.pendingCount > 0 && (
        <div className="text-muted-foreground" data-slot="bank-sync-pending">
          {t("status.pending", {
            count: info.pendingCount,
            total: formatMoney(info.pendingTotal, locale),
          })}
        </div>
      )}
      {info.lastError && !result && (
        <div className="text-destructive" data-slot="bank-sync-error">
          {errorText(info.lastError)}
        </div>
      )}
      {SYNCABLE.includes(info.status) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={syncNow} disabled={pending}>
            <RefreshCw className={pending ? "animate-spin" : undefined} />
            {pending ? t("status.syncing") : t("status.syncNow")}
          </Button>
          {result && (
            <span
              role="status"
              data-slot="bank-sync-result"
              className={result.ok ? "text-muted-foreground" : "text-destructive"}
            >
              {result.ok
                ? [
                    t("status.done", { count: result.imported }),
                    result.truncated && t("status.truncated"),
                  ]
                    .filter(Boolean)
                    .join(" ")
                : errorText(result.error)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
