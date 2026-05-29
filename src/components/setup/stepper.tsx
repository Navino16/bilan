"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { StepAccount } from "./step-account";
import { StepSmtp } from "./step-smtp";
import { StepOidc } from "./step-oidc";
import { StepRegistrationMode } from "./step-registration-mode";

const ORDER = ["account", "smtp", "oidc", "registration"] as const;
type Step = (typeof ORDER)[number];

export type SetupData = {
  name: string;
  email: string;
  password: string;
  mode: "OPEN" | "INVITE_ONLY" | "DISABLED";
};

export function Stepper({ locale }: { locale: string }) {
  const t = useTranslations("setup.steps");
  const [current, setCurrent] = useState<Step>("account");
  const [data, setData] = useState<SetupData>({
    name: "",
    email: "",
    password: "",
    mode: "INVITE_ONLY",
  });
  const idx = ORDER.indexOf(current);

  // The user is created only on the final step (atomic completeSetupAction), so
  // navigating between steps never touches the DB and never trips the
  // setup-done guard mid-wizard.
  function next() {
    if (idx < ORDER.length - 1) setCurrent(ORDER[idx + 1]);
  }

  function patch(p: Partial<SetupData>) {
    setData((prev) => ({ ...prev, ...p }));
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
      {current === "account" && <StepAccount data={data} onChange={patch} onNext={next} />}
      {current === "smtp" && <StepSmtp onSkip={next} />}
      {current === "oidc" && <StepOidc onSkip={next} />}
      {current === "registration" && (
        <StepRegistrationMode data={data} onChange={patch} locale={locale} />
      )}
    </div>
  );
}
