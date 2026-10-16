import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ NODE_ENV: "production" }));
vi.mock("@/env", () => ({ env }));
vi.mock("@/server/crypto/keys", () => ({ dataKey: Buffer.alloc(32) }));
vi.mock("@/server/crypto/encryption", () => ({ decrypt: () => "smtp-password" }));
const smtp = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));
vi.mock("@/server/db", () => ({
  db: { smtpConfig: { findFirst: async () => smtp.config } },
}));
const transport = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
const createTransport = vi.hoisted(() =>
  vi.fn<(options: Record<string, unknown>) => typeof transport>(() => transport),
);
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import type { SmtpConfig } from "@prisma/client";
import { sendMail, sendWithConfig } from "@/server/services/mail/mailer";

const mail = {
  to: "user@bilan.local",
  subject: "Invitation",
  text: "Link: https://x/join/SECRET",
  locale: "en" as const,
};

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

describe("sendMail through SMTP", () => {
  afterEach(() => {
    smtp.config = null;
    transport.sendMail.mockClear();
  });

  it("states the mail's language in a Content-Language header (#245)", async () => {
    smtp.config = { fromName: "Bilan", fromAddress: "bilan@example.com", passwordEnc: "x" };
    expect(await sendMail({ ...mail, locale: "fr" })).toEqual({ delivered: true });
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@bilan.local",
        from: "Bilan <bilan@example.com>",
        headers: { "Content-Language": "fr" },
      }),
    );
  });
});

describe("SMTP transport security (#255)", () => {
  const cfg = {
    host: "smtp.example.com",
    port: 587,
    username: "mailer",
    passwordEnc: "x",
    fromAddress: "bilan@example.com",
    fromName: null,
  };
  beforeEach(() => createTransport.mockClear());

  it.each([
    ["TLS", { secure: true }],
    ["STARTTLS", { secure: false, requireTLS: true }],
    ["NONE", { secure: false, ignoreTLS: true }],
  ] as const)("configures nodemailer for %s", async (security, expected) => {
    await sendWithConfig({ ...cfg, security } as SmtpConfig, mail);
    const options = createTransport.mock.calls[0]![0];
    expect(options).toMatchObject(expected);
    expect(options.requireTLS ?? false).toBe(security === "STARTTLS");
    expect(options.ignoreTLS ?? false).toBe(security === "NONE");
  });
});
