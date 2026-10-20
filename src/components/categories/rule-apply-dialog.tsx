"use client";

import { useTransition } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { RuleApplyStep, type RuleApplyTarget } from "./rule-apply-step";

export function RuleApplyDialog({
  rule,
  onOpenChange,
}: {
  rule: RuleApplyTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const open = rule !== null;
  const handleOpenChange = (o: boolean) => {
    if (!pending) onOpenChange(o);
  };
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const step = rule && (
    <RuleApplyStep
      rule={rule}
      mode="standalone"
      pending={pending}
      startTransition={startTransition}
      onDone={() => onOpenChange(false)}
    />
  );
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        {step}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">{step}</DialogContent>
    </Dialog>
  );
}
