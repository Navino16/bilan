import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listBudgetAccountOptions, listBudgetsForUser } from "@/server/services/budgets";
import { listForUser } from "@/server/services/categories";
import { listGroupsForUser } from "@/server/services/groups";
import { categoryOptions } from "@/components/categories/category-options";
import { BudgetsView } from "@/components/budgets/budgets-view";

export const dynamic = "force-dynamic";

export default async function BudgetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  const [budgets, tree, accounts, groupRows] = await Promise.all([
    listBudgetsForUser(user.id),
    listForUser(user.id),
    listBudgetAccountOptions(user.id),
    listGroupsForUser(user.id),
  ]);

  const categories = categoryOptions(tree);
  const groups = groupRows
    .filter((g) => g.role === "OWNER" || g.role === "ADMIN")
    .map((g) => ({ id: g.id, name: g.name }));

  return (
    <BudgetsView budgets={budgets} categories={categories} accounts={accounts} groups={groups} />
  );
}
