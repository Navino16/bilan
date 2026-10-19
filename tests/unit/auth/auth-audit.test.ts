import { describe, it, expect } from "vitest";
import { APIError } from "better-auth/api";
import { authAuditEvent, ssoCallbackEvent, type AuditContext } from "@/server/auth/auth-audit";

const none = async () => null;
const user1 = async () => "user-1";
const signedIn: AuditContext = { sessionUserId: user1, pendingUserId: none, sessionRotated: false };
const pendingSignIn: AuditContext = {
  sessionUserId: none,
  pendingUserId: user1,
  sessionRotated: true,
};
const failure = APIError.from("BAD_REQUEST", { code: "CHALLENGE_NOT_FOUND", message: "x" });

describe("authAuditEvent", () => {
  describe("passkeys", () => {
    it("audits a registered passkey with its owner", async () => {
      const event = await authAuditEvent(
        "/passkey/verify-registration",
        { id: "pk-1", userId: "user-1" },
        {},
        signedIn,
      );
      expect(event).toEqual({
        userId: "user-1",
        action: "auth.passkey.added",
        entity: "Passkey",
        entityId: "pk-1",
      });
    });

    it("audits a deleted passkey with the session user", async () => {
      const event = await authAuditEvent(
        "/passkey/delete-passkey",
        { status: true },
        { id: "pk-1" },
        signedIn,
      );
      expect(event).toEqual({
        userId: "user-1",
        action: "auth.passkey.deleted",
        entity: "Passkey",
        entityId: "pk-1",
      });
    });

    it("audits a passkey sign-in", async () => {
      const event = await authAuditEvent(
        "/passkey/verify-authentication",
        { session: {}, user: { id: "user-1", email: "a@b.c" } },
        {},
        signedIn,
      );
      expect(event).toEqual({
        userId: "user-1",
        action: "auth.login.success",
        metadata: { method: "passkey", email: "a@b.c" },
      });
    });

    it("audits a failed passkey sign-in with its reason", async () => {
      const event = await authAuditEvent("/passkey/verify-authentication", failure, {}, signedIn);
      expect(event).toEqual({
        action: "auth.login.failed",
        metadata: { method: "passkey", reason: "CHALLENGE_NOT_FOUND" },
      });
    });

    it("ignores failed registrations and deletions, and other routes", async () => {
      for (const path of ["/passkey/verify-registration", "/passkey/delete-passkey"]) {
        expect(await authAuditEvent(path, failure, { id: "pk-1" }, signedIn)).toBeNull();
      }
      expect(await authAuditEvent("/passkey/update-passkey", {}, {}, signedIn)).toBeNull();
    });
  });

  describe("two-factor", () => {
    const badCode = APIError.from("UNAUTHORIZED", { code: "INVALID_CODE", message: "x" });
    const verified = { token: "t", user: { id: "user-1", email: "a@b.c" } };

    it("audits the second sign-in step as a login", async () => {
      expect(await authAuditEvent("/two-factor/verify-totp", verified, {}, pendingSignIn)).toEqual({
        userId: "user-1",
        action: "auth.login.success",
        metadata: { method: "totp", email: "a@b.c" },
      });
      expect(
        await authAuditEvent("/two-factor/verify-backup-code", verified, {}, pendingSignIn),
      ).toEqual({
        userId: "user-1",
        action: "auth.login.success",
        metadata: { method: "backup_code", email: "a@b.c" },
      });
    });

    it("audits a wrong code at sign-in against the pending user", async () => {
      expect(await authAuditEvent("/two-factor/verify-totp", badCode, {}, pendingSignIn)).toEqual({
        userId: "user-1",
        action: "auth.login.failed",
        metadata: { method: "totp", reason: "INVALID_CODE" },
      });
    });

    it("ignores a code sent without any pending sign-in", async () => {
      const anonymous = { sessionUserId: none, pendingUserId: none, sessionRotated: false };
      expect(await authAuditEvent("/two-factor/verify-totp", badCode, {}, anonymous)).toBeNull();
    });

    it("audits enrolment only when the session was rotated", async () => {
      expect(
        await authAuditEvent(
          "/two-factor/verify-totp",
          verified,
          {},
          {
            ...signedIn,
            sessionRotated: true,
          },
        ),
      ).toEqual({ userId: "user-1", action: "auth.2fa.enabled" });
      expect(await authAuditEvent("/two-factor/verify-totp", verified, {}, signedIn)).toBeNull();
      expect(
        await authAuditEvent("/two-factor/verify-backup-code", verified, {}, signedIn),
      ).toBeNull();
      expect(await authAuditEvent("/two-factor/verify-totp", badCode, {}, signedIn)).toBeNull();
    });

    it("audits disabling, not a failed attempt", async () => {
      expect(await authAuditEvent("/two-factor/disable", { status: true }, {}, signedIn)).toEqual({
        userId: "user-1",
        action: "auth.2fa.disabled",
      });
      expect(await authAuditEvent("/two-factor/disable", badCode, {}, signedIn)).toBeNull();
    });
  });

  describe("password sign-in", () => {
    const body = { email: " A@B.c ", password: "x" };

    it("audits success, the 2FA step and failures with the email", async () => {
      expect(
        await authAuditEvent(
          "/sign-in/email",
          { token: "t", user: { id: "user-1", email: "a@b.c" } },
          body,
          signedIn,
        ),
      ).toEqual({
        userId: "user-1",
        action: "auth.login.success",
        metadata: { method: "password", email: "a@b.c" },
      });
      expect(
        await authAuditEvent("/sign-in/email", { twoFactorRedirect: true }, body, signedIn),
      ).toEqual({ action: "auth.login.2fa_pending", metadata: { email: "a@b.c" } });
      const bad = APIError.from("UNAUTHORIZED", {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "x",
      });
      expect(await authAuditEvent("/sign-in/email", bad, body, signedIn)).toEqual({
        action: "auth.login.failed",
        metadata: { method: "password", email: "a@b.c", reason: "INVALID_EMAIL_OR_PASSWORD" },
      });
    });
  });
});

