"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { createLinkAction, ignoreSuggestionAction } from "@/server/transport/actions/links";

export type SuggestionItem = {
  key: string;
  positiveId: string;
  negativeId: string;
  positiveLabel: string;
  negativeLabel: string;
  amount: number;
  dayDelta: number;
  date: string;
};

function Row({ item }: { item: SuggestionItem }) {
  const t = useTranslations("transactions.suggestions");
  const locale = useLocale();
  const router = useRouter();
  const [linkState, linkAction, linkPending] = useActionState(createLinkAction, null);
  const [ignoreState, ignoreAction, ignorePending] = useActionState(ignoreSuggestionAction, null);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  useEffect(() => {
    if (linkState?.ok || ignoreState?.ok) router.refresh();
  }, [linkState, ignoreState, router]);

  return (
    <Card data-slot="suggestion-row" className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{money.format(item.amount)}</div>
        <div className="text-muted-foreground truncate text-[12px]">
          {item.negativeLabel} ↔ {item.positiveLabel} · {t("pairWithin", { days: item.dayDelta })}
        </div>
      </div>
      <form action={linkAction}>
        <input
          type="hidden"
          name="transactionIds"
          value={`${item.positiveId},${item.negativeId}`}
        />
        <button
          type="submit"
          disabled={linkPending}
          className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-50"
        >
          {t("link")}
        </button>
      </form>
      <form action={ignoreAction}>
        <input type="hidden" name="pairKey" value={item.key} />
        <button
          type="submit"
          disabled={ignorePending}
          className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-lg border px-3 text-[0.8rem] disabled:opacity-50"
        >
          {t("ignore")}
        </button>
      </form>
    </Card>
  );
}

export function SuggestionsList({ items }: { items: SuggestionItem[] }) {
  const t = useTranslations("transactions.suggestions");
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <Row key={it.key} item={it} />
      ))}
    </div>
  );
}
