"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryChip, overline } from "@/components/transactions/bits";
import type { RuleApplicationPreview } from "@/server/services/categorization";
import { applyRuleAction, previewRuleApplicationAction } from "@/server/transport/actions/rules";

export type RuleApplyTarget = {
  id: string;
  pattern: string;
  categoryName: string;
  categoryColor: string | null;
};

// After a save, the step is only worth a click when rows would move or a stronger rule keeps some.
export function shouldOfferApply(preview: RuleApplicationPreview): boolean {
  return preview.moving > 0 || preview.keptBy.length > 0;
}

function Block({
  slot,
  count,
  tone = "default",
  children,
}: {
  slot: string;
  count: number;
  tone?: "default" | "info" | "muted";
  children: ReactNode;
}) {
  const toneClass =
    tone === "info"
      ? "bg-[var(--info-bg)] text-[var(--info)]"
      : tone === "muted"
        ? "text-muted-foreground"
        : "";
  return (
    <div
      data-slot={slot}
      className={`border-border flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}
    >
      <b className="font-display min-w-7 text-lg leading-6 tabular-nums">{count}</b>
      <div className="min-w-0 leading-6">{children}</div>
    </div>
  );
}

export function RuleApplyStep({
  rule,
  mode,
  initialPreview,
  onDone,
}: {
  rule: RuleApplyTarget;
  mode: "created" | "updated" | "standalone";
  initialPreview?: RuleApplicationPreview;
  onDone: () => void;
}) {
  const t = useTranslations("rules.apply");
  const tErrors = useTranslations("rules.error");
  const router = useRouter();
  const [preview, setPreview] = useState<RuleApplicationPreview | null>(initialPreview ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initialPreview) return;
    let live = true;
    void previewRuleApplicationAction(rule.id).then((res) => {
      if (!live) return;
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [rule.id, initialPreview]);

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await applyRuleAction(rule.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onDone();
    });
  }

  const chip = () => (
    <span className="mx-0.5 inline-flex align-middle">
      <CategoryChip name={rule.categoryName} color={rule.categoryColor} />
    </span>
  );
  const overlineKey =
    mode === "created"
      ? "overlineCreated"
      : mode === "updated"
        ? "overlineUpdated"
        : "overlineStandalone";

  return (
    <>
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <span className={overline}>{t(overlineKey)}</span>
        <DialogTitle className="font-display text-2xl leading-tight">{t("title")}</DialogTitle>
        {preview && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t.rich("intro", {
              pattern: rule.pattern,
              category: rule.categoryName,
              matched: preview.matched,
              chip,
            })}
          </p>
        )}
      </DialogHeader>
      <div className="flex flex-col gap-2 px-6 pb-4 max-md:px-5">
        {!preview && !error && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
        {preview && preview.moving > 0 && (
          <Block slot="rule-apply-moving" count={preview.moving}>
            {t.rich("moving", { count: preview.moving, category: rule.categoryName, chip })}
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
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tErrors(error)}
          </p>
        )}
      </div>
      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        {preview && preview.moving > 0 ? (
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
