import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ delivered: true });
vi.mock("@/server/services/mail/mailer", () => ({ sendMail: (o: unknown) => sendMail(o) }));
vi.mock("@/server/services/settings/app-settings", () => ({
  getAppName: async () => "Maison",
}));

import {
  notifyNewLogin,
  notifyPasskeyAdded,
  notifyPasswordChanged,
} from "@/server/services/mail/security-notifications";

describe("security notifications", () => {
  beforeEach(() => sendMail.mockClear());

  it("notifyNewLogin emails the user with the IP in the body", async () => {
    await notifyNewLogin({
      email: "user@bilan.local",
      ip: "203.0.113.7",
      userAgent: "Firefox",
      at: new Date("2026-03-01T10:00:00.000Z"),
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(arg.to).toBe("user@bilan.local");
    expect(arg.subject.toLowerCase()).toMatch(/connexion|login/);
    expect(arg.text).toContain("203.0.113.7");
    expect(arg.subject).toContain("Maison");
    expect(arg.text).toContain("Maison");
  });

  it("notifyPasswordChanged emails the user", async () => {
    await notifyPasswordChanged({ email: "user@bilan.local", at: new Date() });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string };
    expect(arg.to).toBe("user@bilan.local");
    expect(arg.subject.toLowerCase()).toMatch(/mot de passe|password/);
    expect(arg.subject).toContain("Maison");
  });

  it("notifyPasskeyAdded emails the user with the IP in the body", async () => {
    await notifyPasskeyAdded({
      email: "user@bilan.local",
      ip: "203.0.113.7",
      userAgent: "Firefox",
      at: new Date("2026-03-01T10:00:00.000Z"),
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(arg.to).toBe("user@bilan.local");
    expect(arg.subject).toMatch(/clé d'accès/);
    expect(arg.subject).toContain("Maison");
    expect(arg.text).toContain("203.0.113.7");
  });
});
