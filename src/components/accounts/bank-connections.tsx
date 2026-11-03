import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/shell/section-card";
import { formatDate } from "@/lib/format";
import type { BankConnectionSummary } from "@/server/services/bank-sync/connect";

export async function BankConnections({ connections }: { connections: BankConnectionSummary[] }) {
  const t = await getTranslations("accounts.bankSync.connections");
  const locale = await getLocale();
  return (
    <SectionCard overline={t("overline")} title={t("title")}>
      <ul className="divide-border divide-y" data-slot="bank-connections">
        {connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.aspspName}</span>
                <Badge variant={c.status === "ACTIVE" ? "secondary" : "destructive"}>
                  {t(`status.${c.status as "ACTIVE"}`)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {c.mappedAccounts.length
                  ? t("mapped", { names: c.mappedAccounts.join(", ") })
                  : t("unmapped")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("validUntil", { date: formatDate(c.validUntil, locale) })}
              </p>
            </div>
            <Link
              href={`/${locale}/accounts/bank-sync/${c.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("map")}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
