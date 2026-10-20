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
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { createRuleAction, previewRuleApplicationAction } from "@/server/transport/actions/rules";
import type { RuleApplicationPreview } from "@/server/services/categorization/apply";
import {
  RuleApplyStep,
  shouldOfferApply,
  type RuleApplyTarget,
} from "@/components/categories/rule-apply-step";
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
  const tRules = useTranslations("rules");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pat, setPat] = useState(pattern);
  const [matchType, setMatchType] = useState<RuleMatchType>("CONTAINS");
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState<{
    target: RuleApplyTarget;
    preview: RuleApplicationPreview;
  } | null>(null);
  const isMobile = useFrozenWhileOpen(open, useIsMobile());

  // Keep the proposed pattern in sync when the dialog reopens for another tx.
  if (open && pat === "" && pattern) setPat(pattern);

  function submit() {
    const fd = new FormData();
    fd.set("pattern", pat);
    fd.set("matchType", matchType);
    fd.set("categoryId", categoryId);
    setError(null);
    startTransition(async () => {
      const res = await createRuleAction(null, fd);
      if (!res?.ok) return setError(res?.error ?? "FAILED");
      router.refresh();
      const preview = await previewRuleApplicationAction(res.id);
      if (!preview.ok || !shouldOfferApply(preview.preview)) return handleOpenChange(false);
      setApplying({
        target: { id: res.id, pattern: pat, categoryName, categoryColor },
        preview: preview.preview,
      });
    });
  }

  const handleOpenChange = (n: boolean) => {
    if (pending) return;
    if (!n) {
      setPat("");
      setApplying(null);
    }
    setError(null);
    onOpenChange(n);
  };

  const body = (
    <>
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <span className={overline}>{t("rulePrompt.learning")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("rulePrompt.title")}
        </DialogTitle>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t.rich("rulePrompt.body", {
            pattern: pat,
            category: categoryName,
            chip: () => (
              <span className="mx-0.5 inline-flex align-middle">
                <CategoryChip name={categoryName} color={categoryColor} />
              </span>
            ),
          })}
        </p>
      </DialogHeader>

      <div className="flex flex-col gap-4 px-6 pb-4 max-md:px-5">
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
            fullWidth
          />
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2.5 text-xs text-[var(--info)]">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>{t("rulePrompt.existingNote")}</span>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tRules(`error.${error}`)}
          </p>
        )}
      </div>

      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {t("rulePrompt.decline")}
        </Button>
        <Button type="button" disabled={pending || !pat.trim()} onClick={submit}>
          <Check />
          {t("rulePrompt.confirm")}
        </Button>
      </DialogFooter>
    </>
  );

  const content = applying ? (
    <RuleApplyStep
      rule={applying.target}
      mode="created"
      initialPreview={applying.preview}
      pending={pending}
      startTransition={startTransition}
      onDone={() => handleOpenChange(false)}
    />
  ) : (
    body
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">{content}</DialogContent>
    </Dialog>
  );
}
