import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { flattenCategories } from "@/components/transactions/category-tree";
import { TransactionList, type ListItem } from "@/components/transactions/transaction-list";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Button } from "@/components/ui/button";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/validation/transaction";

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

  const type =
    sp.type && (TRANSACTION_TYPES as readonly string[]).includes(sp.type)
      ? (sp.type as TransactionType)
      : undefined;

  const [{ items }, tree, accounts] = await Promise.all([
    listTransactions(user.id, {
      accountId: sp.accountId,
      categoryId: sp.categoryId,
      type,
      search: sp.search,
      from: sp.from ? new Date(sp.from) : undefined,
      to: sp.to ? new Date(sp.to) : undefined,
    }),
    listForUser(user.id),
    listVisibleForUser(user.id),
  ]);

  const flatCategories = flattenCategories(tree);
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const listItems: ListItem[] = items.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    amount: i.amount,
    type: i.type,
    label: i.label,
    accountName: i.accountName,
    categoryId: i.categoryId,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {accountOptions.length === 0 ? (
          // No writable account yet: a plain disabled button. Never feed a
          // disabled element into DialogTrigger — Base UI resolves the trigger's
          // disabled state on the client only, which hydration-mismatches.
          <Button disabled>
            <Plus />
            {t("create")}
          </Button>
        ) : (
          <TransactionForm
            accounts={accountOptions}
            categories={flatCategories}
            trigger={
              <Button>
                <Plus />
                {t("create")}
              </Button>
            }
          />
        )}
      </header>
      <TransactionFilters accounts={accountOptions} categories={flatCategories} />
      <TransactionList items={listItems} categories={flatCategories} />
    </div>
  );
}
