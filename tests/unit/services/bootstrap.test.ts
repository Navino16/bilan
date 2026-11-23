import { describe, it, expect, vi } from "vitest";
import { isSetupNeeded, completeSetup } from "@/server/services/bootstrap";

describe("isSetupNeeded", () => {
  it("returns true when there are zero users", async () => {
    const count = vi.fn().mockResolvedValueOnce(0);
    const db = { user: { count } } as never;
    expect(await isSetupNeeded(db)).toBe(true);
  });
  it("returns false when at least one user exists", async () => {
    const count = vi.fn().mockResolvedValueOnce(1);
    const db = { user: { count } } as never;
    expect(await isSetupNeeded(db)).toBe(false);
  });
});

describe("completeSetup", () => {
  it("rejects when a user already exists", async () => {
    const count = vi.fn().mockResolvedValueOnce(1);
    const db = { user: { count } } as never;
    await expect(
      completeSetup({ email: "a@b.c", password: "x".repeat(12), name: "A" }, db),
    ).rejects.toThrow(/already/i);
  });
});
