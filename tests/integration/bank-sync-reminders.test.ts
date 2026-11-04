import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type SentMail = { to: string; subject: string; text: string; locale: string };
const mail = vi.hoisted(() => ({
  sendMail: vi.fn<(m: SentMail) => Promise<{ delivered: boolean }>>(async () => ({
    delivered: true,
  })),
}));
const smtp = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/server/services/mail/mailer", () => mail);
vi.mock("@/server/services/settings/smtp", () => ({
  isSmtpEnabled: async () => smtp.enabled,
}));
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { sendConsentReminders } from "@/server/services/bank-sync/reminders";
import { clearBankSyncConfig, seedBankSyncConfig } from "../fixtures/enable-banking";

const owner = "bsrm_owner";
const now = new Date("2026-11-03T10:00:00.000Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

async function connection(validUntil: Date, status = "ACTIVE", reminderSentDays?: number) {
  return (
    await db.bankConnection.create({
      data: {
        userId: owner,
        aspspName: "Banque Fictive",
        aspspCountry: "FR",
        sessionIdEnc: encrypt("sess-fake-reminder", dataKey),
        validUntil,
        status,
        reminderSentDays: reminderSentDays ?? null,
        accounts: {
          create: {
            uidEnc: encrypt("uid-fake-reminder", dataKey),
            name: "Compte Courant Test",
            currency: "EUR",
          },
        },
      },
    })
  ).id;
}

const sentDays = async (id: string) =>
  (await db.bankConnection.findUniqueOrThrow({ where: { id } })).reminderSentDays;

beforeAll(async () => {
  await db.user.create({ data: { id: owner, email: "bsrm-owner@bilan.local" } });
  await db.userPreference.create({ data: { userId: owner, locale: "en" } });
  await seedBankSyncConfig();
});

beforeEach(async () => {
  mail.sendMail.mockClear();
  smtp.enabled = true;
  await db.bankConnection.deleteMany({ where: { userId: owner } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("sendConsentReminders", () => {
  it("mails the owner once at 14 days, then once at 3 days", async () => {
    const id = await connection(inDays(15));
    expect(await sendConsentReminders(now)).toEqual({ sent: 0 });

    expect(await sendConsentReminders(inDays(1))).toEqual({ sent: 1 });
    expect(await sentDays(id)).toBe(14);
    const first = mail.sendMail.mock.calls[0][0];
    expect(first.to).toBe("bsrm-owner@bilan.local");
    expect(first.locale).toBe("en");
    expect(first.subject).toContain("Banque Fictive");
    expect(first.text).toContain("in 14 days");
    expect(first.text).toMatch(/https?:\/\/[^/]+\/en\/accounts/);
    expect(`${first.subject}${first.text}`).not.toMatch(/sess-|uid-|FR76/);

    expect(await sendConsentReminders(inDays(2))).toEqual({ sent: 0 });
    expect(await sendConsentReminders(inDays(12))).toEqual({ sent: 1 });
    expect(await sentDays(id)).toBe(3);
    expect(await sendConsentReminders(inDays(13))).toEqual({ sent: 0 });
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
  });

  it("sends only the closest threshold when an earlier one was missed", async () => {
    const id = await connection(inDays(2));
    expect(await sendConsentReminders(now)).toEqual({ sent: 1 });
    expect(await sentDays(id)).toBe(3);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("reminds a failing connection, never an expired or revoked one", async () => {
    const failing = await connection(inDays(5), "ERROR");
    await connection(inDays(5), "EXPIRED");
    await connection(inDays(5), "REVOKED");
    await connection(new Date(now.getTime() - 1000));
    expect(await sendConsentReminders(now)).toEqual({ sent: 1 });
    expect(await sentDays(failing)).toBe(14);
  });

  it("sends nothing and keeps the threshold open without SMTP", async () => {
    smtp.enabled = false;
    const id = await connection(inDays(10));
    expect(await sendConsentReminders(now)).toEqual({ sent: 0 });
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(await sentDays(id)).toBeNull();
  });

  it("retries on the next run when the mail fails", async () => {
    const id = await connection(inDays(10));
    mail.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await sendConsentReminders(now)).toEqual({ sent: 0 });
    expect(await sentDays(id)).toBeNull();
    expect(await sendConsentReminders(now)).toEqual({ sent: 1 });
  });

  it("writes the mail in French by default", async () => {
    await db.userPreference.delete({ where: { userId: owner } });
    await connection(inDays(3));
    await sendConsentReminders(now);
    const sent = mail.sendMail.mock.calls[0][0];
    expect(sent.locale).toBe("fr");
    expect(sent.text).toContain("dans 3 jours");
    expect(sent.text).toContain("/fr/accounts");
    await db.userPreference.create({ data: { userId: owner, locale: "en" } });
  });
});
