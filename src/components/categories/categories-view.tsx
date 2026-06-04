"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { overline, SegmentedTabs } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CategoryForm } from "./category-form";
import { CategoryList } from "./category-list";
import { RulesList, type RuleRow } from "./rules-list";
import { RuleDialog } from "./rule-dialog";
import type { CategoryNode } from "@/server/services/categories";

export function CategoriesView({
  tree,
  flatCategories,
  rules,
  groups,
}: {
  tree: CategoryNode[];
  flatCategories: FlatCategory[];
  rules: RuleRow[];
  groups: { id: string; name: string }[];
}) {
  const t = useTranslations("rules");
  const tc = useTranslations("categories");
  const [tab, setTab] = useState<"cats" | "rules">("cats");
  const [ruleOpen, setRuleOpen] = useState(false);
  const parents = tree.map((n) => ({ id: n.id, name: n.name }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-3xl leading-none">{t("pageTitle")}</h1>
        </div>
        {tab === "cats" ? (
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
        ) : (
          <Button onClick={() => setRuleOpen(true)}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </header>

      <SegmentedTabs
        items={[
          { id: "cats", label: `${t("tabCategories")} (${flatCategories.length})` },
          { id: "rules", label: `${t("tabRules")} (${rules.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "cats" ? (
        <CategoryList tree={tree} />
      ) : (
        <RulesList rules={rules} categories={flatCategories} groups={groups} />
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
