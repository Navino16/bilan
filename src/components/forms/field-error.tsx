"use client";

import { useTranslations } from "next-intl";
import type { ActionForm } from "./use-action-form";

export function FieldError({
  form,
  name,
}: {
  form: Pick<ActionForm, "fieldError" | "errorId">;
  name: string;
}) {
  const t = useTranslations("forms.fieldError");
  const code = form.fieldError(name);
  if (!code) return null;
  return (
    <p id={form.errorId(name)} data-slot="field-error" className="text-destructive text-xs">
      {t.has(code) ? t(code) : t("INVALID")}
    </p>
  );
}
