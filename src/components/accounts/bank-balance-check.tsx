import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import { balanceGapLink } from "@/lib/bank-sync";
import { formatDate, formatMoney } from "@/lib/format";
import type { BankBalanceCheck as BalanceCheck } from "@/server/services/bank-sync/balance";

const signedMoney = (n: number, locale: string) => `${n > 0 ? "+" : ""}${formatMoney(n, locale)}`;

export function BankBalanceCheck({ accountId, check }: { accountId: string; check: BalanceCheck }) {
  const t = useTranslations("accounts.bankSync.balance");
  const locale = useLocale();
  const date = formatDate(check.bookedDate, locale);
  return (
    <div className="space-y-1 pt-1 text-xs" data-slot="bank-balance-check">
      {check.gap === 0 ? (
        <div
          className="text-muted-foreground flex items-center gap-1"
          data-slot="bank-balance-match"
        >
          <Check aria-hidden className="size-3.5 shrink-0" />
          {t("matches", { date })}
        </div>
      ) : (
        <Link
          href={balanceGapLink(locale, accountId, check.bookedDate)}
          data-slot="bank-balance-gap"
          className="flex items-center gap-1 underline-offset-2 hover:underline"
          style={{ color: "var(--warning-text)" }}
        >
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {t("gap", { date, amount: signedMoney(check.gap, locale) })}
        </Link>
      )}
      {check.expectedBalance !== null && check.expectedDate && (
        <div className="text-muted-foreground" data-slot="bank-balance-expected">
          {t("expected", {
            date: formatDate(check.expectedDate, locale),
            amount: formatMoney(check.expectedBalance, locale),
          })}
        </div>
      )}
    </div>
  );
}
