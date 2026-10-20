"use client";

import { useMemo, useState, type TransitionStartFunction } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentedTabs, overline } from "@/components/transactions/bits";
import { CategoryCombobox } from "@/components/transactions/category-combobox";
import {
  categoryPathLabel,
  PATH_SEPARATOR,
  type FlatCategory,
} from "@/components/transactions/category-tree";
import {
  planRulesImport,
  type CategoryDecision,
  type ImportDecisions,
  type PathResolution,
} from "@/lib/rules-import";
import type {
  RulesImportPreview,
  RulesImportResult,
} from "@/server/services/categorization/rules-import";
import { importRulesAction } from "@/server/transport/actions/rules";
import type { ScopeGroup } from "./category-form";

export type Loaded = {
  text: string;
  fileName: string;
  groupId: string | null;
  preview: RulesImportPreview;
};

type Choice = { mode: "create" | "map" | "ignore"; mapId: string };

export type StepProps = { pending: boolean; startTransition: TransitionStartFunction };

const pathLabel = (path: { name: string }[]) =>
  path.map((level) => level.name).join(PATH_SEPARATOR);

export const headerClass = "space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5";
export const bodyClass = "flex flex-col gap-3 px-6 pb-4 max-md:px-5";
export const footerClass = "bg-muted/40 border-border border-t px-6 py-3 max-md:px-5";

