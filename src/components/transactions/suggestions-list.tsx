"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import {
  createLinkAction,
  ignoreSuggestionAction,
  restoreSuggestionAction,
} from "@/server/transport/actions/links";
import type { IgnoredPairView, PairLeg, SuggestedPairView } from "@/server/services/links";
import { useLinkErrorMessage } from "./link-error";
import { formatDate } from "@/lib/format";

const buttonPrimary =
  "bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-50";
const buttonOutline =
  "border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-lg border px-3 text-[0.8rem] disabled:opacity-50";

function useFormats() {
  const locale = useLocale();
  return {
    money: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    day: (d: string | Date) => formatDate(d, locale),
  };
}

function Legs({ negative, positive }: { negative: PairLeg; positive: PairLeg }) {
  const { day } = useFormats();
  const leg = (l: PairLeg, sign: "−" | "+") => (
    <li className="flex min-w-0 items-baseline gap-2 text-[12px]">
      <span aria-hidden className="text-muted-foreground w-3 shrink-0 tabular-nums">
        {sign}
      </span>
      {/* Narrow cards: the account · date drop below the label instead of squeezing it. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span data-slot="leg-label" className="max-w-full min-w-0 truncate" title={l.label}>
          {l.label}
        </span>
        <span className="text-muted-foreground min-w-0 wrap-anywhere">
          {l.accountName} · {day(l.date)}
        </span>
      </span>
    </li>
  );
  return (
    <ul className="mt-1 space-y-0.5">
      {leg(negative, "−")}
      {leg(positive, "+")}
    </ul>
  );
}

function Row({ item }: { item: SuggestedPairView }) {
  const t = useTranslations("transactions.suggestions");
  const linkErrorMessage = useLinkErrorMessage();
  const router = useRouter();
  const [linkState, linkAction, linkPending] = useActionState(createLinkAction, null);
  const [ignoreState, ignoreAction, ignorePending] = useActionState(ignoreSuggestionAction, null);
  const { money } = useFormats();

  useEffect(() => {
    if (linkState?.ok || ignoreState?.ok) router.refresh();
  }, [linkState, ignoreState, router]);

  const failure =
    linkState?.ok === false
      ? linkErrorMessage(linkState.error)
      : ignoreState?.ok === false
        ? t("ignoreFailed")
        : null;

  return (
    // The flex row lives on an inner div: shadcn `Card` sets `flex-col` on its
    // own element, which would otherwise stack the amount + buttons vertically.
    <Card data-slot="suggestion-row" className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="truncate text-sm font-medium">
            {money.format(item.amount)}
            <span className="text-muted-foreground text-[12px] font-normal">
              {" "}
              · {t("pairWithin", { days: item.dayDelta })}
            </span>
          </div>
          <Legs negative={item.negative} positive={item.positive} />
        </div>
        <form action={linkAction}>
          <input
            type="hidden"
            name="transactionIds"
            value={`${item.positiveId},${item.negativeId}`}
          />
          <button type="submit" disabled={linkPending} className={buttonPrimary}>
            {t("link")}
          </button>
        </form>
        <form action={ignoreAction}>
          <input type="hidden" name="pairKey" value={item.key} />
          <button type="submit" disabled={ignorePending} className={buttonOutline}>
            {t("ignore")}
          </button>
        </form>
      </div>
      {failure && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {failure}
        </p>
      )}
    </Card>
  );
}

function IgnoredRow({ item }: { item: IgnoredPairView }) {
  const t = useTranslations("transactions.suggestions");
  const router = useRouter();
  const [state, action, pending] = useActionState(restoreSuggestionAction, null);
  const { money } = useFormats();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <Card data-slot="ignored-row" className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="truncate text-sm font-medium">{money.format(item.amount)}</div>
          <Legs negative={item.negative} positive={item.positive} />
        </div>
        <form action={action}>
          <input type="hidden" name="pairKey" value={item.key} />
          <button type="submit" disabled={pending} className={buttonOutline}>
            {t("restore")}
          </button>
        </form>
      </div>
      {state?.ok === false && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {t("restoreFailed")}
        </p>
      )}
    </Card>
  );
}

export function SuggestionsList({
  items,
  ignored = [],
}: {
  items: SuggestedPairView[];
  ignored?: IgnoredPairView[];
}) {
  const t = useTranslations("transactions.suggestions");
  return (
    <div className="space-y-6">
      {items.length === 0 ? (
        <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          {t("empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <Row key={it.key} item={it} />
          ))}
        </div>
      )}
      {ignored.length > 0 && (
        <details data-slot="ignored-suggestions" className="space-y-2">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
            {t("ignored", { count: ignored.length })}
          </summary>
          <p className="text-muted-foreground mt-2 text-xs">{t("ignoredHint")}</p>
          <div className="mt-2 flex flex-col gap-2">
            {ignored.map((it) => (
              <IgnoredRow key={it.key} item={it} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
