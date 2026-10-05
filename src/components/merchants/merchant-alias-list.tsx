"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  removeMerchantAliasAction,
  resetMerchantNameAction,
  type MerchantActionState,
} from "@/server/transport/actions/merchants";
import type { MerchantAliasGroup } from "@/lib/insights";
import { MerchantNameDialog } from "./merchant-name-dialog";

export function MerchantAliasList({ aliases }: { aliases: MerchantAliasGroup[] }) {
  const t = useTranslations("merchants");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const names = aliases.map((a) => a.name);

  function run(action: () => Promise<MerchantActionState>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  if (aliases.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      <div className="border-border overflow-hidden rounded-xl border">
        <p className="text-muted-foreground border-b px-4 py-3 text-xs">{t("listHint")}</p>
        {aliases.map((a) => (
          <div
            key={a.name}
            data-slot="merchant-alias-row"
            className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                {a.keys.map((k) => (
                  <span key={k} className="inline-flex items-center gap-0.5">
                    {k}
                    {a.keys.length > 1 && (
                      <button
                        type="button"
                        className="hover:text-foreground -my-1 rounded p-1"
                        aria-label={t("removeKey", { key: k, name: a.name })}
                        disabled={pending}
                        onClick={() => run(() => removeMerchantAliasAction(k))}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <MerchantNameDialog
              target={{ key: null, alias: a.name, keys: a.keys, label: a.name }}
              names={names}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("edit", { name: a.name })}
                  disabled={pending}
                >
                  <Pencil />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("delete", { name: a.name })}
              disabled={pending}
              onClick={() => {
                if (window.confirm(t("deleteConfirm", { name: a.name })))
                  run(() => resetMerchantNameAction(a.name));
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
