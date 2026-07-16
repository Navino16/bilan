import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { getBudgetDetail, BudgetAccessError } from "@/server/services/budgets";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { flattenCategories } from "@/components/transactions/category-tree";
import { BudgetDetail } from "@/components/budgets/budget-detail";

export const dynamic = "force-dynamic";

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

  const [tree, accountRows] = await Promise.all([
    listForUser(user.id),
    listVisibleForUser(user.id),
  ]);
  const categories = Object.fromEntries(flattenCategories(tree).map((c) => [c.id, c.name]));
  const accounts = Object.fromEntries(accountRows.map((a) => [a.id, a.name]));

  return <BudgetDetail detail={detail} categories={categories} accounts={accounts} />;
}
