import { describe, it, expect } from "vitest";
import { APIError } from "better-auth/api";
import { passkeyAuditEvent } from "@/server/auth/passkey-audit";

const sessionUser = async () => "user-1";
const failure = APIError.from("BAD_REQUEST", { code: "CHALLENGE_NOT_FOUND", message: "x" });

describe("passkeyAuditEvent", () => {
  it("audits a registered passkey with its owner", async () => {
    const event = await passkeyAuditEvent(
      "/passkey/verify-registration",
      { id: "pk-1", userId: "user-1" },
      {},
      sessionUser,
    );
    expect(event).toEqual({
      userId: "user-1",
      action: "auth.passkey.added",
      entity: "Passkey",
      entityId: "pk-1",
    });
  });

  it("audits a deleted passkey with the session user", async () => {
    const event = await passkeyAuditEvent(
      "/passkey/delete-passkey",
      { status: true },
      { id: "pk-1" },
      sessionUser,
    );
    expect(event).toEqual({
      userId: "user-1",
      action: "auth.passkey.deleted",
      entity: "Passkey",
      entityId: "pk-1",
    });
  });

  it("audits a passkey sign-in", async () => {
    const event = await passkeyAuditEvent(
      "/passkey/verify-authentication",
      { session: {}, user: { id: "user-1", email: "a@b.c" } },
      {},
      sessionUser,
    );
    expect(event).toEqual({
      userId: "user-1",
      action: "auth.login.success",
      metadata: { method: "passkey", email: "a@b.c" },
    });
  });

  it("audits a failed passkey sign-in with its reason", async () => {
    const event = await passkeyAuditEvent(
      "/passkey/verify-authentication",
      failure,
      {},
      sessionUser,
    );
    expect(event).toEqual({
      action: "auth.login.failed",
      metadata: { method: "passkey", reason: "CHALLENGE_NOT_FOUND" },
    });
  });

  it("ignores failed registrations and deletions, and other routes", async () => {
    for (const path of ["/passkey/verify-registration", "/passkey/delete-passkey"]) {
      expect(await passkeyAuditEvent(path, failure, { id: "pk-1" }, sessionUser)).toBeNull();
    }
    expect(await passkeyAuditEvent("/passkey/update-passkey", {}, {}, sessionUser)).toBeNull();
  });
});
