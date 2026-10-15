import { describe, it, expect } from "vitest";
import { checkRoleChange } from "@/server/services/users/roles";
import { creatableRoles, topRole } from "@/lib/instance-roles";

const base = {
  actorId: "actor",
  actorIsSuperAdmin: true,
  targetId: "target",
  otherActiveSuperAdmins: 1,
} as const;

describe("topRole", () => {
  it("picks the most privileged role, USER when none", () => {
    expect(topRole(["ADMIN", "SUPER_ADMIN"])).toBe("SUPER_ADMIN");
    expect(topRole(["USER", "ADMIN"])).toBe("ADMIN");
    expect(topRole([])).toBe("USER");
  });
});

describe("creatableRoles", () => {
  it("offers ADMIN only to an active super admin (#223)", () => {
    expect(creatableRoles(true)).toEqual(["USER", "ADMIN"]);
    expect(creatableRoles(false)).toEqual(["USER"]);
  });
});

describe("checkRoleChange", () => {
  it("allows a super admin to promote and demote another user", () => {
    expect(checkRoleChange({ ...base, from: "USER", to: "ADMIN" })).toBeNull();
    expect(checkRoleChange({ ...base, from: "ADMIN", to: "SUPER_ADMIN" })).toBeNull();
    expect(checkRoleChange({ ...base, from: "SUPER_ADMIN", to: "USER" })).toBeNull();
  });

  it("refuses to change the actor's own role", () => {
    expect(checkRoleChange({ ...base, targetId: "actor", from: "SUPER_ADMIN", to: "USER" })).toBe(
      "SELF",
    );
  });

  it("refuses a non super admin granting or revoking an admin role", () => {
    const admin = { ...base, actorIsSuperAdmin: false };
    expect(checkRoleChange({ ...admin, from: "USER", to: "ADMIN" })).toBe("FORBIDDEN");
    expect(checkRoleChange({ ...admin, from: "ADMIN", to: "USER" })).toBe("FORBIDDEN");
    expect(checkRoleChange({ ...admin, from: "USER", to: "SUPER_ADMIN" })).toBe("FORBIDDEN");
  });

  it("never removes the last super admin", () => {
    expect(
      checkRoleChange({ ...base, otherActiveSuperAdmins: 0, from: "SUPER_ADMIN", to: "ADMIN" }),
    ).toBe("LAST_SUPER_ADMIN");
    expect(
      checkRoleChange({ ...base, otherActiveSuperAdmins: 0, from: "USER", to: "SUPER_ADMIN" }),
    ).toBeNull();
  });
});
