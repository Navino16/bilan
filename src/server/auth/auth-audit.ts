import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
  type AuthMiddleware,
} from "better-auth/api";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import {
  notifyNewLogin,
  notifyPasskeyAdded,
  notifyTwoFactorDisabled,
} from "@/server/services/mail/security-notifications";
import { twoFactorLimiter } from "./rate-limit";

type AuditInput = Parameters<typeof logEvent>[0];

export type AuditContext = {
  sessionUserId: () => Promise<string | null>;
  // Owner of the pending sign-in (two_factor cookie), before any session exists.
  pendingUserId: () => Promise<string | null>;
  // Better Auth rotates the session when a TOTP verification really enables 2FA.
  sessionRotated: boolean;
};

const TWO_FACTOR_VERIFY = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

export async function authAuditEvent(
  path: string,
  returned: unknown,
  body: unknown,
  { sessionUserId, pendingUserId, sessionRotated }: AuditContext,
): Promise<AuditInput | null> {
  const failed = isAPIError(returned);
  switch (path) {
    case "/passkey/verify-registration": {
      if (failed) return null;
      const pk = returned as { id: string; userId: string };
      return {
        userId: pk.userId,
        action: "auth.passkey.added",
        entity: "Passkey",
        entityId: pk.id,
      };
    }
    case "/passkey/delete-passkey": {
      if (failed) return null;
      return {
        userId: await sessionUserId(),
        action: "auth.passkey.deleted",
        entity: "Passkey",
        entityId: (body as { id: string }).id,
      };
    }
    case "/passkey/verify-authentication": {
      if (failed) {
        return {
          action: "auth.login.failed",
          metadata: { method: "passkey", reason: returned.body?.code ?? null },
        };
      }
      const { user } = returned as { user: { id: string; email: string } };
      return {
        userId: user.id,
        action: "auth.login.success",
        metadata: { method: "passkey", email: user.email },
      };
    }
    case "/two-factor/verify-totp":
    case "/two-factor/verify-backup-code": {
      const method = path.endsWith("totp") ? "totp" : "backup_code";
      // Without a session this is the second sign-in step; with one, the user is
      // confirming enrolment from the Security page.
      const userId = await sessionUserId();
      if (failed) {
        if (userId) return null;
        const pending = await pendingUserId();
        if (!pending) return null;
        return {
          userId: pending,
          action: "auth.login.failed",
          metadata: { method, reason: returned.body?.code ?? null },
        };
      }
      const { user } = returned as { user: { id: string; email: string } };
      if (userId) {
        return method === "totp" && sessionRotated ? { userId, action: "auth.2fa.enabled" } : null;
      }
      return {
        userId: user.id,
        action: "auth.login.success",
        metadata: { method, email: user.email },
      };
    }
    case "/two-factor/disable": {
      if (failed) return null;
      return { userId: await sessionUserId(), action: "auth.2fa.disabled" };
    }
    default:
      return null;
  }
}

// Passkey and two-factor endpoints are called straight from the browser, not
// through our Server Actions, so they are audited from a better-auth after-hook.
export const authAuditHook = createAuthMiddleware(async (ctx) => {
  try {
    const event = await authAuditEvent(ctx.path, ctx.context.returned, ctx.body, {
      sessionUserId: async () => (await getSessionFromCtx(ctx))?.user.id ?? null,
      pendingUserId: async () => (await pendingTwoFactor(ctx))?.userId ?? null,
      sessionRotated: Boolean(ctx.context.newSession),
    });
    if (!event) return;
    await logEvent(event);
    if (
      event.userId &&
      (event.action === "auth.2fa.enabled" || event.action === "auth.2fa.disabled")
    ) {
      await db.verification.deleteMany({
        where: { value: event.userId, identifier: { startsWith: "trust-device-" } },
      });
    }
    const h = ctx.headers;
    const origin = {
      ip: h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h?.get("x-real-ip") ?? null,
      userAgent: h?.get("user-agent") ?? null,
      at: new Date(),
    };
    if (event.action === "auth.login.success") {
      void notifyNewLogin({ email: (event.metadata as { email: string }).email, ...origin });
    } else if (event.action === "auth.passkey.added" && event.userId) {
      const user = await db.user.findUnique({
        where: { id: event.userId },
        select: { email: true },
      });
      if (user) void notifyPasskeyAdded({ email: user.email, ...origin });
    } else if (event.action === "auth.2fa.disabled" && event.userId) {
      const user = await db.user.findUnique({
        where: { id: event.userId },
        select: { email: true },
      });
      if (user) void notifyTwoFactorDisabled({ email: user.email, ...origin });
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
});

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

async function pendingTwoFactor(ctx: HookContext) {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const id = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!id) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(id);
  return verification ? { id, userId: verification.value } : null;
}

// Better Auth only rate-limits code attempts per IP in production; this caps
// guesses per pending sign-in, then forces the (email-limited) password step again.
export const twoFactorAttemptGuard: AuthMiddleware = createAuthMiddleware(async (ctx) => {
  if (!TWO_FACTOR_VERIFY.has(ctx.path)) return;
  const pending = await pendingTwoFactor(ctx);
  if (!pending || twoFactorLimiter.consume(pending.id).allowed) return;
  await ctx.context.internalAdapter.deleteVerificationByIdentifier(pending.id);
  await logEvent({
    userId: pending.userId,
    action: "auth.login.failed",
    metadata: { method: "two_factor", reason: "TOO_MANY_ATTEMPTS" },
  });
  throw new APIError("TOO_MANY_REQUESTS", { code: "TOO_MANY_ATTEMPTS" });
});
