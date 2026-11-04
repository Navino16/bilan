import type { Locale } from "@/i18n/config";
import { formatDate } from "@/lib/format";
import { oneLine } from "@/server/services/mail/invitation";

type Input = { appName: string; bank: string; validUntil: Date; daysLeft: number; url: string };

const TEMPLATES: Record<
  Locale,
  (i: Input & { date: string }) => { subject: string; text: string }
> = {
  fr: ({ appName, bank, date, daysLeft, url }) => ({
    subject: `${appName} — votre connexion ${bank} expire le ${date}`,
    text: [
      `L’accès de ${appName} à vos comptes ${bank} expire le ${date} (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}).`,
      "Passé cette date, vos comptes ne se synchronisent plus.",
      "",
      `Reconnectez la banque depuis la page Comptes : ${url}`,
    ].join("\n"),
  }),
  en: ({ appName, bank, date, daysLeft, url }) => ({
    subject: `${appName} — your ${bank} connection expires on ${date}`,
    text: [
      `${appName}’s access to your ${bank} accounts expires on ${date} (in ${daysLeft} day${daysLeft > 1 ? "s" : ""}).`,
      "After that date, your accounts no longer sync.",
      "",
      `Reconnect the bank from the Accounts page: ${url}`,
    ].join("\n"),
  }),
};

export function bankConsentMail(locale: Locale, input: Input): { subject: string; text: string } {
  return TEMPLATES[locale]({
    ...input,
    appName: oneLine(input.appName),
    bank: oneLine(input.bank),
    date: formatDate(input.validUntil, locale),
  });
}
