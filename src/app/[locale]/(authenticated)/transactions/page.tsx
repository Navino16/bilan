import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { listLinkedTxIds } from "@/server/services/links";
import { flattenCategories } from "@/components/transactions/category-tree";
import { parsePeriodParams } from "@/lib/period";
import {
  TransactionList,
  type ListItem,
  type AccountOption,
} from "@/components/transactions/transaction-list";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const user = await requireSession();
  const t = await getTranslations("transactions");

  const direction = sp.dir === "in" || sp.dir === "out" ? sp.dir : undefined;
  // A from/to range narrows the list; with no params the list stays unfiltered
  // (all transactions), preserving the default "show everything" behaviour.
  const period = sp.from || sp.to ? parsePeriodParams({ from: sp.from, to: sp.to }) : undefined;

  const [{ items, total }, tree, accounts, linkedIds] = await Promise.all([
    listTransactions(user.id, {
      categoryId: sp.categoryId,
      direction,
      search: sp.search,
      from: period?.from,
      to: period?.to,
    }),
    listForUser(user.id),
    listVisibleForUser(user.id),
    listLinkedTxIds(user.id),
  ]);

  const flatCategories = flattenCategories(tree);
  const accountOptions: AccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    bankName: a.bankName,
  }));
  const formAccounts = accounts.map((a) => ({ id: a.id, name: a.name }));
  const listItems: ListItem[] = items.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    amount: i.amount,
    type: i.type,
    label: i.label,
    rawLabel: i.rawLabel,
    note: i.note,
    accountId: i.accountId,
    accountName: i.accountName,
    categoryId: i.categoryId,
    linked: linkedIds.has(i.id),
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {t("opCount", { count: total })}
          </div>
          <h1 className="font-display text-3xl leading-none">{t("title")}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/${locale}/transactions/suggestions`}
            className="text-primary text-sm hover:underline"
          >
            {t("suggestions.open")}
          </Link>
          {accountOptions.length === 0 ? (
            <Button disabled>
              <Plus />
              {t("create")}
            </Button>
          ) : (
            <TransactionForm
              accounts={formAccounts}
              categories={flatCategories}
              trigger={
                <Button>
                  <Plus />
                  {t("create")}
                </Button>
              }
            />
          )}
        </div>
      </header>
      <TransactionFilters categories={flatCategories} from={sp.from} to={sp.to} />
      <TransactionList items={listItems} categories={flatCategories} accounts={accountOptions} />
    </div>
  );
}
