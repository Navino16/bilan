"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CategoryForm } from "./category-form";
import { CategoryList } from "./category-list";
import { categoryOptions, pickableCategories } from "./category-options";
import { RulesList, type RuleRow } from "./rules-list";
import { RuleDialog } from "./rule-dialog";
import { MerchantDirectory } from "@/components/merchants/merchant-directory";
import type { MerchantDirectory as Directory } from "@/lib/insights";
import type { CategoryNode } from "@/server/services/categories";
import { PageHeader } from "@/components/shell/page-header";

export function CategoriesView({
  tree,
  flatCategories,
  rules,
  groups,
  merchants,
}: {
  tree: CategoryNode[];
  flatCategories: FlatCategory[];
  rules: RuleRow[];
  groups: { id: string; name: string }[];
  merchants: Directory;
}) {
  const t = useTranslations("rules");
  const tc = useTranslations("categories");
  const tm = useTranslations("merchants");
  const [tab, setTab] = useState<"cats" | "rules" | "merchants">("cats");
  const [ruleOpen, setRuleOpen] = useState(false);
  const parents = pickableCategories(categoryOptions(tree), null);

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("overline")}
        title={t("pageTitle")}
        actions={
          tab === "cats" ? (
            <CategoryForm
              mode="create"
              parents={parents}
              trigger={
                <Button>
                  <Plus />
                  {tc("create")}
                </Button>
              }
            />
          ) : tab === "rules" ? (
            <Button onClick={() => setRuleOpen(true)}>
              <Plus />
              {t("new")}
            </Button>
          ) : null
        }
      />

      <SegmentedTabs
        items={[
          { id: "cats", label: `${t("tabCategories")} (${flatCategories.length})` },
          { id: "rules", label: `${t("tabRules")} (${rules.length})` },
          {
            id: "merchants",
            label: `${tm("tab")} (${merchants.renamed.length + merchants.others.length})`,
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "cats" ? (
        <CategoryList tree={tree} />
      ) : tab === "rules" ? (
        <RulesList rules={rules} categories={flatCategories} groups={groups} />
      ) : (
        <MerchantDirectory directory={merchants} categories={flatCategories} />
      )}

      <RuleDialog
        mode="create"
        categories={flatCategories}
        groups={groups}
        open={ruleOpen}
        onOpenChange={setRuleOpen}
      />
    </div>
  );
}
