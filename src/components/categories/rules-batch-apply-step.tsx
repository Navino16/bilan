"use client";

import { useCallback, type TransitionStartFunction } from "react";
import { useTranslations } from "next-intl";
import { applyRulesAction, previewRulesApplicationAction } from "@/server/transport/actions/rules";
import { ApplyStep } from "./rule-apply-step";

export function RulesBatchApplyStep({
  ruleIds,
  ...host
}: {
  ruleIds: string[];
  pending: boolean;
  startTransition: TransitionStartFunction;
  onDone: () => void;
}) {
  const t = useTranslations("rules.transfer.batch");
  const load = useCallback(() => previewRulesApplicationAction(ruleIds), [ruleIds]);
  const apply = useCallback(() => applyRulesAction(ruleIds), [ruleIds]);
  return (
    <ApplyStep
      {...host}
      overlineText={t("overline")}
      title={t("title")}
      intro={(preview) => t("intro", { matched: preview.matched })}
      moving={(preview) => t("moving", { count: preview.moving })}
      load={load}
      apply={apply}
    />
  );
}
