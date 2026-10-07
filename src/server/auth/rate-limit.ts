type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 10_000;

export type Outcome = { allowed: true } | { allowed: false; retryAfterSec: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: { max: number; windowMs: number }) {}

  consume(key: string): Outcome {
    const now = Date.now();
    if (this.buckets.size >= MAX_BUCKETS) this.sweep(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.opts.windowMs });
      return { allowed: true };
    }
    if (bucket.count < this.opts.max) {
      bucket.count += 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}

// Singletons per spec §6.7.
// Per email, see login-guard.ts.
export const loginLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60_000 });
export const registerLimiter = new RateLimiter({ max: 3, windowMs: 60 * 60_000 });
export const resetLimiter = new RateLimiter({ max: 3, windowMs: 60 * 60_000 });
// Keyed by user id: caps current-password guessing from a hijacked session.
export const changePasswordLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60_000 });
// Keyed by the pending two-factor sign-in: caps code guesses after a valid password.
export const twoFactorLimiter = new RateLimiter({ max: 5, windowMs: 10 * 60_000 });
// Keyed by user id: caps invitation-code guessing.
export const invitationAcceptLimiter = new RateLimiter({ max: 10, windowMs: 15 * 60_000 });
