"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { SetupData } from "./stepper";

export function StepAccount({
  data,
  onChange,
  onNext,
}: {
  data: SetupData;
  onChange: (p: Partial<SetupData>) => void;
  onNext: () => void;
}) {
  const t = useTranslations("setup.account");
  const [showError, setShowError] = useState(false);

  const valid =
    data.name.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email) &&
    data.password.length >= 12;

  function handleNext() {
    if (!valid) {
      setShowError(true);
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          autoComplete="name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          autoComplete="email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          type="password"
          value={data.password}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
      </div>
      {showError && !valid && (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      )}
      <Button type="button" className="w-full" onClick={handleNext}>
        {t("submit")}
      </Button>
    </div>
  );
}