describe("ssoCallbackEvent (#258)", () => {
  const user = { id: "user-1", email: "a@b.c" };
  const base = { providerId: "authentik", user: null, signedUp: false, state: null, error: null };

  it("audits a session opened by the callback as an SSO sign-in", () => {
    expect(ssoCallbackEvent({ ...base, user })).toEqual({
      userId: "user-1",
      action: "auth.login.success",
      metadata: { method: "sso", providerId: "authentik", email: "a@b.c" },
    });
  });

  it("audits a first SSO sign-in that created the account as a sign-up only", () => {
    expect(ssoCallbackEvent({ ...base, user, signedUp: true })).toEqual({
      userId: "user-1",
      action: "auth.register.success",
      metadata: { method: "sso", providerId: "authentik", email: "a@b.c" },
    });
  });

  it("audits a refused SSO sign-in with Better Auth's error code", () => {
    expect(ssoCallbackEvent({ ...base, state: {}, error: "account_not_linked" })).toEqual({
      action: "auth.login.failed",
      metadata: { method: "sso", providerId: "authentik", reason: "account_not_linked" },
    });
  });

  it("audits a refused link for the user who started it", () => {
    const state = { link: { userId: "user-1" } };
    expect(ssoCallbackEvent({ ...base, state, error: "email_doesn't_match" })).toEqual({
      userId: "user-1",
      action: "auth.identity.link_failed",
      metadata: { providerId: "authentik", error: "email_doesn't_match" },
    });
  });

  it("records an error code it doesn't know as other", () => {
    const forged = "<script>alert(1)</script> call +33 6 12 34 56 78";
    expect(ssoCallbackEvent({ ...base, state: {}, error: forged })?.metadata?.reason).toBe("other");
    const state = { link: { userId: "user-1" } };
    expect(ssoCallbackEvent({ ...base, state, error: forged })?.metadata?.error).toBe("other");
  });

  it("doesn't count a sign-in cancelled at the IdP as failed, but still audits a cancelled link", () => {
    expect(ssoCallbackEvent({ ...base, state: {}, error: "access_denied" })).toBeNull();
    const state = { link: { userId: "user-1" } };
    expect(ssoCallbackEvent({ ...base, state, error: "access_denied" })?.metadata).toEqual({
      providerId: "authentik",
      error: "access_denied",
    });
  });

  it("ignores a completed link, and a failure whose state was never read", () => {
    expect(ssoCallbackEvent({ ...base, state: { link: { userId: "user-1" } } })).toBeNull();
    expect(ssoCallbackEvent({ ...base, error: "signup_disabled" })).toBeNull();
  });
});
