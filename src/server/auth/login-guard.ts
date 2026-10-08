import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { logEvent } from "@/server/services/audit";
import {
  auditAuthRequest,
  auditLinkFailure,
  pendingTwoFactor,
  type HookContext,
} from "./auth-audit";
import { loginLimiter, twoFactorLimiter } from "./rate-limit";

const TWO_FACTOR_VERIFY = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

export function loginEmail(body: unknown): string {
  return String((body as { email?: unknown } | null)?.email ?? "")
    .trim()
    .toLowerCase();
}

// Reserved before the password check so parallel requests can't slip past the
// limit; a completed sign-in (password, or code when 2FA is on) clears it.
async function passwordAttemptGuard(ctx: HookContext): Promise<void> {
  if (ctx.path !== "/sign-in/email") return;
  const email = loginEmail(ctx.body);
  if (!z.email().max(254).safeParse(email).success) return;
  const outcome = loginLimiter.consume(email);
  if (outcome.allowed) return;
  await logEvent({
    action: "auth.login.failed",
    metadata: { method: "password", email, reason: "RATE_LIMITED" },
  });
  throw new APIError("TOO_MANY_REQUESTS", {
    code: "RATE_LIMITED",
    message: "Too many failed sign-in attempts",
    retryAfter: outcome.retryAfterSec,
  });
}

function clearOnCompletedSignIn(ctx: HookContext): void {
  const returned = ctx.context.returned;
  if (isAPIError(returned)) return;
  if (ctx.path === "/sign-in/email") {
    if ((returned as { twoFactorRedirect?: boolean }).twoFactorRedirect) return;
    loginLimiter.reset(loginEmail(ctx.body));
  } else if (TWO_FACTOR_VERIFY.has(ctx.path)) {
    const email = (returned as { user?: { email?: string } }).user?.email;
    if (email) loginLimiter.reset(email.toLowerCase());
  }
}

// Better Auth only rate-limits code attempts per IP in production; this caps
// guesses per pending sign-in, then forces the (email-limited) password step again.
async function twoFactorAttemptGuard(ctx: HookContext): Promise<void> {
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
}

// genericOAuth also registers its OIDC configs as social providers, without their
// disableSignUp: the core social routes would sign them up whatever the gate says (#204).
function coreSocialRouteGuard(ctx: HookContext): void {
  const builtIn = Object.keys(ctx.context.options.socialProviders ?? {});
  const provider =
    ctx.path === "/sign-in/social"
      ? (ctx.body as { provider?: unknown } | null)?.provider
      : ctx.path === "/callback/:id"
        ? (ctx.params as { id?: string } | undefined)?.id
        : null;
  if (provider === null) return;
  if (typeof provider !== "string" || !builtIn.includes(provider)) {
    throw new APIError("NOT_FOUND", { code: "PROVIDER_NOT_FOUND" });
  }
}

// A plugin rather than `options.hooks`: plugin after-hooks run after the user ones,
// and ours must see the twoFactor plugin's rewrite of the sign-in response
// (`{ twoFactorRedirect }`), so it is registered after twoFactor().
export const authGuardPlugin = {
  id: "bilan-auth-guard",
  hooks: {
    before: [
      {
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          coreSocialRouteGuard(ctx);
          await passwordAttemptGuard(ctx);
          await twoFactorAttemptGuard(ctx);
        }),
      },
    ],
    after: [
      {
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          clearOnCompletedSignIn(ctx);
          await auditAuthRequest(ctx);
          await auditLinkFailure(ctx);
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;
