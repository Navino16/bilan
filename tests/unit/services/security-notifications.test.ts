import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ delivered: true });
const findUser = vi.fn();
const logEvent = vi.fn();
vi.mock("@/server/services/mail/mailer", () => ({ sendMail: (o: unknown) => sendMail(o) }));
vi.mock("@/server/services/settings/app-settings", () => ({
  getAppName: async () => "Maison",
}));
vi.mock("@/server/services/audit", () => ({ logEvent: (e: unknown) => logEvent(e) }));
vi.mock("@/server/db", () => ({
  db: { user: { findUnique: (q: unknown) => findUser(q) } },
}));

import {
  formatDevice,
  formatIp,
  notifySecurityEvent,
  securityMail,
  type SecurityEvent,
} from "@/server/services/mail/security-notifications";

const at = new Date("2026-03-01T10:05:00.000Z");
const origin = { ip: "203.0.113.7", userAgent: "Firefox" };
const EVENTS: SecurityEvent[] = [
  "new_login",
  "password_changed",
  "passkey_added",
  "two_factor_disabled",
];

describe("securityMail", () => {
  it.each(EVENTS)("renders %s in both locales with the app name", (event) => {
    const fr = securityMail(event, "fr", { appName: "Maison", at, origin });
    const en = securityMail(event, "en", { appName: "Maison", at, origin });
    for (const mail of [fr, en]) {
      expect(mail.subject).toContain("Maison");
      expect(mail.text).toContain("Maison");
      expect(mail.text).toContain("203.0.113.7");
    }
    expect(fr.subject).not.toBe(en.subject);
    expect(fr.text).not.toMatch(/'/);
  });

  it("formats the date with the shared formatter, in UTC", () => {
    const fr = securityMail("new_login", "fr", { appName: "Maison", at, origin });
    const en = securityMail("new_login", "en", { appName: "Maison", at, origin });
    expect(fr.text).toContain("Date : 1er mars 2026, 10:05 (UTC)");
    expect(en.text).toMatch(/^Date: Mar 1, 2026, 10:05\sAM \(UTC\)$/m);
    expect(en.subject).toBe("Maison — new sign-in to your account");
    expect(en.text).toContain("IP address: 203.0.113.7");
    expect(fr.text).toContain("Adresse IP : 203.0.113.7");
  });

  it("omits the origin lines when none is given", () => {
    const en = securityMail("password_changed", "en", { appName: "Maison", at });
    expect(en.text).not.toContain("IP address");
    expect(en.subject).toBe("Maison — your password was changed");
  });
});

describe("notifySecurityEvent", () => {
  beforeEach(() => {
    sendMail.mockClear();
    findUser.mockReset();
    logEvent.mockClear();
  });

  it("mails the user in their preferred locale", async () => {
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: { locale: "en" } });
    await notifySecurityEvent("passkey_added", { userId: "u1", at, origin });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string; locale: string };
    expect(arg.locale).toBe("en");
    expect(arg.to).toBe("user@bilan.local");
    expect(arg.subject).toBe("Maison — a passkey was added to your account");
  });

  it("falls back to the default locale without a valid preference", async () => {
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: null });
    await notifySecurityEvent("new_login", { userId: "u1", at, origin });
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: { locale: "de" } });
    await notifySecurityEvent("new_login", { userId: "u1", at, origin });
    for (const [arg] of sendMail.mock.calls) {
      expect((arg as { subject: string }).subject).toBe(
        "Maison — nouvelle connexion à votre compte",
      );
    }
  });

  it("falls back to the triggering request's locale, then the default (#245)", async () => {
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: null });
    await notifySecurityEvent("new_login", { userId: "u1", at, origin, pageLocale: "en" });
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: { locale: "fr" } });
    await notifySecurityEvent("new_login", { userId: "u1", at, origin, pageLocale: "en" });
    expect(sendMail.mock.calls.map(([arg]) => (arg as { locale: string }).locale)).toEqual([
      "en",
      "fr",
    ]);
  });

  it("audits a failed send instead of throwing", async () => {
    findUser.mockResolvedValue({ email: "user@bilan.local", preference: null });
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    await expect(
      notifySecurityEvent("two_factor_disabled", { userId: "u1", at }),
    ).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith({
      action: "mail.security.failed",
      metadata: { kind: "two_factor_disabled", error: "smtp down" },
    });
  });
});

describe("origin formatting", () => {
  it("formats the IP and device readably, per locale", () => {
    expect(formatIp("::ffff:10.0.1.1", "fr")).toBe("10.0.1.1");
    expect(formatIp("2001:0db8:0000:0000:0000:0000:0000:0001", "en")).toBe("2001:db8::1");
    expect(formatIp(null, "fr")).toBe("inconnue");
    expect(formatIp(null, "en")).toBe("unknown");
    expect(
      formatDevice(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "en",
      ),
    ).toBe("Chrome · Linux");
    expect(formatDevice("curl/8.5.0", "fr")).toBe("curl/8.5.0");
    expect(formatDevice(null, "fr")).toBe("inconnu");
    expect(formatDevice(null, "en")).toBe("unknown");
  });
});
