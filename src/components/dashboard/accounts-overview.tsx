import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { formatMoney } from "@/lib/format";
import type { VisibleAccount } from "@/server/services/accounts";

const negativeTone = (n: number) => (n < 0 ? { color: "var(--expense)" } : undefined);

// Current balances, independent of the dashboard period (#349).
export async function AccountsOverview({
  accounts,
  locale,
}: {
  accounts: VisibleAccount[];
  locale: string;
}) {
  if (accounts.length === 0) return null;
  const [t, tAccounts] = await Promise.all([
    getTranslations("dashboard.accounts"),
    getTranslations("accounts"),
  ]);
  const total = Math.round(accounts.reduce((sum, a) => sum + a.balance, 0) * 100) / 100;

  return (
    <Card className="gap-3 p-4.5 md:p-6" data-slot="dashboard-accounts">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={overline}>{t("overline")}</div>
          <div className="font-display text-xl tabular-nums" style={negativeTone(total)}>
            {formatMoney(total, locale)}
          </div>
        </div>
        <Link
          href={`/${locale}/accounts`}
          className="text-primary inline-flex shrink-0 items-center gap-0.5 text-sm hover:underline"
        >
          {t("seeAll")}
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div
            key={a.id}
            data-slot="dashboard-account"
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: a.color ?? "var(--muted-foreground)" }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{a.name}</div>
              {a.ownerName && (
                <div className="text-muted-foreground truncate text-[11.5px]">
                  {tAccounts("sharedBy", { name: a.ownerName })}
                </div>
              )}
            </div>
            <span
              className="shrink-0 text-sm font-medium tabular-nums"
              style={negativeTone(a.balance)}
            >
              {formatMoney(a.balance, locale)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
