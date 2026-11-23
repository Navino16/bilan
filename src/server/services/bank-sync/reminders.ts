import { env } from "@/env";
import { defaultLocale } from "@/i18n/config";
import { consentState } from "@/lib/bank-sync";
import { db } from "@/server/db";
import { isBankSyncAvailable } from "@/server/services/bank-sync/config";
import { bankConsentMail } from "@/server/services/mail/bank-consent";
import { pickMailLocale } from "@/server/services/mail/locale";
import { sendMail } from "@/server/services/mail/mailer";
import { getAppName } from "@/server/services/settings/app-settings";
import { isSmtpEnabled } from "@/server/services/settings/smtp";

// Days before `validUntil` at which the owner is mailed, once per threshold (design §Consent lifecycle).
export const REMINDER_DAYS = [14, 3] as const;
const DAY_MS = 86_400_000;

// Run by the bank-sync cron; a consent that skipped a threshold gets only the closest one.
export async function sendConsentReminders(now: Date): Promise<{ sent: number }> {
  if (!(await isBankSyncAvailable()) || !(await isSmtpEnabled())) return { sent: 0 };
  const due = await db.bankConnection.findMany({
    where: {
      status: { in: ["ACTIVE", "ERROR"] },
      validUntil: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS[0] * DAY_MS) },
    },
    select: {
      id: true,
      aspspName: true,
      validUntil: true,
      reminderSentDays: true,
      user: { select: { email: true, preference: { select: { locale: true } } } },
    },
    orderBy: { validUntil: "asc" },
  });
  if (due.length === 0) return { sent: 0 };
  const appName = await getAppName();
  let sent = 0;
  for (const c of due) {
    const { daysLeft } = consentState(c.validUntil, now);
    const threshold = Math.min(...REMINDER_DAYS.filter((d) => d >= daysLeft));
    if (c.reminderSentDays !== null && c.reminderSentDays <= threshold) continue;
    const claim = await db.bankConnection.updateMany({
      where: { id: c.id, reminderSentDays: c.reminderSentDays },
      data: { reminderSentDays: threshold },
    });
    if (claim.count === 0) continue;
    const locale = pickMailLocale(c.user.preference?.locale, defaultLocale);
    const mail = bankConsentMail(locale, {
      appName,
      bank: c.aspspName,
      validUntil: c.validUntil,
      daysLeft,
      url: `${new URL(env.APP_URL).origin}/${locale}/accounts`,
    });
    try {
      await sendMail({ to: c.user.email, ...mail, locale });
      sent++;
    } catch (e) {
      // Released so the next run retries this threshold.
      await db.bankConnection.updateMany({
        where: { id: c.id, reminderSentDays: threshold },
        data: { reminderSentDays: c.reminderSentDays },
      });
      console.error("[bilan] bank consent reminder failed", e instanceof Error ? e.name : typeof e);
    }
  }
  return { sent };
}
