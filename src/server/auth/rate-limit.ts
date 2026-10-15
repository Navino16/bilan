import { processState } from "@/server/process-state";

type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 10_000;

// `resetAt` identifies the window the slot was taken from (see refund).
export type Outcome =
  | { allowed: true; resetAt: number }
  | { allowed: false; retryAfterSec: number };

export class RateLimiter {
  constructor(
    private opts: { max: number; windowMs: number; maxBuckets?: number },
    private buckets = new Map<string, Bucket>(),
  ) {}

  consume(key: string): Outcome {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.delete(key);
      this.makeRoom(now);
      const resetAt = now + this.opts.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, resetAt };
    }
    if (bucket.count < this.opts.max) {
      bucket.count += 1;
      return { allowed: true, resetAt: bucket.resetAt };
    }
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  // Gives back a slot taken by consume(); a no-op once that window has been replaced.
  refund(key: string, resetAt: number): void {
    const bucket = this.buckets.get(key);
    if (bucket?.resetAt === resetAt && bucket.count > 0) bucket.count -= 1;
  }

  // For callers that can't carry `resetAt` from consume() (the login hooks).
  refundCurrent(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) this.refund(key, bucket.resetAt);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  // Buckets are (re)created at the end of the map with a fixed window, so insertion order is
  // expiry order: drop from the front while expired, or while the hard cap is reached.
  private makeRoom(now: number): void {
    const cap = this.opts.maxBuckets ?? MAX_BUCKETS;
    for (const [key, bucket] of this.buckets) {
      if (this.buckets.size < cap && bucket.resetAt > now) return;
      this.buckets.delete(key);
    }
  }
}

// Reserves a slot before `run` (parallel calls can't slip past the limit) and gives it back
// unless `keep(result)`, so only the attempts that should count draw on the budget.
export async function withRefund<T>(
  limiter: RateLimiter,
  key: string,
  run: () => Promise<T>,
  keep: (result: T) => boolean,
): Promise<{ allowed: true; result: T } | { allowed: false; retryAfterSec: number }> {
  const outcome = limiter.consume(key);
  if (!outcome.allowed) return outcome;
  const result = await run();
  if (!keep(result)) limiter.refund(key, outcome.resetAt);
  return { allowed: true, result };
}

// Counters are per process, not per route bundle (#208).
function sharedLimiter(name: string, opts: { max: number; windowMs: number }): RateLimiter {
  return new RateLimiter(
    opts,
    processState(`rate-limit.${name}`, () => new Map<string, Bucket>()),
  );
}

// Singletons per spec §6.7.
// Per client IP + email, then per email alone, see login-guard.ts.
export const loginLimiter = sharedLimiter("login", { max: 5, windowMs: 15 * 60_000 });
export const loginAccountLimiter = sharedLimiter("loginAccount", {
  max: 30,
  windowMs: 60 * 60_000,
});
export const registerLimiter = sharedLimiter("register", { max: 3, windowMs: 60 * 60_000 });
export const resetLimiter = sharedLimiter("reset", { max: 3, windowMs: 60 * 60_000 });
// Keyed by user id: caps current-password guessing from a hijacked session (password change
// and 2FA enable/disable share it).
export const changePasswordLimiter = sharedLimiter("changePassword", {
  max: 5,
  windowMs: 15 * 60_000,
});
// Keyed by the pending two-factor sign-in: caps code guesses after a valid password.
export const twoFactorLimiter = sharedLimiter("twoFactor", { max: 5, windowMs: 10 * 60_000 });
// Keyed by user id: caps invitation-code guessing.
export const invitationAcceptLimiter = sharedLimiter("invitationAccept", {
  max: 10,
  windowMs: 15 * 60_000,
});
// Keyed by user id: each SMTP test opens an outbound connection.
export const smtpTestLimiter = sharedLimiter("smtpTest", { max: 5, windowMs: 60_000 });
// Keyed by user id: each resend mails the user's address.
export const verificationMailLimiter = sharedLimiter("verificationMail", {
  max: 3,
  windowMs: 60 * 60_000,
});
