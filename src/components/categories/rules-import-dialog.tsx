"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { overline } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { formatBytes, formatCount } from "@/lib/format";
import { canManageInGroup } from "@/lib/validation/group";
import { RULES_FILE_MAX_BYTES, RULES_FILE_MAX_RULES } from "@/lib/validation/rules-file";
import type { RulesImportResult } from "@/server/services/categorization/rules-import";
import { previewRulesImportAction } from "@/server/transport/actions/rules";
import { Block } from "./rule-apply-step";
import {
  ReviewStep,
  bodyClass,
  footerClass,
  headerClass,
  type Loaded,
  type StepProps,
} from "./rules-import-review";
import { RulesBatchApplyStep } from "./rules-batch-apply-step";
import type { ScopeGroup } from "./category-form";

type Step =
  | { kind: "file" }
  | { kind: "review"; loaded: Loaded }
  | { kind: "result"; result: RulesImportResult }
  | { kind: "apply"; ruleIds: string[] };

export function RulesImportDialog({
  categories,
  groups,
  open,
  onOpenChange,
}: {
  categories: FlatCategory[];
  groups: ScopeGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Lifted so the dialog can't close under an in-flight preview, import or reclassify.
  const [pending, startTransition] = useTransition();
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const handleOpenChange = (o: boolean) => {
    if (!pending) onOpenChange(o);
  };
  // The flow lives inside the popup, which unmounts on close: each opening starts at the file step.
  const flow = (
    <RulesImportFlow
      categories={categories}
      groups={groups}
      pending={pending}
      startTransition={startTransition}
      onClose={() => onOpenChange(false)}
    />
  );
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        {flow}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {flow}
      </DialogContent>
    </Dialog>
  );
}

function RulesImportFlow({
  categories,
  groups,
  pending,
  startTransition,
  onClose,
}: StepProps & {
  categories: FlatCategory[];
  groups: ScopeGroup[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "file" });
  const transition = { pending, startTransition };

  switch (step.kind) {
    case "file":
      return (
        <FileStep
          {...transition}
          groups={groups}
          onClose={onClose}
          onLoaded={(loaded) => setStep({ kind: "review", loaded })}
        />
      );
    case "review":
      return (
        <ReviewStep
          {...transition}
          loaded={step.loaded}
          categories={categories}
          groups={groups}
          onBack={() => setStep({ kind: "file" })}
          onImported={(result) => setStep({ kind: "result", result })}
        />
      );
    case "result":
      return (
        <ResultStep
          result={step.result}
          onClose={onClose}
          onReclassify={(ruleIds) => setStep({ kind: "apply", ruleIds })}
        />
      );
    case "apply":
      return <RulesBatchApplyStep {...transition} ruleIds={step.ruleIds} onDone={onClose} />;
  }
}

function FileStep({
  groups,
  pending,
  startTransition,
  onClose,
  onLoaded,
}: StepProps & {
  groups: ScopeGroup[];
  onClose: () => void;
  onLoaded: (loaded: Loaded) => void;
}) {
  const t = useTranslations("rules.transfer");
  const tErrors = useTranslations("rules.error");
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const targets = groups.filter((g) => canManageInGroup(g.role));

  function pick(input: HTMLInputElement) {
    const picked = input.files?.[0] ?? null;
    setError(null);
    if (picked && picked.size > RULES_FILE_MAX_BYTES) {
      input.value = "";
      setFile(null);
      return setError("TOO_LARGE");
    }
    setFile(picked);
  }

  function next() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        return setError("FAILED");
      }
      const target = groupId || null;
      const res = await previewRulesImportAction(text, target);
      if (!res.ok) return setError(res.error);
      onLoaded({ text, fileName: file.name, groupId: target, preview: res.preview });
    });
  }

  return (
    <>
      <DialogHeader className={headerClass}>
        <span className={overline}>{t("importOverline")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("importTitle")}
        </DialogTitle>
      </DialogHeader>
      <div className={bodyClass}>
        <div className="space-y-1.5">
          <Label htmlFor="rules-import-file">{t("fileLabel")}</Label>
          <Input
            id="rules-import-file"
            type="file"
            accept=".json,application/json"
            disabled={pending}
            onChange={(e) => pick(e.target)}
          />
          <p className="text-muted-foreground text-xs">
            {t("fileHint", {
              size: formatBytes(RULES_FILE_MAX_BYTES, locale),
              max: formatCount(RULES_FILE_MAX_RULES, locale),
            })}
          </p>
        </div>
        {targets.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="rules-import-target">{t("target")}</Label>
            <NativeSelect
              id="rules-import-target"
              value={groupId}
              disabled={pending}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{t("personal")}</option>
              {targets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tErrors(error)}
          </p>
        )}
      </div>
      <DialogFooter className={footerClass}>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button type="button" onClick={next} disabled={pending || !file}>
          {pending ? t("reading") : t("next")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ResultStep({
  result,
  onClose,
  onReclassify,
}: {
  result: RulesImportResult;
  onClose: () => void;
  onReclassify: (ruleIds: string[]) => void;
}) {
  const t = useTranslations("rules.transfer");
  const { summary } = result;
  const ruleIds = [...new Set([...result.createdRuleIds, ...result.movedRuleIds])];
  const skipped = summary.identical + summary.duplicates + summary.ignored + summary.rejected;

  return (
    <>
      <DialogHeader className={headerClass}>
        <span className={overline}>{t("resultOverline")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("resultTitle")}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2 px-6 pb-4 max-md:px-5">
        <Block slot="rules-import-created" count={summary.created}>
          {t("resultCreated", { count: summary.created })}
        </Block>
        {summary.categoriesCreated > 0 && (
          <Block slot="rules-import-categories" count={summary.categoriesCreated}>
            {t("resultCategoriesCreated", { count: summary.categoriesCreated })}
          </Block>
        )}
        {summary.moved > 0 && (
          <Block slot="rules-import-moved" count={summary.moved}>
            {t("resultMoved", { count: summary.moved })}
          </Block>
        )}
        {skipped > 0 && (
          <Block slot="rules-import-skipped" count={skipped} tone="muted">
            {t("resultSkipped", { count: skipped })}
          </Block>
        )}
      </div>
      <DialogFooter className={footerClass}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
        {ruleIds.length > 0 && (
          <Button type="button" onClick={() => onReclassify(ruleIds)}>
            <History />
            {t("reclassify")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
