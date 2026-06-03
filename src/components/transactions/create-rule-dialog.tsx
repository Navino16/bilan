"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createRuleAction } from "@/server/transport/actions/rules";

// Shown after a manual recategorization. Pre-filled with a proposed CONTAINS
// pattern (most distinctive token) and the chosen category.
export function CreateRuleDialog({
  open,
  onOpenChange,
  pattern,
  categoryId,
  categoryName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pattern: string;
  categoryId: string;
  categoryName: string;
}) {
  const t = useTranslations("transactions");
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      await createRuleAction(null, formData);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rulePrompt.title")}</DialogTitle>
          <DialogDescription>
            {t("rulePrompt.body", { pattern, category: categoryName })}
          </DialogDescription>
        </DialogHeader>
        <form action={handleAction} className="space-y-4">
          <input type="hidden" name="matchType" value="CONTAINS" />
          <input type="hidden" name="categoryId" value={categoryId} />
          <div className="space-y-2">
            <Label htmlFor="rule-pattern">{t("rulePrompt.pattern")}</Label>
            <Input id="rule-pattern" name="pattern" defaultValue={pattern} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("rulePrompt.decline")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("rulePrompt.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
