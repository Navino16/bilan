"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

// OIDC/social providers are added later via the admin settings UI (Phase 8.4),
// backed by the dynamic-provider service from scope 1.2. Skip-only here.
export function StepOidc({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations("setup.oidc");
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
