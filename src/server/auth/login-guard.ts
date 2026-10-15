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
import { loginAccountLimiter, loginLimiter, twoFactorLimiter } from "./rate-limit";
import { totpReplayGuard } from "./totp-replay";
import { CLIENT_IP_HEADER } from "@/server/http/client-ip";

const TWO_FACTOR_VERIFY = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

export function loginEmail(body: unknown): string {
  return String((body as { email?: unknown } | null)?.email ?? "")
    .trim()
    .toLowerCase();
}

// Spec §6.7, decision S2 (#243): per client IP and account, so nobody can lock an account
// out from elsewhere. Requests without a resolved IP share one bucket per account.
export function loginLimiterKey(ip: string | null | undefined, email: string): string {
  return `${ip || "unknown"}|${email}`;
}

function requestLoginKey(ctx: HookContext, email: string): string {
  return loginLimiterKey(ctx.headers?.get(CLIENT_IP_HEADER), email);
}

function retryAfterHeader(seconds: number): Record<string, string> {
  return { "Retry-After": String(seconds) };
}

function limitedEmail(ctx: HookContext): string | null {
  if (ctx.path !== "/sign-in/email") return null;
  const email = loginEmail(ctx.body);
  return z.email().max(254).safeParse(email).success ? email : null;
}

// Reserved before the password check so parallel requests can't slip past the limits. A
// completed sign-in (password, or code when 2FA is on) clears the IP + account bucket; the
// looser per-account one (rotating IPs, spec §6.7) only gives back the slot of a right password.
async function passwordAttemptGuard(ctx: HookContext): Promise<void> {
  const email = limitedEmail(ctx);
  if (!email) return;
  const key = requestLoginKey(ctx, email);
  const perIp = loginLimiter.consume(key);
  const outcome = perIp.allowed ? loginAccountLimiter.consume(email) : perIp;
  if (outcome.allowed) return;
  if (perIp.allowed) loginLimiter.refund(key, perIp.resetAt);
  await logEvent({
    action: "auth.login.failed",
    metadata: { method: "password", email, reason: "RATE_LIMITED" },
  });
  throw new APIError(
    "TOO_MANY_REQUESTS",
    {
      code: "RATE_LIMITED",
      message: "Too many failed sign-in attempts",
      retryAfter: outcome.retryAfterSec,
    },
    retryAfterHeader(outcome.retryAfterSec),
  );
}

function clearOnCompletedSignIn(ctx: HookContext): void {
  const returned = ctx.context.returned;
  const email = limitedEmail(ctx);
  const wrongPassword = isAPIError(returned) && returned.body?.code === "INVALID_EMAIL_OR_PASSWORD";
  if (email && !wrongPassword) loginAccountLimiter.refundCurrent(email);
  if (isAPIError(returned)) return;
  if (ctx.path === "/sign-in/email") {
    if ((returned as { twoFactorRedirect?: boolean }).twoFactorRedirect) return;
    loginLimiter.reset(requestLoginKey(ctx, loginEmail(ctx.body)));
  } else if (TWO_FACTOR_VERIFY.has(ctx.path)) {
    const email = (returned as { user?: { email?: string } }).user?.email;
    if (email) loginLimiter.reset(requestLoginKey(ctx, email.toLowerCase()));
  }
}

// Better Auth only rate-limits code attempts per IP in production; this caps
// guesses per pending sign-in, then forces the (email-limited) password step again.
async function twoFactorAttemptGuard(
  ctx: HookContext,
  pending: { id: string; userId: string } | null,
): Promise<void> {
  if (!pending) return;
  const outcome = twoFactorLimiter.consume(pending.id);
  if (outcome.allowed) return;
  await ctx.context.internalAdapter.deleteVerificationByIdentifier(pending.id);
  await logEvent({
    userId: pending.userId,
    action: "auth.login.failed",
    metadata: { method: "two_factor", reason: "TOO_MANY_ATTEMPTS" },
  });
  throw new APIError(
    "TOO_MANY_REQUESTS",
    { code: "TOO_MANY_ATTEMPTS" },
    retryAfterHeader(outcome.retryAfterSec),
  );
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
          const pending = TWO_FACTOR_VERIFY.has(ctx.path) ? await pendingTwoFactor(ctx) : null;
          await twoFactorAttemptGuard(ctx, pending);
          await totpReplayGuard(ctx, pending);
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
