"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { createRuleAction } from "@/server/transport/actions/rules";
import { RULE_MATCH_TYPES, type RuleMatchType } from "@/lib/validation/rule";
import { CategoryChip, SegmentedTabs, overline } from "./bits";

// Learning dialog shown after a manual recategorization. Pre-filled with a
// proposed pattern (most distinctive token) and the chosen category; lets the
// user tune the match type before creating a personal rule.
export function CreateRuleDialog({
  open,
  onOpenChange,
  pattern,
  categoryId,
  categoryName,
  categoryColor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pattern: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const [pat, setPat] = useState(pattern);
  const [matchType, setMatchType] = useState<RuleMatchType>("CONTAINS");
  const [pending, startTransition] = useTransition();

  // Keep the proposed pattern in sync when the dialog reopens for another tx.
  if (open && pat === "" && pattern) setPat(pattern);

  function submit() {
    const fd = new FormData();
    fd.set("pattern", pat);
    fd.set("matchType", matchType);
    fd.set("categoryId", categoryId);
    startTransition(async () => {
      await createRuleAction(null, fd);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(n) => {
        if (!n) setPat("");
        onOpenChange(n);
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left">
          <span className={overline}>{t("rulePrompt.learning")}</span>
          <DialogTitle className="font-display text-2xl leading-tight">
            {t("rulePrompt.title")}
          </DialogTitle>
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
            {t("rulePrompt.body", { pattern: pat, category: "" })}
            <CategoryChip name={categoryName} color={categoryColor} />
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-4">
          <div className="space-y-1.5">
            <span className={overline}>{t("rulePrompt.pattern")}</span>
            <Input
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="border-hairline-2 bg-muted border-dashed font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <span className={overline}>{t("rulePrompt.matchType")}</span>
            <SegmentedTabs
              items={RULE_MATCH_TYPES.map((m) => ({ id: m, label: t(`rulePrompt.match.${m}`) }))}
              value={matchType}
              onChange={setMatchType}
              className="flex-wrap"
            />
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2.5 text-xs text-[var(--info)]">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>{t("rulePrompt.existingNote")}</span>
          </div>
        </div>

        <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("rulePrompt.decline")}
          </Button>
          <Button type="button" disabled={pending || !pat.trim()} onClick={submit}>
            <Check />
            {t("rulePrompt.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
