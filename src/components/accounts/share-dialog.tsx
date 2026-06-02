"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  shareAccountAction,
  revokeShareAction,
  listSharesAction,
} from "@/server/transport/actions/accounts";

export type ShareGroup = { id: string; name: string };

export function ShareDialog({
  accountId,
  accountName,
  groups,
  open,
  onOpenChange,
}: {
  accountId: string;
  accountName: string;
  groups: ShareGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [shares, setShares] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let active = true;
    listSharesAction(accountId).then((rows) => {
      if (active) setShares(Object.fromEntries(rows.map((r) => [r.groupId, r.permission])));
    });
    return () => {
      active = false;
    };
  }, [open, accountId]);

  function change(groupId: string, value: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("accountId", accountId);
      fd.set("groupId", groupId);
      if (value === "NONE") {
        await revokeShareAction(null, fd);
      } else {
        fd.set("permission", value);
        await shareAccountAction(null, fd);
      }
      setShares((s) => {
        const next = { ...s };
        if (value === "NONE") delete next[groupId];
        else next[groupId] = value;
        return next;
      });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {accountName}
          </span>
          <DialogTitle className="font-display text-2xl">{t("shareTitle")}</DialogTitle>
          <DialogDescription>{t("shareSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noGroups")}</p>
          ) : (
            <div className="border-border divide-border divide-y rounded-lg border">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="truncate text-sm font-medium">{g.name}</span>
                  <select
                    aria-label={g.name}
                    value={shares[g.id] ?? "NONE"}
                    disabled={pending}
                    onChange={(e) => change(g.id, e.target.value)}
                    className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                  >
                    <option value="NONE">{t("permNone")}</option>
                    <option value="READ">{t("access.READ")}</option>
                    <option value="WRITE">{t("access.WRITE")}</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