export function ReviewStep({
  loaded,
  categories,
  groups,
  pending,
  startTransition,
  onBack,
  onImported,
}: StepProps & {
  loaded: Loaded;
  categories: FlatCategory[];
  groups: ScopeGroup[];
  onBack: () => void;
  onImported: (result: RulesImportResult) => void;
}) {
  const t = useTranslations("rules.transfer");
  const tErrors = useTranslations("rules.error");
  const router = useRouter();
  const { preview } = loaded;
  const unresolved = useMemo(
    () => preview.resolutions.filter((r) => r.categoryId === null),
    [preview],
  );
  const [choices, setChoices] = useState<Map<string, Choice>>(
    () => new Map(unresolved.map((r) => [r.key, { mode: "create", mapId: "" }])),
  );
  const [moveIds, setMoveIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // A Map row without a picked category stays undecided, which blocks the import.
  const categoryDecisions: Record<string, CategoryDecision> = Object.fromEntries(
    unresolved.flatMap((r): [string, CategoryDecision][] => {
      const { mode, mapId } = choices.get(r.key)!;
      if (mode === "map" && !mapId) return [];
      return [[r.key, mode === "map" ? { action: mode, categoryId: mapId } : { action: mode }]];
    }),
  );
  const plan = planRulesImport(preview.rules, preview.resolutions, preview.existing, {
    categories: categoryDecisions,
    moves: [...moveIds],
  });
  // Only the moves of current conflicts: the server refuses any other id.
  const decisions: ImportDecisions = {
    categories: categoryDecisions,
    moves: plan.move.map((m) => m.ruleId),
  };
  const skipped = plan.identical + plan.duplicates + plan.ignored + preview.rejected.length;
  const nothing = plan.create.length + plan.move.length === 0;
  const canImport = !pending && plan.undecided.length === 0 && !nothing;

  const resolutionByKey = new Map(preview.resolutions.map((r) => [r.key, r]));
  const targetLabel = (pathKey: string) => {
    const resolution = resolutionByKey.get(pathKey)!;
    const choice = choices.get(pathKey);
    const id = resolution.categoryId ?? (choice?.mode === "map" ? choice.mapId : null);
    return (id && categoryPathLabel(categories, id)) || pathLabel(resolution.path);
  };
  const scopeName = loaded.groupId
    ? (groups.find((g) => g.id === loaded.groupId)?.name ?? "")
    : t("personal");

  function choose(key: string, patch: Partial<Choice>) {
    setChoices((prev) => new Map(prev).set(key, { ...prev.get(key)!, ...patch }));
  }

  function toggleMove(ruleId: string, move: boolean) {
    setMoveIds((prev) => {
      const next = new Set(prev);
      if (move) next.add(ruleId);
      else next.delete(ruleId);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await importRulesAction(loaded.text, loaded.groupId, decisions);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onImported(res);
    });
  }

  return (
    <>
      <DialogHeader className={headerClass}>
        <span className={overline}>{t("reviewOverline")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("reviewTitle")}
        </DialogTitle>
        <p className="text-muted-foreground text-sm leading-relaxed wrap-anywhere">
          {t("reviewIntro", {
            count: preview.rules.length + preview.rejected.length,
            file: loaded.fileName,
            scope: scopeName,
          })}
        </p>
      </DialogHeader>
      <div className={bodyClass}>
        {unresolved.length > 0 && (
          <section className="space-y-2">
            <h3 className={overline}>{t("categoriesTitle")}</h3>
            <p className="text-muted-foreground text-xs">{t("categoriesHint")}</p>
            {unresolved.map((r) => (
              <CategoryRow
                key={r.key}
                resolution={r}
                choice={choices.get(r.key)!}
                categories={categories}
                disabled={pending}
                onChange={(patch) => choose(r.key, patch)}
              />
            ))}
          </section>
        )}

        {plan.conflicts.length > 0 && (
          <section className="space-y-2">
            <h3 className={overline}>{t("conflictsTitle")}</h3>
            <p className="text-muted-foreground text-xs">{t("conflictsHint")}</p>
            {plan.conflicts.map((c) => (
              <div
                key={c.ruleId}
                data-slot="rules-import-conflict"
                className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5 max-sm:flex-col max-sm:items-stretch"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px]">{c.pattern}</div>
                  <div className="text-muted-foreground text-xs wrap-anywhere">
                    {t("conflictChange", {
                      current: c.currentCategoryPath.join(PATH_SEPARATOR),
                      next: targetLabel(c.pathKey),
                    })}
                  </div>
                </div>
                <SegmentedTabs
                  aria-label={c.pattern}
                  items={[
                    { id: "keep", label: t("keep") },
                    { id: "move", label: t("move") },
                  ]}
                  value={moveIds.has(c.ruleId) ? "move" : "keep"}
                  onChange={(v) => toggleMove(c.ruleId, v === "move")}
                  disabled={pending}
                  className="shrink-0 max-sm:*:flex-1"
                />
              </div>
            ))}
          </section>
        )}

        {preview.rejected.length > 0 && (
          <div
            data-slot="rules-import-rejected"
            className="text-muted-foreground border-border rounded-lg border px-3 py-2.5 text-sm"
          >
            <p>{t("rejectedTitle", { count: preview.rejected.length })}</p>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
              {preview.rejected.map((r) => (
                <li key={r.index} className="wrap-anywhere">
                  <span className="font-mono">
                    {r.pattern ?? t("rejectedRule", { index: r.index + 1 })}
                  </span>
                  {" · "}
                  {t(`rejectedReason.${r.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div data-slot="rules-import-summary" className="grid gap-2 sm:grid-cols-3">
          <SummaryStat
            count={plan.create.length}
            label={t("summaryCreate", { count: plan.create.length })}
          />
          <SummaryStat
            count={plan.move.length}
            label={t("summaryMove", { count: plan.move.length })}
          />
          <SummaryStat count={skipped} label={t("summarySkip", { count: skipped })} />
        </div>

        {plan.undecided.length > 0 ? (
          <p className="text-muted-foreground text-sm">{t("undecided")}</p>
        ) : (
          nothing && <p className="text-muted-foreground text-sm">{t("nothing")}</p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tErrors(error)}
          </p>
        )}
      </div>
      <DialogFooter className={footerClass}>
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          {t("back")}
        </Button>
        <Button type="button" onClick={submit} disabled={!canImport}>
          <Check />
          {pending ? t("importing") : t("importButton")}
        </Button>
      </DialogFooter>
    </>
  );
}

function CategoryRow({
  resolution,
  choice,
  categories,
  disabled,
  onChange,
}: {
  resolution: PathResolution;
  choice: Choice;
  categories: FlatCategory[];
  disabled: boolean;
  onChange: (patch: Partial<Choice>) => void;
}) {
  const t = useTranslations("rules.transfer");
  const label = pathLabel(resolution.path);
  return (
    <div
      data-slot="rules-import-category"
      className="border-border space-y-2 rounded-lg border px-3 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 font-medium wrap-anywhere">{label}</span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {t("ruleCount", { count: resolution.ruleCount })}
        </span>
      </div>
      <SegmentedTabs
        aria-label={label}
        items={[
          { id: "create", label: t("create") },
          { id: "map", label: t("map") },
          { id: "ignore", label: t("ignore") },
        ]}
        value={choice.mode}
        onChange={(mode) => onChange({ mode })}
        disabled={disabled}
        fullWidth
      />
      {choice.mode === "create" && (
        <p className="text-muted-foreground text-xs wrap-anywhere">
          {t("createsLevels", { path: pathLabel(resolution.missing) })}
        </p>
      )}
      {choice.mode === "map" && (
        <CategoryCombobox
          aria-label={t("mapCategory", { path: label })}
          categories={categories}
          defaultValue={choice.mapId}
          onChange={(mapId) => onChange({ mapId })}
        />
      )}
    </div>
  );
}

function SummaryStat({ count, label }: { count: number; label: string }) {
  return (
    <div className="bg-muted/40 border-border rounded-lg border px-3 py-2 max-sm:flex max-sm:items-baseline max-sm:gap-3">
      <b className="font-display block min-w-7 text-xl leading-7 tabular-nums">{count}</b>
      <span className="text-muted-foreground text-xs leading-tight">{label}</span>
    </div>
  );
}
