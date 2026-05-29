"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { completeSetupAction } from "@/server/transport/actions/setup";
import type { SetupData } from "./stepper";

const MODES = ["INVITE_ONLY", "OPEN", "DISABLED"] as const;

export function StepRegistrationMode({
  data,
  onChange,
  locale,
}: {
  data: SetupData;
  onChange: (p: Partial<SetupData>) => void;
  locale: string;
}) {
  const t = useTranslations("setup.registration");
  const router = useRouter();
  const [state, action, pending] = useActionState(completeSetupAction, null);

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/dashboard`);
  }, [state, router, locale]);

  return (
    <form action={action} className="space-y-6">
      {/* Account data collected in earlier steps; the user is created here. */}
      <input type="hidden" name="name" value={data.name} />
      <input type="hidden" name="email" value={data.email} />
      <input type="hidden" name="password" value={data.password} />
      <input type="hidden" name="locale" value={locale} />
      <RadioGroup
        name="mode"
        value={data.mode}
        onValueChange={(v) => onChange({ mode: v as SetupData["mode"] })}
        className="gap-3"
      >
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
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
