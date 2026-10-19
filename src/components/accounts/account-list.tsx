"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, EyeOff, Landmark, Plus } from "lucide-react";
import { AccountForm } from "@/components/accounts/account-form";
import { EmptyState } from "@/components/shell/empty-state";
import { writableActiveAccounts } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AccountRowActions } from "@/components/accounts/account-row-actions";
import type { ShareGroup } from "@/components/accounts/share-dialog";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { VisibleAccount } from "@/server/services/accounts";
import { balanceLegend, balanceSegments } from "@/lib/balance-legend";
import { revealAccountIbanAction } from "@/server/transport/actions/accounts";
import type { StepUpMethod } from "@/server/services/users/step-up";
import {
  StepUpDialog,
  useStepUpErrorText,
  type StepUpFailure,
} from "@/components/auth/step-up-dialog";

const OTHERS_COLOR = "var(--cat-other)";

// Negative balances are hatched in their account colour.
function swatch(color: string, negative: boolean): string {
  return negative
    ? `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 4px)`
    : color;
}

function useMoney() {
  const locale = useLocale();
  return (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function IbanReveal({ id, masked }: { id: string; masked: string }) {
  const t = useTranslations("accounts");
  const errorText = useStepUpErrorText();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [reauth, setReauth] = useState<StepUpMethod | null>(null);
  const [failure, setFailure] = useState<StepUpFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = revealed !== null;

  async function revealWithPassword(password: string): Promise<{ ok: true } | StepUpFailure> {
    const res = await revealAccountIbanAction(id, password);
    if (res.ok) setRevealed(res.iban);
    return res;
  }

  function toggle() {
    setFailure(null);
    if (shown) {
      setRevealed(null);
      return;
    }
    startTransition(async () => {
      try {
        const res = await revealAccountIbanAction(id);
        if (res.ok) setRevealed(res.iban);
        else if (res.error === "REAUTH_REQUIRED") setReauth(res.method);
        else setFailure(res);
      } catch {
        setFailure({ ok: false, error: "FAILED" });
      }
    });
  }

  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 font-mono text-xs">
      <span data-slot="account-iban">{shown ? revealed : masked}</span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={shown ? t("hideIban") : t("showIban")}
        aria-pressed={shown}
        className="hover:text-foreground inline-flex items-center transition-colors disabled:opacity-50"
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
      {failure && (
        <span role="alert" className="text-destructive truncate font-sans">
          {errorText(failure)}
        </span>
      )}
      {reauth && (
        <StepUpDialog
          method={reauth}
          purpose="iban"
          confirm={revealWithPassword}
          onConfirmed={() => setReauth(null)}
          onClose={() => setReauth(null)}
        />
      )}
    </div>
  );
}

type CardProps = {
  groups: ShareGroup[];
  categories: FlatCategory[];
  writableAccounts: { id: string; name: string }[];
};

function AccountCard({
  account: a,
  groups,
  categories,
  writableAccounts,
}: CardProps & { account: VisibleAccount }) {
  const t = useTranslations("accounts");
  const money = useMoney();
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: a.color ?? "#2563eb" }}
          />
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate font-medium" title={a.name}>
                {a.name}
              </span>
              {a.archived ? (
                <Badge variant="outline">{t("archivedBadge")}</Badge>
              ) : a.access !== "OWNER" ? (
                <Badge variant="secondary">{t(`access.${a.access}`)}</Badge>
              ) : a.sharedCount > 0 ? (
                <Badge variant="secondary">{t("shared")}</Badge>
              ) : (
                <Badge variant="outline">{t("private")}</Badge>
              )}
            </div>
            {a.bankName && (
              <div className="text-muted-foreground truncate text-xs" title={a.bankName}>
                {a.bankName}
              </div>
            )}
            {a.access !== "OWNER" && a.ownerName && (
              <div className="text-muted-foreground text-xs">
                {t("sharedBy", { name: a.ownerName })}
              </div>
            )}
          </div>
        </div>
        <Badge variant="outline">{t(`types.${a.type}`)}</Badge>
      </div>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
        <div className="min-w-0">
          <div
            data-slot="account-balance"
            className="font-display text-xl"
            style={a.balance < 0 ? { color: "var(--expense)" } : undefined}
          >
            {money(a.balance)}
          </div>
          {/* Reserved-height slot so the balance stays aligned across cards
              whether or not an IBAN is present. */}
          <div className="mt-0.5 flex h-5 items-center">
            {a.ibanMasked && <IbanReveal id={a.id} masked={a.ibanMasked} />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!a.archived && (a.access === "OWNER" || a.access === "WRITE") && (
            <TransactionForm
              accounts={writableAccounts}
              categories={categories}
              defaultAccountId={a.id}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus />
                  {t("addTransaction")}
                </Button>
              }
            />
          )}
          {a.access === "OWNER" && (
            <AccountRowActions
              account={{
                id: a.id,
                name: a.name,
                type: a.type,
                bankName: a.bankName,
                color: a.color,
                initialBalance: a.initialBalance,
                ibanMasked: a.ibanMasked,
                archived: a.archived,
              }}
              groups={groups}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

export function AccountList({
  accounts: allAccounts,
  groups,
  categories,
}: {
  accounts: VisibleAccount[];
  groups: ShareGroup[];
  categories: FlatCategory[];
}) {
  const t = useTranslations("accounts");
  const tOnboarding = useTranslations("onboarding");
  const money = useMoney();
  const archived = allAccounts.filter((a) => a.archived);
  const accounts = allAccounts.filter((a) => !a.archived);
  const writableAccounts = writableActiveAccounts(accounts).map((a) => ({
    id: a.id,
    name: a.name,
  }));
  const cardProps = { groups, categories, writableAccounts };
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  const legend = balanceLegend(accounts);
  const colorOf = new Map(legend.items.map((a) => [a.id, a.color ?? "#2563eb"]));
  colorOf.set("others", OTHERS_COLOR);
  const segments = balanceSegments(legend);
  const legendEntries = [
    ...legend.items.map((a) => ({
      key: a.id,
      label: a.name,
      color: colorOf.get(a.id)!,
      negative: a.balance < 0,
    })),
    ...(legend.others
      ? [
          {
            key: "others",
            label: t("legendOthers", { count: legend.others.count }),
            color: OTHERS_COLOR,
            negative: legend.others.positive === 0 && legend.others.negative > 0,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {accounts.length > 0 && (
        <Card className="gap-3 p-5">
          <div className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {t("globalBalance")}
          </div>
          <div
            data-slot="global-balance"
            className="font-display text-4xl leading-none"
            style={total < 0 ? { color: "var(--expense)" } : undefined}
          >
            {money(total)}
          </div>
          {segments.length > 0 && (
            <>
              <div
                data-slot="balance-bar"
                className="bg-muted flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
              >
                {segments.map((seg) => (
                  <div
                    key={`${seg.id}${seg.negative ? "-" : "+"}`}
                    data-negative={seg.negative || undefined}
                    style={{
                      width: `${seg.share * 100}%`,
                      background: swatch(colorOf.get(seg.id)!, seg.negative),
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1" data-slot="balance-legend">
                {legendEntries.map((e) => (
                  <span
                    key={e.key}
                    className="text-muted-foreground flex items-center gap-1.5 text-xs"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: swatch(e.color, e.negative) }}
                    />
                    {e.label}
                  </span>
                ))}
                {legend.negativeTotal > 0 && (
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: swatch(OTHERS_COLOR, true) }}
                    />
                    {t("legendNegative")}
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={tOnboarding("accounts.title")}
          body={tOnboarding("accounts.body")}
          actions={
            <AccountForm
              mode="create"
              trigger={
                <Button>
                  <Plus />
                  {tOnboarding("accounts.cta")}
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} {...cardProps} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section className="space-y-3 pt-2" data-slot="archived-accounts">
          <div>
            <h2 className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
              {t("archivedTitle", { count: archived.length })}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">{t("archivedHint")}</p>
          </div>
          <div className="grid gap-3 opacity-80 sm:grid-cols-2">
            {archived.map((a) => (
              <AccountCard key={a.id} account={a} {...cardProps} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
