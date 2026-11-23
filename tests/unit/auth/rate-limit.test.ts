import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimiter, withRefund } from "@/server/auth/rate-limit";

describe("RateLimiter", () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("allows up to the limit within the window", () => {
    const rl = new RateLimiter({ max: 3, windowMs: 60_000 });
    expect(rl.consume("1.2.3.4").allowed).toBe(true);
    expect(rl.consume("1.2.3.4").allowed).toBe(true);
    expect(rl.consume("1.2.3.4").allowed).toBe(true);
    const blocked = rl.consume("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates buckets by key", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    expect(rl.consume("a").allowed).toBe(true);
    expect(rl.consume("a").allowed).toBe(false);
    expect(rl.consume("b").allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    expect(rl.consume("a").allowed).toBe(true);
    expect(rl.consume("a").allowed).toBe(false);
    now += 60_001;
    expect(rl.consume("a").allowed).toBe(true);
  });

  it("reset clears a key", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    rl.consume("k");
    expect(rl.consume("k").allowed).toBe(false);
    rl.reset("k");
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("refund gives back one slot of the window it was taken from", () => {
    const rl = new RateLimiter({ max: 2, windowMs: 60_000 });
    rl.consume("k");
    const taken = rl.consume("k");
    expect(taken.allowed).toBe(true);
    if (taken.allowed) rl.refund("k", taken.resetAt);
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(false);
  });

  it("refund is a no-op once the window has rolled over", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    const taken = rl.consume("k");
    now += 60_001;
    expect(rl.consume("k").allowed).toBe(true);
    if (taken.allowed) rl.refund("k", taken.resetAt);
    expect(rl.consume("k").allowed).toBe(false);
  });

  it("refundCurrent gives back one slot of the current window", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    rl.consume("k");
    rl.refundCurrent("k");
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(false);
    rl.refundCurrent("missing");
  });

  it("withRefund keeps only the results that should count", async () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    const isBad = (r: string) => r === "bad";
    expect(await withRefund(rl, "k", async () => "ok", isBad)).toEqual({
      allowed: true,
      result: "ok",
    });
    expect(await withRefund(rl, "k", async () => "bad", isBad)).toEqual({
      allowed: true,
      result: "bad",
    });
    const blocked = await withRefund(rl, "k", async () => "ok", isBad);
    expect(blocked).toMatchObject({ allowed: false });
  });

  it("never holds more than maxBuckets: expired buckets go first, then the oldest (#243)", () => {
    const buckets = new Map();
    const rl = new RateLimiter({ max: 1, windowMs: 60_000, maxBuckets: 3 }, buckets);
    rl.consume("a");
    now += 30_000;
    rl.consume("b");
    rl.consume("c");
    now += 30_001;
    // "a" expired: renewing it moves it behind "b" and "c".
    expect(rl.consume("a").allowed).toBe(true);
    expect([...buckets.keys()]).toEqual(["b", "c", "a"]);

    expect(rl.consume("d").allowed).toBe(true);
    expect(buckets.size).toBe(3);
    expect([...buckets.keys()]).toEqual(["c", "a", "d"]);
    // The evicted live bucket starts over.
    expect(rl.consume("b").allowed).toBe(true);
    expect([...buckets.keys()]).toEqual(["a", "d", "b"]);
    expect(rl.consume("d").allowed).toBe(false);
  });

  it("drops every expired bucket it meets before evicting a live one", () => {
    const buckets = new Map();
    const rl = new RateLimiter({ max: 1, windowMs: 60_000, maxBuckets: 3 }, buckets);
    rl.consume("a");
    rl.consume("b");
    now += 30_000;
    rl.consume("c");
    now += 30_001;
    expect(rl.consume("d").allowed).toBe(true);
    expect([...buckets.keys()]).toEqual(["c", "d"]);
  });

  it("limiters given the same buckets share their counters", () => {
    const buckets = new Map();
    const first = new RateLimiter({ max: 1, windowMs: 60_000 }, buckets);
    const second = new RateLimiter({ max: 1, windowMs: 60_000 }, buckets);
    expect(first.consume("k").allowed).toBe(true);
    expect(second.consume("k").allowed).toBe(false);
  });
});
