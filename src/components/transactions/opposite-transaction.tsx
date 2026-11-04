"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { createOppositeTransactionAction } from "@/server/transport/actions/links";
import type { AccountMeta } from "./transaction-detail";

const ERRORS = new Set([
  "ALREADY_LINKED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SAME_ACCOUNT",
  "TARGET_ARCHIVED",
  "TARGET_FORBIDDEN",
]);

export function oppositeTargets(
  accounts: Record<string, AccountMeta>,
  sourceAccountId: string,
): ({ id: string } & AccountMeta)[] {
  return Object.entries(accounts)
    .filter(([id, a]) => a.owned && !a.archived && id !== sourceAccountId)
    .map(([id, a]) => ({ id, ...a }));
}

// Remount per transaction (key) so the preselection follows the row.
export function OppositeTransaction({
  transactionId,
  amount,
  targets,
}: {
  transactionId: string;
  amount: number;
  targets: ({ id: string } & AccountMeta)[];
}) {
  const t = useTranslations("transactions.opposite");
  const locale = useLocale();
  const router = useRouter();
  const savings = targets.filter((a) => a.type === "SAVINGS");
  const [target, setTarget] = useState(savings.length === 1 ? savings[0].id : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startCreate] = useTransition();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  function create() {
    if (!target) return;
    const fd = new FormData();
    fd.set("transactionId", transactionId);
    fd.set("targetAccountId", target);
    setError(null);
    startCreate(async () => {
      const r = await createOppositeTransactionAction(null, fd);
      if (r?.ok) return router.refresh();
      const code = r?.error;
      setError(code && ERRORS.has(code) ? t(`error.${code}`) : t("failed"));
      if (code === "ALREADY_LINKED" || code === "NOT_FOUND") router.refresh();
    });
  }

  return (
    <div data-slot="opposite-transaction" className="space-y-2">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={t("field")}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-w-0 flex-1"
        >
          <option value="">{t("choose")}</option>
          {targets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!target || pending}
          onClick={create}
        >
          {t("create")}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t("hint", { amount: nf.format(-amount) })}</p>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
