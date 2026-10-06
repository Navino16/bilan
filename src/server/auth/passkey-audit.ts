import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { logEvent } from "@/server/services/audit";

// Passkey endpoints are called straight from the browser (WebAuthn), not through
// our Server Actions, so they are audited from a better-auth after-hook.
export const passkeyAuditHook = createAuthMiddleware(async (ctx) => {
  const returned = ctx.context.returned;
  try {
    switch (ctx.path) {
      case "/passkey/verify-registration": {
        if (isAPIError(returned)) return;
        const pk = returned as { id: string; userId: string };
        await logEvent({
          userId: pk.userId,
          action: "auth.passkey.added",
          entity: "Passkey",
          entityId: pk.id,
        });
        return;
      }
      case "/passkey/delete-passkey": {
        if (isAPIError(returned)) return;
        const session = await getSessionFromCtx(ctx);
        await logEvent({
          userId: session?.user.id ?? null,
          action: "auth.passkey.deleted",
          entity: "Passkey",
          entityId: (ctx.body as { id: string }).id,
        });
        return;
      }
      case "/passkey/verify-authentication": {
        if (isAPIError(returned)) {
          await logEvent({ action: "auth.login.failed", metadata: { method: "passkey" } });
          return;
        }
        const { user } = returned as { user: { id: string; email: string } };
        await logEvent({
          userId: user.id,
          action: "auth.login.success",
          metadata: { method: "passkey", email: user.email },
        });
        return;
      }
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
});
