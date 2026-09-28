"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MoreVertical, Pencil, Archive, Share2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountForm } from "@/components/accounts/account-form";
import { ShareDialog, type ShareGroup } from "@/components/accounts/share-dialog";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { VisibleAccount } from "@/server/services/accounts";
import { balanceLegend } from "@/lib/balance-legend";

const OTHERS_COLOR = "var(--ink-3)";
import { archiveAccountAction, revealAccountIbanAction } from "@/server/transport/actions/accounts";

function useMoney() {
  const locale = useLocale();
  return (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function IbanReveal({ id, masked }: { id: string; masked: string }) {
  const t = useTranslations("accounts");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = revealed !== null;

  function toggle() {
    if (shown) {
      setRevealed(null);
      return;
    }
    startTransition(async () => {
      const full = await revealAccountIbanAction(id);
      if (full) setRevealed(full);
    });
  }

  return (
    <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
      <span>{shown ? revealed : masked}</span>
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
    </div>
  );
}

type EditableAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  balance: number;
};

function RowActions({ account, groups }: { account: EditableAccount; groups: ShareGroup[] }) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function archive() {
    if (!window.confirm(t("archiveConfirm"))) return;
    const fd = new FormData();
    fd.set("id", account.id);
    startTransition(async () => {
      const result = await archiveAccountAction(null, fd);
      if (result?.ok) router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={t("edit")} disabled={pending} />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            {t("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShareOpen(true)}>
            <Share2 />
            {t("share")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={archive}>
            <Archive />
            {t("archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountForm mode="edit" account={account} open={editOpen} onOpenChange={setEditOpen} />
      <ShareDialog
        accountId={account.id}
        accountName={account.name}
        groups={groups}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
}

export function AccountList({
  accounts,
  groups,
  categories,
}: {
  accounts: VisibleAccount[];
  groups: ShareGroup[];
  categories: FlatCategory[];
}) {
  const t = useTranslations("accounts");
  const money = useMoney();
  const writableAccounts = accounts
    .filter((a) => a.access === "OWNER" || a.access === "WRITE")
    .map((a) => ({ id: a.id, name: a.name }));
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  const legend = balanceLegend(accounts);
  const segments = [
    ...legend.items
      .filter((a) => a.balance > 0)
      .map((a) => ({ key: a.id, value: a.balance, color: a.color ?? "#2563eb" })),
    ...(legend.others?.positive
      ? [{ key: "others", value: legend.others.positive, color: OTHERS_COLOR }]
      : []),
  ];
  const legendEntries = [
    ...legend.items.map((a) => ({ key: a.id, label: a.name, color: a.color ?? "#2563eb" })),
    ...(legend.others
      ? [
          {
            key: "others",
            label: t("legendOthers", { count: legend.others.count }),
            color: OTHERS_COLOR,
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
          <div className="font-display text-4xl leading-none">{money(total)}</div>
          {legend.positiveTotal > 0 && (
            <>
              <div className="bg-muted flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
                {segments.map((seg) => (
                  <div
                    key={seg.key}
                    style={{
                      width: `${(seg.value / legend.positiveTotal) * 100}%`,
                      backgroundColor: seg.color,
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
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: e.color }}
                    />
                    {e.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {accounts.length === 0 ? (
        <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          {t("empty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id} className="gap-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1 size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color ?? "#2563eb" }}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.name}</span>
                      {a.access !== "OWNER" ? (
                        <Badge variant="secondary">{t(`access.${a.access}`)}</Badge>
                      ) : a.sharedCount > 0 ? (
                        <Badge variant="secondary">{t("shared")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("private")}</Badge>
                      )}
                    </div>
                    {a.bankName && (
                      <div className="text-muted-foreground truncate text-xs">{a.bankName}</div>
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

              <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                <div className="min-w-0">
                  <div className="font-display text-xl">{money(a.balance)}</div>
                  {/* Reserved-height slot so the balance stays aligned across cards
                      whether or not an IBAN is present. */}
                  <div className="mt-0.5 flex h-5 items-center">
                    {a.ibanMasked && <IbanReveal id={a.id} masked={a.ibanMasked} />}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(a.access === "OWNER" || a.access === "WRITE") && (
                    <TransactionForm
                      accounts={writableAccounts}
                      categories={categories}
                      defaultAccountId={a.id}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t("addTransaction")}>
                          <Plus />
                        </Button>
                      }
                    />
                  )}
                  {a.access === "OWNER" && (
                    <RowActions
                      account={{
                        id: a.id,
                        name: a.name,
                        type: a.type,
                        bankName: a.bankName,
                        color: a.color,
                        balance: a.balance,
                      }}
                      groups={groups}
                    />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
