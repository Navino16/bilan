import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { listRulesForUser } from "@/server/services/categorization";
import { listGroupsForUser } from "@/server/services/groups";
import { getMerchantDirectory } from "@/server/services/merchants";
import { flattenCategories } from "@/components/transactions/category-tree";
import { CategoriesView } from "@/components/categories/categories-view";
import type { RuleMatchType } from "@/lib/validation/rule";
import { canManageInGroup } from "@/lib/validation/group";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("categories");

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const tree = await listForUser(user.id);
  const flatCategories = flattenCategories(tree);
  const colorById = new Map(flatCategories.map((c) => [c.id, c.color]));
  const ruleRows = await listRulesForUser(user.id);
  const groups = (await listGroupsForUser(user.id)).map((g) => ({
    id: g.id,
    name: g.name,
    role: g.role,
  }));
  const merchants = await getMerchantDirectory(user.id);
  const roleByGroup = new Map(groups.map((g) => [g.id, g.role]));

  const rules = ruleRows.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType as RuleMatchType,
    caseSensitive: r.caseSensitive,
    priority: r.priority,
    enabled: r.enabled,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    categoryColor: colorById.get(r.categoryId) ?? r.category?.color ?? null,
    groupId: r.groupId,
    groupName: r.group?.name ?? null,
    hits: r.hits,
    canManage: r.groupId === null || canManageInGroup(roleByGroup.get(r.groupId) ?? "MEMBER"),
  }));

  return (
    <CategoriesView
      tree={tree}
      flatCategories={flatCategories}
      rules={rules}
      groups={groups}
      merchants={merchants}
    />
  );
}
