"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/transactions/bits";
import { ScrollFade } from "@/components/ui/scroll-fade";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CategoryForm, type ScopeGroup } from "./category-form";
import { CategoryList } from "./category-list";
import { categoryOptions } from "./category-options";
import { RulesList, type RuleRow } from "./rules-list";
import { RuleDialog } from "./rule-dialog";
import { RULES_EXPORT_FILENAME, RulesExportDialog, rulesExportHref } from "./rules-export-dialog";
import { RulesImportDialog } from "./rules-import-dialog";
import { DownloadButton } from "@/components/settings/download-button";
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
  groups: ScopeGroup[];
  merchants: Directory;
}) {
  const t = useTranslations("rules");
  const tc = useTranslations("categories");
  const tm = useTranslations("merchants");
  const tt = useTranslations("rules.transfer");
  const [tab, setTab] = useState<"cats" | "rules" | "merchants">("cats");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const options = categoryOptions(tree);

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("overline")}
        title={t("pageTitle")}
        actions={
          tab === "cats" ? (
            <CategoryForm
              mode="create"
              options={options}
              groups={groups}
              trigger={
                <Button>
                  <Plus />
                  {tc("create")}
                </Button>
              }
            />
          ) : tab === "rules" ? (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload />
                {tt("import")}
              </Button>
              {groups.length > 0 ? (
                <Button variant="outline" onClick={() => setExportOpen(true)}>
                  <Download />
                  {tt("export")}
                </Button>
              ) : (
                <DownloadButton
                  href={rulesExportHref(null)}
                  fallbackFilename={RULES_EXPORT_FILENAME}
                  pendingLabel={tt("exporting")}
                  onError={setExportFailed}
                >
                  {tt("export")}
                </DownloadButton>
              )}
              <Button onClick={() => setRuleOpen(true)}>
                <Plus />
                {t("new")}
              </Button>
            </>
          ) : null
        }
      />

      {/* The wrapper keeps space-y's margins: -m-1 on the scroller itself would override them. */}
      <div>
        <ScrollFade className="-m-1 max-w-[calc(100%+0.5rem)] p-1">
          <SegmentedTabs
            className="w-max"
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
        </ScrollFade>
      </div>

      {tab === "rules" && exportFailed && (
        <p role="alert" className="text-destructive text-sm">
          {tt("exportFailed")}
        </p>
      )}

      {tab === "cats" ? (
        <CategoryList tree={tree} groups={groups} />
      ) : tab === "rules" ? (
        <RulesList
          rules={rules}
          categories={flatCategories}
          groups={groups}
          onImport={() => setImportOpen(true)}
        />
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
      <RulesImportDialog
        categories={flatCategories}
        groups={groups}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
      <RulesExportDialog groups={groups} open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
