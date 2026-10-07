import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimiter } from "@/server/auth/rate-limit";

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
});
