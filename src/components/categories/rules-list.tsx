"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryChip, Pill } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { RuleMatchType } from "@/lib/validation/rule";
import { deleteRuleAction, toggleRuleAction } from "@/server/transport/actions/rules";
import { RuleDialog, type EditableRule } from "./rule-dialog";

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
};

const COLS = "grid-cols-[32px_40px_1fr_minmax(0,108px)_minmax(0,140px)_72px_60px]";

export function RulesList({
  rules,
  categories,
  groups,
}: {
  rules: RuleRow[];
  categories: FlatCategory[];
  groups: { id: string; name: string }[];
}) {
  const t = useTranslations("rules");
  const router = useRouter();
  const [editing, setEditing] = useState<EditableRule | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const r = await deleteRuleAction(null, fd);
      if (r?.ok) router.refresh();
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
      <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        {t("empty")}
      </div>
    );
  }

  return (
    <>
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
          <span />
        </div>

        {rules.map((r) => {
          const actions = (
            <span className="flex items-center justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("edit")}
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
                aria-label={t("delete")}
                disabled={pending}
                onClick={() => remove(r.id)}
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
              disabled={pending}
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
                    <span className="text-muted-foreground">· {scope}</span>
                  </div>
                </div>
                {actions}
              </div>
            </div>
          );
        })}
      </div>

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
