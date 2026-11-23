import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/shell/section-card";
import { BankDisconnectButton } from "@/components/accounts/bank-disconnect-button";
import { BankReconnectButton } from "@/components/accounts/bank-reconnect-button";
import { formatDate } from "@/lib/format";
import type { BankConnectionSummary } from "@/server/services/bank-sync/connect";

export async function BankConnections({
  connections,
  available,
}: {
  connections: BankConnectionSummary[];
  available: boolean;
}) {
  const t = await getTranslations("accounts.bankSync.connections");
  const locale = await getLocale();
  return (
    <SectionCard title={t("title")}>
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
              <p
                className={
                  c.consent.warn || c.consent.expired
                    ? "text-destructive text-xs"
                    : "text-muted-foreground text-xs"
                }
              >
                {c.consent.expired
                  ? t("expiredOn", { date: formatDate(c.validUntil, locale) })
                  : t("validUntil", { date: formatDate(c.validUntil, locale) })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {c.status === "ACTIVE" && !c.consent.expired && (
                <Link
                  href={`/${locale}/accounts/bank-sync/${c.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {t("map")}
                </Link>
              )}
              {available && (
                <BankReconnectButton
                  connectionId={c.id}
                  aspspName={c.aspspName}
                  country={c.aspspCountry}
                />
              )}
              <BankDisconnectButton connectionId={c.id} aspspName={c.aspspName} />
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
