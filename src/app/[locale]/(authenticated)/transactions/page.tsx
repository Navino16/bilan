import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ArrowRightLeft, PenLine, Plus, Upload } from "lucide-react";
import { getOnboardingState } from "@/server/services/onboarding";
import { writableActiveAccounts } from "@/lib/onboarding";
import {
  AddBlockedNotice,
  AddBlockedState,
  ADD_BLOCKED_ID,
} from "@/components/onboarding/add-blocked";
import { EmptyState } from "@/components/shell/empty-state";
import { requireSession } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { listLinkedTxIds } from "@/server/services/links";
import { listAssignableBudgets } from "@/server/services/budgets";
import { flattenCategories } from "@/components/transactions/category-tree";
import { currentUtcYear, dayEnd, dayStart } from "@/lib/period";
import { parseTransactionFilters } from "@/lib/transaction-filters";
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
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("transactions");

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
  const tOnboarding = await getTranslations("onboarding");

  const { from, to, ...filters } = parseTransactionFilters(sp);
  const limit = parseListLimit(sp.limit);
  const groupByDay = filters.sort.startsWith("date");

  const [{ items, total, capped }, tree, foreignTree, accounts, linkedIds, budgets, onboarding] =
    await Promise.all([
      listTransactions(user.id, {
        ...filters,
        from: from ? dayStart(from) : undefined,
        to: to ? dayEnd(to) : undefined,
        take: limit,
      }),
      listForUser(user.id),
      listForeignCategories(user.id),
      listVisibleForUser(user.id, { includeArchived: true }),
      listLinkedTxIds(user.id),
      listAssignableBudgets(user.id),
      getOnboardingState(user.id),
    ]);
  const blocker = onboarding.addBlocker;

  const flatCategories = flattenCategories(tree);
  const foreignCategories = flattenCategories(foreignTree);
  const accountOptions: AccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    bankName: a.bankName,
    writable: a.access !== "READ",
    archived: a.archived,
  }));
  const formAccounts = writableActiveAccounts(accounts).map((a) => ({ id: a.id, name: a.name }));
  const allItems: ListItem[] = items.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    periodDate: i.periodDate.toISOString(),
    periodManual: i.periodManual,
    amount: i.amount,
    type: i.type,
    label: i.label,
    rawLabel: i.rawLabel,
    note: i.note,
    accountId: i.accountId,
    accountName: i.accountName,
    categoryId: i.categoryId,
    linked: linkedIds.has(i.id),
    imported: i.imported,
  }));
  const truncated = capped || items.length < total;
  const { items: listItems, partialLastDay } = groupByDay
    ? trimToDayBoundary(allItems, truncated)
    : { items: allItems, partialLastDay: false };
  const moreParams = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined),
  );
  moreParams.set("limit", String(nextListLimit(limit)));
  moreParams.delete("new");

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("opCount", { count: total, capped: String(capped) })}
        title={t("title")}
        actions={
          <>
            <Link
              href={`/${locale}/transactions/suggestions`}
              className="text-primary text-sm hover:underline"
            >
              {t("suggestions.open")}
            </Link>
            {blocker || formAccounts.length === 0 ? (
              <Button aria-disabled="true" aria-describedby={ADD_BLOCKED_ID}>
                <Plus />
                {t("create")}
              </Button>
            ) : (
              <TransactionForm
                accounts={formAccounts}
                categories={flatCategories}
                defaultOpen={sp.new === "1"}
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
      {!onboarding.hasTransaction ? (
        blocker ? (
          <AddBlockedState reason={blocker} />
        ) : (
          <EmptyState
            icon={ArrowRightLeft}
            title={tOnboarding("transactions.title")}
            body={tOnboarding("transactions.body")}
            actions={
              <>
                <Link href={`/${locale}/import`} className={buttonVariants()}>
                  <Upload />
                  {tOnboarding("importStatement")}
                </Link>
                <TransactionForm
                  accounts={formAccounts}
                  categories={flatCategories}
                  trigger={
                    <Button variant="outline">
                      <PenLine />
                      {tOnboarding("addTransaction")}
                    </Button>
                  }
                />
              </>
            }
          />
        )
      ) : (
        <>
          {blocker && <AddBlockedNotice reason={blocker} />}
          <SelectionModeProvider>
            <TransactionFilters
              categories={[...flatCategories, ...foreignCategories]}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              from={from}
              to={to}
              total={total}
              capped={capped}
            />
            <TransactionList
              items={listItems}
              categories={flatCategories}
              foreignCategories={foreignCategories}
              accounts={accountOptions}
              budgets={budgets}
              partialLastDay={partialLastDay}
              currentYear={currentUtcYear()}
              searching={Boolean(sp.search?.trim())}
              groupByDay={groupByDay}
            />
          </SelectionModeProvider>
        </>
      )}
      {truncated && (
        <div
          data-slot="transactions-more"
          className="flex flex-col items-center gap-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">
            {t("shownOf", { shown: listItems.length, total, capped: String(capped) })}
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
