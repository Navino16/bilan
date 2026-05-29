"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StepAccount } from "./step-account";
import { StepSmtp } from "./step-smtp";
import { StepOidc } from "./step-oidc";
import { StepRegistrationMode } from "./step-registration-mode";

const ORDER = ["account", "smtp", "oidc", "registration"] as const;
type Step = (typeof ORDER)[number];

export function Stepper({ locale }: { locale: string }) {
  const t = useTranslations("setup.steps");
  const [current, setCurrent] = useState<Step>("account");
  const router = useRouter();
  const idx = ORDER.indexOf(current);

  function next() {
    if (idx < ORDER.length - 1) setCurrent(ORDER[idx + 1]);
    else router.push(`/${locale}/dashboard`);
  }

  return (
    <div className="space-y-6">
      <ol className="text-muted-foreground flex flex-wrap gap-3 text-sm">
        {ORDER.map((s, i) => (
          <li key={s} className={i <= idx ? "text-foreground font-medium" : ""}>
            {i + 1}. {t(s)}
          </li>
        ))}
      </ol>
      {current === "account" && <StepAccount onDone={next} locale={locale} />}
      {current === "smtp" && <StepSmtp onSkip={next} />}
      {current === "oidc" && <StepOidc onSkip={next} />}
      {current === "registration" && <StepRegistrationMode onDone={next} />}
    </div>
  );
}
