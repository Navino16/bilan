import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listBudgetAccountOptions, listBudgetsForUser } from "@/server/services/budgets";
import { listForUser } from "@/server/services/categories";
import { listGroupsForUser } from "@/server/services/groups";
import { categoryOptions } from "@/components/categories/category-options";
import { BudgetsView } from "@/components/budgets/budgets-view";
import { pageTitle } from "@/i18n/metadata";
import { canManageInGroup } from "@/lib/validation/group";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("budgets");

export default async function BudgetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  const [budgets, archived, tree, accounts, groupRows] = await Promise.all([
    listBudgetsForUser(user.id),
    listBudgetsForUser(user.id, { archived: true }),
    listForUser(user.id),
    listBudgetAccountOptions(user.id),
    listGroupsForUser(user.id),
  ]);

  const categories = categoryOptions(tree);
  const groups = groupRows
    .filter((g) => canManageInGroup(g.role))
    .map((g) => ({ id: g.id, name: g.name }));

  return (
    <BudgetsView
      budgets={budgets}
      archived={archived}
      categories={categories}
      accounts={accounts}
      groups={groups}
    />
  );
}
