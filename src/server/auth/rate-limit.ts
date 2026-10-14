import { processState } from "@/server/process-state";

type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 10_000;

// `resetAt` identifies the window the slot was taken from (see refund).
export type Outcome =
  | { allowed: true; resetAt: number }
  | { allowed: false; retryAfterSec: number };

export class RateLimiter {
  constructor(
    private opts: { max: number; windowMs: number },
    private buckets = new Map<string, Bucket>(),
  ) {}

  consume(key: string): Outcome {
    const now = Date.now();
    if (this.buckets.size >= MAX_BUCKETS) this.sweep(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
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

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
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
// Per email, see login-guard.ts.
export const loginLimiter = sharedLimiter("login", { max: 5, windowMs: 15 * 60_000 });
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
