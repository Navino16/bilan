"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { SmtpData } from "./stepper";

// Optional. SMTP can also be configured later in the admin settings (Phase 8.4).
// If the host is left blank the step is skipped; if filled, the required fields
// are validated before advancing. Persisted atomically on the final step.
export function StepSmtp({
  data,
  onChange,
  onNext,
}: {
  data: SmtpData;
  onChange: (p: Partial<SmtpData>) => void;
  onNext: () => void;
}) {
  const t = useTranslations("setup.smtp");
  const [showError, setShowError] = useState(false);

  const filled = data.host.trim().length > 0;
  const complete =
    data.host.trim().length > 0 &&
    Number(data.port) >= 1 &&
    data.username.trim().length > 0 &&
    data.password.length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.fromAddress);

  function handleNext() {
    if (filled && !complete) {
      setShowError(true);
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>{t("description")}</AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="smtp-host">{t("host")}</Label>
          <Input
            id="smtp-host"
            value={data.host}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="smtp.example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-port">{t("port")}</Label>
          <Input
            id="smtp-port"
            type="number"
            value={data.port}
            onChange={(e) => onChange({ port: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="smtp-username">{t("username")}</Label>
        <Input
          id="smtp-username"
          value={data.username}
          onChange={(e) => onChange({ username: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="smtp-password">{t("password")}</Label>
        <Input
          id="smtp-password"
          type="password"
          value={data.password}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="smtp-from">{t("fromAddress")}</Label>
          <Input
            id="smtp-from"
            type="email"
            value={data.fromAddress}
            onChange={(e) => onChange({ fromAddress: e.target.value })}
            placeholder="bilan@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-from-name">{t("fromName")}</Label>
          <Input
            id="smtp-from-name"
            value={data.fromName}
            onChange={(e) => onChange({ fromName: e.target.value })}
            placeholder="Bilan"
          />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Switch
            id="smtp-secure"
            checked={data.secure}
            onCheckedChange={(v) => onChange({ secure: v })}
            aria-describedby="smtp-secure-hint"
          />
          <Label htmlFor="smtp-secure">{t("secure")}</Label>
        </div>
        <p id="smtp-secure-hint" className="text-muted-foreground text-xs">
          {t("secureHint")}
        </p>
      </div>
      {showError && filled && !complete && (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        variant={filled ? "default" : "outline"}
        className="w-full"
        onClick={handleNext}
      >
        {filled ? t("save") : t("skip")}
      </Button>
    </div>
  );
}
