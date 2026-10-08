import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { overline } from "@/components/transactions/bits";
import { cn } from "@/lib/utils";
import type { OnboardingState } from "@/server/services/onboarding";
import { accountsCtaHref } from "./add-blocked";

function Step({
  n,
  done,
  title,
  hint,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("onboarding.welcome");
  return (
    <li data-slot="welcome-step" data-done={done || undefined} className="flex gap-3">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums",
          done && "border-transparent bg-[var(--income-bg)] text-[var(--income)]",
        )}
      >
        {done ? (
          <>
            <Check aria-hidden className="size-4" />
            <span className="sr-only">{t("done")}</span>
          </>
        ) : (
          n
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <div className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
            {title}
          </div>
          <p className="text-muted-foreground text-sm">{hint}</p>
        </div>
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
      </div>
    </li>
  );
}

export function WelcomeCard({ state }: { state: OnboardingState }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const blocker = state.addBlocker;

  return (
    <Card data-slot="welcome-card" className="max-w-2xl gap-4 p-6">
      <div>
        <div className={overline}>{t("welcome.overline")}</div>
        <h2 className="font-display text-xl">{t("welcome.heading")}</h2>
      </div>
      <ol className="space-y-4">
        <Step
          n={1}
          done={blocker === null}
          title={t("welcome.step1")}
          hint={
            blocker === null
              ? t("welcome.step1Done")
              : blocker === "NO_ACCOUNT"
                ? t("welcome.step1Hint")
                : t(`blocked.${blocker}`)
          }
        >
          {blocker && (
            <Link href={accountsCtaHref(locale, blocker)} className={buttonVariants()}>
              {t(blocker === "ARCHIVED" ? "manageAccounts" : "createAccount")}
            </Link>
          )}
        </Step>
        <Step n={2} done={false} title={t("welcome.step2")} hint={t("welcome.step2Hint")}>
          {blocker === null && (
            <>
              <Link href={`/${locale}/import`} className={buttonVariants()}>
                {t("importStatement")}
              </Link>
              <Link
                href={`/${locale}/transactions?new=1`}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("addTransaction")}
              </Link>
            </>
          )}
        </Step>
      </ol>
    </Card>
  );
}
