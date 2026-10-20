"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryChip, overline } from "@/components/transactions/bits";
import type { RuleApplicationPreview } from "@/server/services/categorization/apply";
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

export function Block({
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

type PreviewResult = { ok: true; preview: RuleApplicationPreview } | { ok: false; error: string };
type ApplyResult = { ok: true; reclassified: number } | { ok: false; error: string };

type HostProps = {
  // Lifted so the host dialog can't close under an in-flight apply.
  pending: boolean;
  startTransition: TransitionStartFunction;
  onDone: () => void;
};

// Shared by the single-rule step and the batch step after an import (#291).
export function ApplyStep({
  overlineText,
  title,
  intro,
  moving,
  load,
  apply,
  initialPreview,
  pending,
  startTransition,
  onDone,
}: HostProps & {
  overlineText: string;
  title: string;
  intro: (preview: RuleApplicationPreview) => ReactNode;
  moving: (preview: RuleApplicationPreview) => ReactNode;
  // Must be stable (useCallback): a new identity reloads the preview.
  load: () => Promise<PreviewResult>;
  apply: () => Promise<ApplyResult>;
  initialPreview?: RuleApplicationPreview;
}) {
  const t = useTranslations("rules.apply");
  const tErrors = useTranslations("rules.error");
  const router = useRouter();
  const [preview, setPreview] = useState<RuleApplicationPreview | null>(initialPreview ?? null);
  const [error, setError] = useState<string | null>(null);
  const [reclassified, setReclassified] = useState<number | null>(null);

  useEffect(() => {
    if (initialPreview) return;
    let live = true;
    void load().then((res) => {
      if (!live) return;
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [load, initialPreview]);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await apply();
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.reclassified === preview?.moving) onDone();
      else setReclassified(res.reclassified);
    });
  }

  // Only a transient failure is worth retrying; the others won't change on a second click.
  const canApply =
    !!preview && preview.moving > 0 && reclassified === null && (!error || error === "FAILED");

  return (
    <>
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <span className={overline}>{overlineText}</span>
        <DialogTitle className="font-display text-2xl leading-tight">{title}</DialogTitle>
        {preview && (
          <p className="text-muted-foreground text-sm leading-relaxed">{intro(preview)}</p>
        )}
      </DialogHeader>
      <div className="flex flex-col gap-2 px-6 pb-4 max-md:px-5">
        {!preview && !error && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
        {preview && preview.moving > 0 && (
          <Block slot="rule-apply-moving" count={preview.moving}>
            {moving(preview)}
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
            <Button type="button" onClick={run} disabled={pending}>
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

export function RuleApplyStep({
  rule,
  mode,
  initialPreview,
  ...host
}: HostProps & {
  rule: RuleApplyTarget;
  mode: "created" | "updated" | "standalone";
  initialPreview?: RuleApplicationPreview;
}) {
  const t = useTranslations("rules.apply");
  const load = useCallback(() => previewRuleApplicationAction(rule.id), [rule.id]);
  const apply = useCallback(() => applyRuleAction(rule.id), [rule.id]);

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
    <ApplyStep
      {...host}
      overlineText={t(overlineKey)}
      title={t("title")}
      intro={(preview) =>
        t.rich("intro", {
          pattern: rule.pattern,
          category: rule.categoryName,
          matched: preview.matched,
          chip,
        })
      }
      moving={(preview) =>
        t.rich("moving", { count: preview.moving, category: rule.categoryName, chip })
      }
      load={load}
      apply={apply}
      initialPreview={initialPreview}
    />
  );
}
