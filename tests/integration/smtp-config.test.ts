import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db } from "@/server/db";
import {
  upsertSmtp,
  getSmtpConfig,
  deleteSmtpConfig,
  sendSmtpTest,
  SmtpPasswordRequiredError,
  SMTP_SINGLETON_ID,
  smtpSchema,
} from "@/server/services/settings/smtp";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

const transport = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  sent: [] as Record<string, unknown>[],
  fail: null as Error | null,
}));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      transport.options.push(options);
      return {
        sendMail: async (mail: Record<string, unknown>) => {
          if (transport.fail) throw transport.fail;
          transport.sent.push(mail);
        },
      };
    },
  },
}));

const actor = { id: "smtp_actor" };
const mail = { to: "admin@bilan.local", subject: "Test", text: "Hello", locale: "en" as const };
const base = {
  host: "smtp.example.com",
  port: 587,
  security: "STARTTLS" as const,
  username: "mailer",
  fromAddress: "bilan@example.com",
  fromName: "Bilan",
  enabled: true,
};

beforeAll(async () => {
  await db.smtpConfig.deleteMany();
});

beforeEach(() => {
  transport.options.length = 0;
  transport.sent.length = 0;
  transport.fail = null;
});

afterAll(async () => {
  await db.smtpConfig.deleteMany();
  await db.auditLog.deleteMany({ where: { userId: actor.id } });
  await db.$disconnect();
});

describe("SMTP config service", () => {
  it("requires a password when no config exists yet", async () => {
    await expect(upsertSmtp({ ...base, password: "" }, actor)).rejects.toBeInstanceOf(
      SmtpPasswordRequiredError,
    );
  });

  it("stores an encrypted, singleton SMTP config", async () => {
    const row = await upsertSmtp({ ...base, password: "super-secret" }, actor);
    expect(row.id).toBe(SMTP_SINGLETON_ID);
    expect(row.passwordEnc).not.toBe("super-secret");
    expect(decrypt(row.passwordEnc, dataKey)).toBe("super-secret");
    expect(await db.smtpConfig.count()).toBe(1);
  });

  it("defaults to STARTTLS and rejects unknown modes (#255)", () => {
    const input: Record<string, unknown> = { ...base, password: "secret" };
    delete input.security;
    expect(smtpSchema.parse(input).security).toBe("STARTTLS");
    expect(smtpSchema.safeParse({ ...input, security: "SSL" }).success).toBe(false);
  });

  it("round-trips each security mode (#255)", async () => {
    for (const security of ["TLS", "NONE", "STARTTLS"] as const) {
      await upsertSmtp({ ...base, security, password: "super-secret" }, actor);
      expect((await getSmtpConfig())?.security).toBe(security);
    }
  });

  it("keeps the stored password when left empty for the same server and account", async () => {
    await upsertSmtp(
      { ...base, fromAddress: "noreply@example.com", password: "", enabled: false },
      actor,
    );
    expect(await db.smtpConfig.count()).toBe(1);
    const cfg = await getSmtpConfig();
    expect(cfg?.fromAddress).toBe("noreply@example.com");
    expect(cfg?.enabled).toBe(false);
    expect(decrypt(cfg!.passwordEnc, dataKey)).toBe("super-secret");
  });

  it.each([
    ["host", { host: "evil.example.com" }],
    ["port", { port: 465 }],
    ["username", { username: "someone-else" }],
    ["encryption", { security: "TLS" as const }],
  ])("requires the password again when the %s changes", async (_field, change) => {
    await expect(upsertSmtp({ ...base, ...change, password: "" }, actor)).rejects.toBeInstanceOf(
      SmtpPasswordRequiredError,
    );
    expect((await getSmtpConfig())?.host).toBe("smtp.example.com");
  });

  it("updates the same singleton row with a new server and password", async () => {
    await upsertSmtp(
      {
        ...base,
        host: "smtp2.example.com",
        port: 465,
        security: "TLS",
        password: "super-secret",
        enabled: false,
      },
      actor,
    );
    expect(await db.smtpConfig.count()).toBe(1);
    expect((await getSmtpConfig())?.host).toBe("smtp2.example.com");
  });

  it("sends a test mail through the saved config even when disabled, and audits it", async () => {
    expect(await sendSmtpTest(mail, actor)).toEqual({ ok: true });
    expect(transport.options[0]).toMatchObject({
      host: "smtp2.example.com",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "super-secret" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    expect(transport.sent[0]).toMatchObject({
      to: mail.to,
      from: "Bilan <bilan@example.com>",
      headers: { "Content-Language": "en" },
    });
    const audit = await db.auditLog.findFirst({
      where: { userId: actor.id, action: "settings.smtp.test" },
    });
    expect(audit?.metadata).toMatchObject({ ok: true });
  });

  it("reports only a coarse failure code, never the server's reply", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.fail = Object.assign(new Error("535 5.7.8 banner of internal-host"), {
      code: "EAUTH",
    });
    const res = await sendSmtpTest(mail, actor);
    expect(res).toEqual({ ok: false, error: "SEND_FAILED", reason: "EAUTH" });
    expect(JSON.stringify(res)).not.toContain("internal-host");

    transport.fail = Object.assign(new Error("weird"), { code: "EWHATEVER" });
    expect(await sendSmtpTest(mail, actor)).toEqual({
      ok: false,
      error: "SEND_FAILED",
      reason: "OTHER",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("removes the config, after which a test reports it missing", async () => {
    expect(await deleteSmtpConfig(actor)).toBe(true);
    expect(await getSmtpConfig()).toBeNull();
    expect(await deleteSmtpConfig(actor)).toBe(false);
    expect(await sendSmtpTest(mail, actor)).toEqual({ ok: false, error: "NOT_CONFIGURED" });
    expect(transport.sent).toHaveLength(0);
  });
});
