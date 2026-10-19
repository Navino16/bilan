"use client";

import { useState, useTransition, type TransitionStartFunction } from "react";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { SegmentedTabs, overline } from "@/components/transactions/bits";
import { CategoryCombobox } from "@/components/transactions/category-combobox";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { RULE_MATCH_TYPES, type RuleMatchType } from "@/lib/validation/rule";
import {
  createRuleAction,
  previewRuleApplicationAction,
  updateRuleAction,
  type RuleSaveState,
} from "@/server/transport/actions/rules";
import type { RuleApplicationPreview } from "@/server/services/categorization";
import { RuleApplyStep, shouldOfferApply, type RuleApplyTarget } from "./rule-apply-step";
import { NativeSelect } from "@/components/ui/native-select";
import { canManageInGroup } from "@/lib/validation/group";
import type { ScopeGroup } from "./category-form";

export type EditableRule = {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority: number;
  categoryId: string;
  groupId: string | null;
};

type RuleFormProps = {
  mode: "create" | "edit";
  rule?: EditableRule;
  categories: FlatCategory[];
  groups: ScopeGroup[];
};

export function RuleDialog({
  open,
  onOpenChange,
  ...props
}: RuleFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Lifted so the dialog can't close (then reopen) under an in-flight save.
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState<{
    target: RuleApplyTarget;
    preview: RuleApplicationPreview;
  } | null>(null);
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const close = () => {
    setApplying(null);
    onOpenChange(false);
  };
  const handleOpenChange = (o: boolean) => {
    if (pending) return;
    if (!o) setApplying(null);
    onOpenChange(o);
  };
  // The form lives inside the popup, which unmounts on close: each opening starts from `rule`.
  const form = applying ? (
    <RuleApplyStep
      rule={applying.target}
      mode={props.mode === "edit" ? "updated" : "created"}
      initialPreview={applying.preview}
      onDone={close}
    />
  ) : (
    <RuleForm
      {...props}
      pending={pending}
      startTransition={startTransition}
      onClose={close}
      onSaved={(target, preview) => setApplying({ target, preview })}
    />
  );
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        {form}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">{form}</DialogContent>
    </Dialog>
  );
}

function RuleForm({
  mode,
  rule,
  categories,
  groups,
  pending,
  startTransition,
  onClose,
  onSaved,
}: RuleFormProps & {
  pending: boolean;
  startTransition: TransitionStartFunction;
  onClose: () => void;
  onSaved: (target: RuleApplyTarget, preview: RuleApplicationPreview) => void;
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
  const scopeGroups = groups.filter((g) => canManageInGroup(g.role));

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
      const res: RuleSaveState = await action(null, fd);
      if (!res?.ok) return setError(res?.error ?? "FAILED");
      router.refresh();
      const preview = await previewRuleApplicationAction(res.id);
      if (!preview.ok || !shouldOfferApply(preview.preview)) return onClose();
      const category = categories.find((c) => c.id === categoryId);
      onSaved(
        {
          id: res.id,
          pattern,
          categoryName: category?.name ?? "",
          categoryColor: category?.color ?? null,
        },
        preview.preview,
      );
    });
  }

  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-3 text-left max-md:px-5">
        <DialogTitle className="font-display text-2xl">
          {mode === "edit" ? t("editTitle") : t("createTitle")}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4 px-6 pb-4 max-md:px-5">
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
            fullWidth
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rule-priority">{t("priority")}</Label>
            <Input
              id="rule-priority"
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
          {mode === "create" && scopeGroups.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-scope">{t("scope")}</Label>
              <NativeSelect
                id="rule-scope"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">{t("scopePersonal")}</option>
                {scopeGroups.map((g) => (
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

      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={pending || !pattern.trim() || !categoryId} onClick={submit}>
          <Check />
          {t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
