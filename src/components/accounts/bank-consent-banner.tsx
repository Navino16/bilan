import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BankReconnectButton } from "@/components/accounts/bank-reconnect-button";
import { formatDate } from "@/lib/format";
import type { BankConnectionSummary } from "@/server/services/bank-sync/connect";

function needsConsentNotice(c: BankConnectionSummary): boolean {
  return c.status === "EXPIRED" || c.consent.expired || c.consent.warn;
}

// Shown to the connection's owner from CONSENT_WARN_DAYS before expiry (design §Consent lifecycle).
export async function BankConsentBanner({ connections }: { connections: BankConnectionSummary[] }) {
  const due = connections.filter(needsConsentNotice);
  if (due.length === 0) return null;
  const t = await getTranslations("accounts.bankSync.consent");
  const locale = await getLocale();
  return (
    <div className="space-y-2" data-slot="bank-consent-banner">
      {due.map((c) => {
        const expired = c.status === "EXPIRED" || c.consent.expired;
        return (
          <Alert key={c.id} variant={expired ? "destructive" : "default"}>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {expired
                  ? t("expired", { bank: c.aspspName })
                  : t("expires", {
                      bank: c.aspspName,
                      date: formatDate(c.validUntil, locale),
                      days: c.consent.daysLeft,
                    })}
              </span>
              <BankReconnectButton
                connectionId={c.id}
                aspspName={c.aspspName}
                country={c.aspspCountry}
                variant={expired ? "default" : "outline"}
              />
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
