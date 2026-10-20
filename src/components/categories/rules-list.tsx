"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { History, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryChip, Pill, SegmentedTabs } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { RuleMatchType } from "@/lib/validation/rule";
import { deleteRuleAction, toggleRuleAction } from "@/server/transport/actions/rules";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { RuleDialog, type EditableRule } from "./rule-dialog";
import { RuleApplyDialog } from "./rule-apply-dialog";
import type { RuleApplyTarget } from "./rule-apply-step";
import type { ScopeGroup } from "./category-form";

export type RuleRow = {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority: number;
  enabled: boolean;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  groupId: string | null;
  groupName: string | null;
  hits: number;
  // Household rules need a household admin; a plain member only sees them.
  canManage: boolean;
};

const COLS = "grid-cols-[32px_64px_1fr_minmax(0,108px)_minmax(0,140px)_72px_96px_92px]";

export function RulesList({
  rules,
  categories,
  groups,
  onImport,
}: {
  rules: RuleRow[];
  categories: FlatCategory[];
  groups: ScopeGroup[];
  onImport: () => void;
}) {
  const t = useTranslations("rules");
  const router = useRouter();
  const [editing, setEditing] = useState<EditableRule | null>(null);
  const [applying, setApplying] = useState<RuleApplyTarget | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [sort, setSort] = useState<"priority" | "hits">("priority");
  // Rules arrive in priority order; the stable sort keeps it as the tie-breaker.
  const sorted = sort === "hits" ? [...rules].sort((a, b) => b.hits - a.hits) : rules;

  function remove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    setDeleteError(false);
    startTransition(async () => {
      const r = await deleteRuleAction(null, fd);
      if (!r?.ok) return setDeleteError(true);
      setDeleteOpen(false);
      router.refresh();
    });
  }

  function toggle(id: string, enabled: boolean) {
    startTransition(async () => {
      const r = await toggleRuleAction(id, enabled);
      if (r?.ok) router.refresh();
    });
  }

  if (rules.length === 0) {
    return (
      <div className="text-muted-foreground border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        {t("empty")}
        <Button variant="outline" onClick={onImport}>
          <Upload />
          {t("transfer.importRules")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        role="group"
        aria-label={t("sortBy")}
        className="text-muted-foreground mb-2.5 flex items-center justify-end gap-2 text-[0.8rem]"
      >
        {t("sortBy")}
        <SegmentedTabs
          items={[
            { id: "priority", label: t("sortPriority") },
            { id: "hits", label: t("sortHits") },
          ]}
          value={sort}
          onChange={setSort}
        />
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <div
          className={`text-muted-foreground bg-muted/60 hidden ${COLS} gap-3 border-b px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase md:grid`}
        >
          <span />
          <span>{t("colPriority")}</span>
          <span>{t("colPattern")}</span>
          <span>{t("colMatch")}</span>
          <span>{t("colTarget")}</span>
          <span>{t("colScope")}</span>
          <span className="text-right">{t("colHits")}</span>
          <span />
        </div>

        {sorted.map((r) => {
          const actions = r.canManage && (
            <span className="flex items-center justify-end gap-0.5">
              {r.enabled && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("apply.button", { pattern: r.pattern })}
                  disabled={pending}
                  onClick={() =>
                    setApplying({
                      id: r.id,
                      pattern: r.pattern,
                      categoryName: r.categoryName ?? "—",
                      categoryColor: r.categoryColor,
                    })
                  }
                >
                  <History />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("editRule", { pattern: r.pattern })}
                disabled={pending}
                onClick={() =>
                  setEditing({
                    id: r.id,
                    pattern: r.pattern,
                    matchType: r.matchType,
                    caseSensitive: r.caseSensitive,
                    priority: r.priority,
                    categoryId: r.categoryId,
                    groupId: r.groupId,
                  })
                }
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("deleteRule", { pattern: r.pattern })}
                disabled={pending}
                onClick={() => {
                  setDeleteError(false);
                  setDeleting(r);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 />
              </Button>
            </span>
          );
          const target = <CategoryChip name={r.categoryName ?? "—"} color={r.categoryColor} />;
          const scope = r.groupName ?? t("scopePersonal");
          const toggleBox = (
            <input
              type="checkbox"
              aria-label={r.pattern}
              checked={r.enabled}
              disabled={pending || !r.canManage}
              onChange={(e) => toggle(r.id, e.target.checked)}
              className="size-4 shrink-0 cursor-pointer"
              style={{ accentColor: "var(--primary)" }}
            />
          );

          return (
            <div
              key={r.id}
              data-slot="rule-row"
              className={`border-b last:border-b-0 ${r.enabled ? "" : "opacity-55"}`}
            >
              {/* Desktop */}
              <div className={`hidden ${COLS} items-center gap-3 px-4 py-2.5 md:grid`}>
                {toggleBox}
                <span className="text-muted-foreground text-xs tabular-nums">{r.priority}</span>
                <span className="truncate font-mono text-[12.5px]">{r.pattern}</span>
                <span>
                  <Pill>{t(`match.${r.matchType}`)}</Pill>
                </span>
                <span className="min-w-0">{target}</span>
                <span className="text-muted-foreground truncate text-xs">{scope}</span>
                <span className="text-right text-[12.5px] tabular-nums">{r.hits}</span>
                {actions}
              </div>

              {/* Mobile */}
              <div className="flex items-start gap-3 px-4 py-3 md:hidden">
                <div className="pt-0.5">{toggleBox}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate font-mono text-[12.5px]">{r.pattern}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <Pill>{t(`match.${r.matchType}`)}</Pill>
                    {target}
                  </div>
                  {/* NBSP keeps each « · » on its preceding item's line when the text wraps. */}
                  <div data-slot="rule-meta" className="text-muted-foreground text-[11px]">
                    {[
                      t("priorityValue", { priority: r.priority }),
                      scope,
                      t("hitCount", { count: r.hits }),
                    ].join("\u00a0· ")}
                  </div>
                </div>
                {actions}
              </div>
            </div>
          );
        })}
      </div>

      <RuleApplyDialog rule={applying} onOpenChange={(o) => !o && setApplying(null)} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirm")}
        description={deleting?.pattern}
        confirmLabel={t("delete")}
        onConfirm={() => deleting && remove(deleting.id)}
        pending={pending}
        error={deleteError ? t("deleteFailed") : undefined}
      />

      {editing && (
        <RuleDialog
          mode="edit"
          rule={editing}
          categories={categories}
          groups={groups}
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </>
  );
}
