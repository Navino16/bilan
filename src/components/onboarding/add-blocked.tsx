import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Archive, Info, Landmark, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/shell/empty-state";
import type { AddTransactionBlocker } from "@/lib/onboarding";

// Referenced by the disabled "add" buttons' aria-describedby.
export const ADD_BLOCKED_ID = "add-transaction-blocked";

const ICONS = { NO_ACCOUNT: Landmark, READ_ONLY: Lock, ARCHIVED: Archive } as const;

export function accountsCtaHref(locale: string, reason: AddTransactionBlocker): string {
  return reason === "ARCHIVED" ? `/${locale}/accounts` : `/${locale}/accounts?new=1`;
}

export function AddBlockedState({ reason }: { reason: AddTransactionBlocker }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  return (
    <EmptyState
      id={ADD_BLOCKED_ID}
      icon={ICONS[reason]}
      title={t(`blockedTitle.${reason}`)}
      body={t(`blocked.${reason}`)}
      actions={
        <Link href={accountsCtaHref(locale, reason)} className={buttonVariants()}>
          {t(reason === "ARCHIVED" ? "manageAccounts" : "createAccount")}
        </Link>
      }
    />
  );
}

export function AddBlockedNotice({ reason }: { reason: AddTransactionBlocker }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  return (
    <Alert role="note" id={ADD_BLOCKED_ID} data-slot="add-blocked-notice">
      <Info />
      <AlertTitle>{t(`blockedTitle.${reason}`)}</AlertTitle>
      <AlertDescription>
        {t(`blocked.${reason}`)}{" "}
        <Link href={accountsCtaHref(locale, reason)} className="underline underline-offset-4">
          {t(reason === "ARCHIVED" ? "manageAccounts" : "createAccount")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
