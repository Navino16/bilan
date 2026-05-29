"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { setupRegistrationModeAction } from "@/server/transport/actions/setup";

const MODES = ["INVITE_ONLY", "OPEN", "DISABLED"] as const;

export function StepRegistrationMode({ onDone }: { onDone: () => void }) {
  const t = useTranslations("setup.registration");
  const [state, action, pending] = useActionState(setupRegistrationModeAction, null);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-6">
      <RadioGroup name="mode" defaultValue="INVITE_ONLY" className="gap-3">
        {MODES.map((mode) => (
          <Label
            key={mode}
            htmlFor={`mode-${mode}`}
            className="flex items-start gap-3 rounded-lg border p-4"
          >
            <RadioGroupItem id={`mode-${mode}`} value={mode} className="mt-0.5" />
            <span className="space-y-1">
              <span className="block font-medium">{t(`modes.${mode}.label`)}</span>
              <span className="text-muted-foreground block text-sm">
                {t(`modes.${mode}.description`)}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
