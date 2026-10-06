import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { notifyNewLogin, notifyPasskeyAdded } from "@/server/services/mail/security-notifications";

type AuditInput = Parameters<typeof logEvent>[0];

export async function passkeyAuditEvent(
  path: string,
  returned: unknown,
  body: unknown,
  sessionUserId: () => Promise<string | null>,
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
    default:
      return null;
  }
}

// Passkey endpoints are called straight from the browser (WebAuthn), not through
// our Server Actions, so they are audited from a better-auth after-hook.
export const passkeyAuditHook = createAuthMiddleware(async (ctx) => {
  try {
    const event = await passkeyAuditEvent(
      ctx.path,
      ctx.context.returned,
      ctx.body,
      async () => (await getSessionFromCtx(ctx))?.user.id ?? null,
    );
    if (!event) return;
    await logEvent(event);
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
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
});
