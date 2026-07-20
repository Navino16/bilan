"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ErrorShell } from "@/components/shell/error-shell";

export default function SegmentError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <ErrorShell code="500" title={t("serverError.title")} message={t("serverError.message")}>
      <Button variant="outline" className="mt-2" onClick={reset}>
        {t("serverError.retry")}
      </Button>
    </ErrorShell>
  );
}
