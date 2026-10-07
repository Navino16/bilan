import { describe, it, expect, vi, beforeEach } from "vitest";
import { activeSession, buildPermissionsChecker } from "@/server/auth/permissions";

describe("buildPermissionsChecker", () => {
  const findUnique = vi.fn();
  const db = { user: { findUnique } } as never;
  beforeEach(() => findUnique.mockReset());

  it("returns true when the user holds the permission via a role", async () => {
    findUnique.mockResolvedValueOnce({
      roles: [{ role: { permissions: [{ permission: { key: "admin.settings.write" } }] } }],
    });
    const check = buildPermissionsChecker(db);
    expect(await check("user_1", "admin.settings.write")).toBe(true);
  });

  it("returns false when the user has no matching permission", async () => {
    findUnique.mockResolvedValueOnce({
      roles: [{ role: { permissions: [{ permission: { key: "admin.users.read" } }] } }],
    });
    const check = buildPermissionsChecker(db);
    expect(await check("user_1", "admin.settings.write")).toBe(false);
  });

  it("returns false for a missing user", async () => {
    findUnique.mockResolvedValueOnce(null);
    const check = buildPermissionsChecker(db);
    expect(await check("ghost", "anything")).toBe(false);
  });

  it("returns false for a disabled user, whatever their roles", async () => {
    findUnique.mockResolvedValueOnce({
      banned: true,
      roles: [{ role: { permissions: [{ permission: { key: "admin.settings.write" } }] } }],
    });
    const check = buildPermissionsChecker(db);
    expect(await check("user_1", "admin.settings.write")).toBe(false);
  });
});

describe("activeSession", () => {
  it("drops the session of a disabled user", () => {
    const session = { user: { id: "u", banned: false } };
    expect(activeSession(session)).toBe(session);
    expect(activeSession({ user: { id: "u", banned: null } })).not.toBeNull();
    expect(activeSession({ user: { id: "u", banned: true } })).toBeNull();
    expect(activeSession(null)).toBeNull();
  });
});
