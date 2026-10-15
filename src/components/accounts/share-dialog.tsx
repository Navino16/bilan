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
import { NativeSelect } from "@/components/ui/native-select";

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
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
      let result;
      if (value === "NONE") {
        result = await revokeShareAction(null, fd);
      } else {
        fd.set("permission", value);
        result = await shareAccountAction(null, fd);
      }
      if (!result?.ok) return setError(result?.error ?? "FAILED");
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
        <DialogHeader className="border-border shrink-0 border-b pt-5 pr-14 pb-4 pl-6 text-left">
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] wrap-anywhere uppercase">
            {accountName}
          </span>
          <DialogTitle className="font-display text-2xl">{t("shareTitle")}</DialogTitle>
          <DialogDescription>{t("shareSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t(`error.${error}`)}
            </p>
          )}
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noGroups")}</p>
          ) : (
            <div className="border-border divide-border divide-y rounded-lg border">
              {groups.map((g) => (
                <div
                  key={g.id}
                  data-slot="share-row"
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
                >
                  <span className="min-w-0 flex-auto text-sm font-medium wrap-anywhere">
                    {g.name}
                  </span>
                  <NativeSelect
                    className="ml-auto shrink-0"
                    aria-label={g.name}
                    value={shares[g.id] ?? "NONE"}
                    disabled={pending}
                    onChange={(e) => change(g.id, e.target.value)}
                    size="sm"
                  >
                    <option value="NONE">{t("permNone")}</option>
                    <option value="READ">{t("access.READ")}</option>
                    <option value="WRITE">{t("access.WRITE")}</option>
                  </NativeSelect>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
