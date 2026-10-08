"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SegmentedTabs, overline } from "@/components/transactions/bits";
import { CategoryCombobox } from "@/components/transactions/category-combobox";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { RULE_MATCH_TYPES, type RuleMatchType } from "@/lib/validation/rule";
import {
  createRuleAction,
  updateRuleAction,
  type RuleActionState,
} from "@/server/transport/actions/rules";
import { NativeSelect } from "@/components/ui/native-select";

export type EditableRule = {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority: number;
  categoryId: string;
  groupId: string | null;
};

export function RuleDialog({
  mode,
  rule,
  categories,
  groups,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  rule?: EditableRule;
  categories: FlatCategory[];
  groups: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("rules");
  const router = useRouter();
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [matchType, setMatchType] = useState<RuleMatchType>(rule?.matchType ?? "CONTAINS");
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [caseSensitive, setCaseSensitive] = useState(rule?.caseSensitive ?? false);
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [groupId, setGroupId] = useState(rule?.groupId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const fd = new FormData();
    if (mode === "edit" && rule) fd.set("id", rule.id);
    fd.set("pattern", pattern);
    fd.set("matchType", matchType);
    fd.set("caseSensitive", String(caseSensitive));
    fd.set("priority", priority);
    fd.set("categoryId", categoryId);
    if (mode === "create" && groupId) fd.set("groupId", groupId);
    startTransition(async () => {
      const action = mode === "edit" ? updateRuleAction : createRuleAction;
      const res: RuleActionState = await action(null, fd);
      if (res?.ok) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(n) => (setError(null), onOpenChange(n))}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="px-6 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-2xl">
            {mode === "edit" ? t("editTitle") : t("createTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-pattern">{t("pattern")}</Label>
            <Input
              id="rule-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t("patternPlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <span className={overline}>{t("matchType")}</span>
            <SegmentedTabs
              items={RULE_MATCH_TYPES.map((m) => ({ id: m, label: t(`match.${m}`) }))}
              value={matchType}
              onChange={setMatchType}
              className="flex-wrap"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-category">{t("category")}</Label>
            <CategoryCombobox
              id="rule-category"
              categories={categories}
              defaultValue={categoryId}
              onChange={setCategoryId}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-priority">{t("priority")}</Label>
              <Input
                id="rule-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            {mode === "create" && groups.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-scope">{t("scope")}</Label>
                <NativeSelect
                  id="rule-scope"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">{t("scopePersonal")}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="size-4"
              style={{ accentColor: "var(--primary)" }}
            />
            {t("caseSensitive")}
          </label>
          {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
        </div>

        <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending || !pattern.trim() || !categoryId}
            onClick={submit}
          >
            <Check />
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
