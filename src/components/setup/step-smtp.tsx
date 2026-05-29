"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

// SMTP configuration is captured later via the admin settings UI (Phase 8.4).
// In the setup wizard this step is informational and skip-only.
export function StepSmtp({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations("setup.smtp");
  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>{t("description")}</AlertDescription>
      </Alert>
      <Button type="button" variant="outline" className="w-full" onClick={onSkip}>
        {t("skip")}
      </Button>
    </div>
  );
}
