import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { listLinkedTxIds } from "@/server/services/links";
import { listAssignableBudgets } from "@/server/services/budgets";
import { flattenCategories } from "@/components/transactions/category-tree";
import { parsePeriodParams } from "@/lib/period";
import { LIST_MAX_LIMIT, nextListLimit, parseListLimit, trimToDayBoundary } from "@/lib/list-limit";
import {
  TransactionList,
  type ListItem,
  type AccountOption,
} from "@/components/transactions/transaction-list";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { SelectionModeProvider } from "@/components/transactions/selection-mode";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";

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
  const limit = parseListLimit(sp.limit);

  const [{ items, total }, tree, accounts, linkedIds, budgets] = await Promise.all([
    listTransactions(user.id, {
      categoryId: sp.categoryId,
      direction,
      search: sp.search,
      from: period?.from,
      to: period?.to,
      take: limit,
    }),
    listForUser(user.id),
    listVisibleForUser(user.id),
    listLinkedTxIds(user.id),
    listAssignableBudgets(user.id),
  ]);

  const flatCategories = flattenCategories(tree);
  const accountOptions: AccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    bankName: a.bankName,
    writable: a.access !== "READ",
  }));
  const formAccounts = accounts.map((a) => ({ id: a.id, name: a.name }));
  const allItems: ListItem[] = items.map((i) => ({
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
  const truncated = items.length < total;
  const { items: listItems, partialLastDay } = trimToDayBoundary(allItems, truncated);
  const moreParams = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined),
  );
  moreParams.set("limit", String(nextListLimit(limit)));

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("opCount", { count: total })}
        title={t("title")}
        actions={
          <>
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
          </>
        }
      />
      <SelectionModeProvider>
        <TransactionFilters categories={flatCategories} from={sp.from} to={sp.to} total={total} />
        <TransactionList
          items={listItems}
          categories={flatCategories}
          accounts={accountOptions}
          budgets={budgets}
          partialLastDay={partialLastDay}
        />
      </SelectionModeProvider>
      {truncated && (
        <div
          data-slot="transactions-more"
          className="flex flex-col items-center gap-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">
            {t("shownOf", { shown: listItems.length, total })}
          </span>
          {limit < LIST_MAX_LIMIT ? (
            <Link
              href={`/${locale}/transactions?${moreParams.toString()}`}
              scroll={false}
              className={cn(buttonVariants({ variant: "outline" }), "bg-card shadow-sm")}
            >
              {t("loadMore", { count: nextListLimit(limit) - limit })}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t("refineToSeeMore")}</span>
          )}
        </div>
      )}
    </div>
  );
}
