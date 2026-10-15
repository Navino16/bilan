import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import {
  getBudgetDetail,
  listBudgetAccountOptions,
  BudgetAccessError,
} from "@/server/services/budgets";
import { listForUser, listForeignCategories } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { listGroupsForUser } from "@/server/services/groups";
import { flattenCategories } from "@/components/transactions/category-tree";
import { categoryOptions } from "@/components/categories/category-options";
import { BudgetDetail } from "@/components/budgets/budget-detail";
import { pageTitle } from "@/i18n/metadata";
import { canManageInGroup } from "@/lib/validation/group";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("budget");

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  let detail: Awaited<ReturnType<typeof getBudgetDetail>>;
  try {
    detail = await getBudgetDetail(id, user.id);
  } catch (e) {
    if (e instanceof BudgetAccessError) notFound();
    throw e;
  }

  const [tree, foreign, accountRows, accountOptions, groupRows] = await Promise.all([
    listForUser(user.id),
    listForeignCategories(user.id),
    listVisibleForUser(user.id, { includeArchived: true }),
    listBudgetAccountOptions(user.id),
    listGroupsForUser(user.id),
  ]);
  const categories = Object.fromEntries(
    [...flattenCategories(tree), ...flattenCategories(foreign)].map((c) => [c.id, c]),
  );
  const accounts = Object.fromEntries(accountRows.map((a) => [a.id, a.name]));
  const formOptions = {
    categories: categoryOptions(tree),
    accounts: accountOptions,
    groups: groupRows
      .filter((g) => canManageInGroup(g.role))
      .map((g) => ({ id: g.id, name: g.name })),
  };

  return (
    <BudgetDetail
      detail={detail}
      categories={categories}
      accounts={accounts}
      formOptions={formOptions}
    />
  );
}
