"use client";

import { useEffect, useState, type TransitionStartFunction } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { overline } from "@/components/transactions/bits";
import type { RuleApplicationPreview } from "@/server/services/categorization/apply";
import { applyRulesAction, previewRulesApplicationAction } from "@/server/transport/actions/rules";
import { Block } from "./rule-apply-step";

export function RulesBatchApplyStep({
  ruleIds,
  pending,
  startTransition,
  onDone,
}: {
  ruleIds: string[];
  pending: boolean;
  startTransition: TransitionStartFunction;
  onDone: () => void;
}) {
  const t = useTranslations("rules.apply");
  const tb = useTranslations("rules.transfer.batch");
  const tErrors = useTranslations("rules.error");
  const router = useRouter();
  const [preview, setPreview] = useState<RuleApplicationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reclassified, setReclassified] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void previewRulesApplicationAction(ruleIds).then((res) => {
      if (!live) return;
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [ruleIds]);

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await applyRulesAction(ruleIds);
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.reclassified === preview?.moving) onDone();
      else setReclassified(res.reclassified);
    });
  }

  const canApply =
    !!preview && preview.moving > 0 && reclassified === null && (!error || error === "FAILED");

  return (
    <>
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <span className={overline}>{tb("overline")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">{tb("title")}</DialogTitle>
        {preview && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tb("intro", { matched: preview.matched })}
          </p>
        )}
      </DialogHeader>
      <div className="flex flex-col gap-2 px-6 pb-4 max-md:px-5">
        {!preview && !error && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
        {preview && preview.moving > 0 && (
          <Block slot="rule-apply-moving" count={preview.moving}>
            {tb("moving", { count: preview.moving })}
            {preview.movingFromOther > 0 && (
              <span className="text-muted-foreground block text-xs">
                {t("movingFromOther", { count: preview.movingFromOther })}
              </span>
            )}
          </Block>
        )}
        {preview?.keptBy.map((k) => (
          <Block key={k.ruleId} slot="rule-apply-kept" count={k.count} tone="info">
            {t("kept", { count: k.count, pattern: k.pattern })}
            <span className="flex items-start gap-1 text-xs">
              <Info className="mt-0.5 size-3 shrink-0" />
              {t("keptHint")}
            </span>
          </Block>
        ))}
        {preview && preview.manual > 0 && (
          <Block slot="rule-apply-manual" count={preview.manual} tone="muted">
            {t("manual", { count: preview.manual })}
          </Block>
        )}
        {preview && preview.moving === 0 && (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        )}
        {reclassified !== null && preview && (
          <p role="status" className="text-sm">
            {t("partial", { count: reclassified, expected: preview.moving })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tErrors(error)}
          </p>
        )}
      </div>
      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        {canApply && preview ? (
          <>
            <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
              {t("later")}
            </Button>
            <Button type="button" onClick={apply} disabled={pending}>
              <Check />
              {t("apply", { count: preview.moving })}
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("close")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
