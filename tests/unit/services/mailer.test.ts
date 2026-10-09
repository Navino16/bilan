import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ NODE_ENV: "production" }));
vi.mock("@/env", () => ({ env }));
vi.mock("@/server/crypto/keys", () => ({ dataKey: Buffer.alloc(32) }));
vi.mock("@/server/db", () => ({
  db: { smtpConfig: { findFirst: async () => null } },
}));

import { sendMail } from "@/server/services/mail/mailer";

const mail = { to: "user@bilan.local", subject: "Invitation", text: "Link: https://x/join/SECRET" };

describe("sendMail without SMTP", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  afterEach(() => info.mockClear());

  it("withholds a sensitive body from production logs", async () => {
    env.NODE_ENV = "production";
    expect(await sendMail({ ...mail, sensitive: true })).toEqual({ delivered: false });
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("Invitation");
    expect(logged).not.toContain("SECRET");
    expect(logged).toContain("(body withheld)");
  });

  it("logs the body of non-sensitive mails and of any mail outside production", async () => {
    env.NODE_ENV = "production";
    await sendMail(mail);
    env.NODE_ENV = "development";
    await sendMail({ ...mail, sensitive: true });
    expect(info.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("SECRET"),
      expect.stringContaining("SECRET"),
    ]);
  });
});
