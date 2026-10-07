import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listBudgetsForUser } from "@/server/services/budgets";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { listGroupsForUser } from "@/server/services/groups";
import { flattenCategories, indentedName } from "@/components/transactions/category-tree";
import { BudgetsView } from "@/components/budgets/budgets-view";

export const dynamic = "force-dynamic";

export default async function BudgetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  const [budgets, tree, accountRows, groupRows] = await Promise.all([
    listBudgetsForUser(user.id),
    listForUser(user.id),
    listVisibleForUser(user.id),
    listGroupsForUser(user.id),
  ]);

  const categories = flattenCategories(tree).map((c) => ({
    id: c.id,
    name: indentedName(c.name, c.depth),
  }));
  const accounts = accountRows.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }));
  const groups = groupRows
    .filter((g) => g.role === "OWNER" || g.role === "ADMIN")
    .map((g) => ({ id: g.id, name: g.name }));

  return (
    <BudgetsView budgets={budgets} categories={categories} accounts={accounts} groups={groups} />
  );
}
