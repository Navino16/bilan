import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { seedRolesAndPermissions } from "@/../prisma/seed";
import { buildPermissionsChecker } from "@/server/auth/permissions";
import { grantRole, setUserRole } from "@/server/services/users/roles";
import {
  adminDeleteUser,
  checkUserAdminAction,
  deleteOwnAccount,
  setUserDisabled,
  userDeletionImpact,
} from "@/server/services/users/lifecycle";

const stamp = Date.now();
const password = "lifecycle-strong-password-1";
const ids: Record<string, string> = {};
const KEYS = [
  "super1",
  "super2",
  "super3",
  "admin",
  "admin2",
  "user",
  "victim",
  "owner",
  "member",
  "owner2",
  "coOwner",
  "member2",
  "loner",
];

const emailOf = (key: string) => `lc-${key}+${stamp}@bilan.local`;

async function signIn(key: string): Promise<string> {
  const auth = await getAuth();
  try {
    await auth.api.signInEmail({ body: { email: emailOf(key), password } });
    return "OK";
  } catch (e) {
    return isAPIError(e) ? String(e.body?.code) : "THROWN";
  }
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e: Error) => e.message,
  );

async function household(name: string, members: [string, string][]) {
  const g = await db.group.create({ data: { name, createdById: ids[members[0][0]] } });
  for (const [key, role] of members) {
    await db.groupMember.create({ data: { groupId: g.id, userId: ids[key], role } });
  }
  return g.id;
}

beforeAll(async () => {
  await seedRolesAndPermissions(db);
  const auth = await getAuth();
  for (const key of KEYS) {
    const res = await auth.api.signUpEmail({
      body: { email: emailOf(key), password, name: `LC ${key}` },
    });
    ids[key] = res.user.id;
  }
  for (const key of ["super1", "super2", "super3"]) await grantRole(db, ids[key], "SUPER_ADMIN");
  await grantRole(db, ids.admin, "ADMIN");
  await grantRole(db, ids.admin2, "ADMIN");

  await household(`LC shared ${stamp}`, [
    ["owner", "OWNER"],
    ["member", "MEMBER"],
  ]);
  await household(`LC co-owned ${stamp}`, [
    ["owner2", "OWNER"],
    ["member2", "MEMBER"],
    ["coOwner", "OWNER"],
  ]);
  await household(`LC solo ${stamp}`, [["loner", "OWNER"]]);
});

afterAll(async () => {
  const all = Object.values(ids);
  await db.group.deleteMany({ where: { name: { contains: `${stamp}` } } });
  await db.auditLog.deleteMany({
    where: { OR: [{ userId: { in: all } }, { entityId: { in: all } }] },
  });
  await db.user.deleteMany({ where: { id: { in: all } } });
  await db.$disconnect();
});

describe("setUserDisabled", () => {
  it("lets an admin disable a user: sessions closed, sign-in refused, audited once", async () => {
    expect(await signIn("user")).toBe("OK");
    expect(await db.session.count({ where: { userId: ids.user } })).toBeGreaterThan(0);

    await setUserDisabled({ id: ids.admin }, ids.user, true);
    await setUserDisabled({ id: ids.admin }, ids.user, true);

    expect(await db.session.count({ where: { userId: ids.user } })).toBe(0);
    expect(await signIn("user")).toBe("BANNED_USER");
    const rows = await db.auditLog.findMany({
      where: { action: "user.disabled", entityId: ids.user },
    });
    expect(rows.map((r) => r.userId)).toEqual([ids.admin]);
  });

  it("re-enables the user, who can sign in again", async () => {
    await setUserDisabled({ id: ids.admin }, ids.user, false);
    expect(await signIn("user")).toBe("OK");
    expect(await db.auditLog.count({ where: { action: "user.enabled", entityId: ids.user } })).toBe(
      1,
    );
  });

  it("refuses acting on yourself or on an unknown user", async () => {
    expect(await refusal(setUserDisabled({ id: ids.admin }, ids.admin, true))).toBe("SELF");
    expect(await refusal(setUserDisabled({ id: ids.super1 }, "lc-nobody", true))).toBe("NOT_FOUND");
  });

  it("only lets a super admin act on an administrator", async () => {
    expect(await refusal(setUserDisabled({ id: ids.admin }, ids.super2, true))).toBe("FORBIDDEN");
    expect(await refusal(setUserDisabled({ id: ids.super1 }, ids.admin, true))).toBe("OK");
    expect(await refusal(setUserDisabled({ id: ids.super1 }, ids.admin, false))).toBe("OK");
  });

  it("strips a disabled admin of every permission", async () => {
    const check = buildPermissionsChecker(db);
    expect(await check(ids.admin, "admin.audit.read")).toBe(true);
    await setUserDisabled({ id: ids.super1 }, ids.admin, true);
    expect(await check(ids.admin, "admin.audit.read")).toBe(false);
    await setUserDisabled({ id: ids.super1 }, ids.admin, false);
  });

  it("a disabled super admin no longer counts as one, for any action", async () => {
    await setUserDisabled({ id: ids.super1 }, ids.super2, true);
    expect(await refusal(setUserDisabled({ id: ids.super2 }, ids.admin, true))).toBe("FORBIDDEN");
    expect(await refusal(adminDeleteUser({ id: ids.super2 }, ids.victim, emailOf("victim")))).toBe(
      "FORBIDDEN",
    );
    expect(await refusal(setUserRole({ id: ids.super2 }, ids.user, "ADMIN"))).toBe("FORBIDDEN");
    await setUserDisabled({ id: ids.super1 }, ids.super2, false);
  });

  it("serialises two super admins disabling each other: exactly one wins", async () => {
    const results = await Promise.allSettled([
      setUserDisabled({ id: ids.super2 }, ids.super3, true),
      setUserDisabled({ id: ids.super3 }, ids.super2, true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const banned = await db.user.findMany({
      where: { id: { in: [ids.super2, ids.super3] } },
      select: { banned: true },
    });
    expect(banned.filter((u) => u.banned)).toHaveLength(1);
    await db.user.updateMany({
      where: { id: { in: [ids.super2, ids.super3] } },
      data: { banned: false, banReason: null },
    });
  });
});

describe("checkUserAdminAction", () => {
  const base = { actorId: "a", targetId: "t", targetRole: "USER" as const };

  it("lets a plain admin disable users but not delete them", () => {
    const admin = { ...base, actorIsActiveSuperAdmin: false };
    expect(checkUserAdminAction({ ...admin, action: "disable" })).toBeNull();
    expect(checkUserAdminAction({ ...admin, action: "delete" })).toBe("FORBIDDEN");
    expect(checkUserAdminAction({ ...admin, action: "enable", targetRole: "ADMIN" })).toBe(
      "FORBIDDEN",
    );
  });
});

describe("adminDeleteUser", () => {
  it("is reserved to super admins", async () => {
    expect(await refusal(adminDeleteUser({ id: ids.admin }, ids.victim, emailOf("victim")))).toBe(
      "FORBIDDEN",
    );
  });

  it("requires the target's email typed back", async () => {
    expect(
      await refusal(adminDeleteUser({ id: ids.super1 }, ids.victim, "wrong@bilan.local")),
    ).toBe("CONFIRMATION");
    expect(await db.user.count({ where: { id: ids.victim } })).toBe(1);
  });

  it("counts the surviving budget lines restricted to the user's accounts (#230)", async () => {
    const impact = async (key: string) => (await userDeletionImpact(ids[key]))?.budgetLines;
    expect(await impact("owner")).toBe(0);

    async function budgetLineOn(key: string, owner: { userId: string } | { groupId: string }) {
      const account = await db.bankAccount.create({
        data: { ownerId: ids[key], name: `LC ${key}`, type: "CHECKING" },
      });
      await db.budget.create({
        data: {
          ...owner,
          name: `LC budget ${stamp}`,
          periodType: "MONTH",
          periodStart: new Date("2026-01-01T00:00:00Z"),
          periodEnd: new Date("2026-01-31T00:00:00Z"),
          createdById: ids[key],
          lines: { create: { accountId: account.id, plannedAmount: 100 } },
        },
      });
    }
    const groupId = async (name: string) =>
      (await db.group.findFirstOrThrow({ where: { name: `${name} ${stamp}` } })).id;

    await budgetLineOn("owner", { userId: ids.owner });
    expect(await impact("owner")).toBe(0);
    await budgetLineOn("owner", { groupId: await groupId("LC shared") });
    expect(await impact("owner")).toBe(1);
    // Another member's personal budget restricted to the user's (shared) account.
    await budgetLineOn("owner", { userId: ids.member });
    expect(await impact("owner")).toBe(2);
    await budgetLineOn("loner", { groupId: await groupId("LC solo") });
    expect(await impact("loner")).toBe(0);
  });

  it("previews then hands a household over to its earliest other member", async () => {
    const impact = await userDeletionImpact(ids.owner);
    expect(impact?.transfers).toEqual([{ group: `LC shared ${stamp}`, to: "LC member" }]);
    expect(impact?.deletedGroups).toEqual([]);

    await adminDeleteUser({ id: ids.super1 }, ids.owner, emailOf("owner"));
    const g = await db.group.findFirstOrThrow({
      where: { name: `LC shared ${stamp}` },
      include: { members: true },
    });
    expect(g.createdById).toBe(ids.member);
    expect(g.members.map((m) => [m.userId, m.role])).toEqual([[ids.member, "OWNER"]]);
  });

  it("leaves a co-owned household to the other owner without promoting anyone", async () => {
    expect((await userDeletionImpact(ids.owner2))?.transfers).toEqual([]);
    await adminDeleteUser({ id: ids.super1 }, ids.owner2, emailOf("owner2"));
    const g = await db.group.findFirstOrThrow({
      where: { name: `LC co-owned ${stamp}` },
      include: { members: true },
    });
    expect(g.createdById).toBe(ids.coOwner);
    expect(Object.fromEntries(g.members.map((m) => [m.userId, m.role]))).toEqual({
      [ids.coOwner]: "OWNER",
      [ids.member2]: "MEMBER",
    });
  });

  it("deletes a user and their solo household, audited with the admin", async () => {
    expect((await userDeletionImpact(ids.loner))?.deletedGroups).toEqual([`LC solo ${stamp}`]);
    await adminDeleteUser({ id: ids.super1 }, ids.loner, ` ${emailOf("loner").toUpperCase()} `);
    expect(await db.user.count({ where: { id: ids.loner } })).toBe(0);
    expect(await db.group.count({ where: { name: `LC solo ${stamp}` } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.deleted", entityId: ids.loner },
    });
    expect(audit?.userId).toBe(ids.super1);
    expect(audit?.metadata).toEqual({ self: false });
  });

  it("lets a super admin delete an admin and another super admin, not themselves", async () => {
    await adminDeleteUser({ id: ids.super1 }, ids.admin2, emailOf("admin2"));
    await adminDeleteUser({ id: ids.super1 }, ids.super3, emailOf("super3"));
    expect(await db.user.count({ where: { id: { in: [ids.admin2, ids.super3] } } })).toBe(0);
    expect(await refusal(adminDeleteUser({ id: ids.super1 }, ids.super1, emailOf("super1")))).toBe(
      "SELF",
    );
  });

  it("treats a concurrent second deletion as not found", async () => {
    const results = await Promise.allSettled([
      adminDeleteUser({ id: ids.super1 }, ids.victim, emailOf("victim")),
      adminDeleteUser({ id: ids.super2 }, ids.victim, emailOf("victim")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.message).toBe("NOT_FOUND");
  });
});

describe("deleteOwnAccount", () => {
  it("refuses the last active super admin, then allows it once another exists", async () => {
    const others = await db.userRole.findMany({
      where: { role: { key: "SUPER_ADMIN" }, userId: { notIn: [ids.super1, ids.super2] } },
      select: { userId: true },
    });
    expect(others).toEqual([]);
    await setUserDisabled({ id: ids.super1 }, ids.super2, true);
    expect(await refusal(deleteOwnAccount(ids.super1))).toBe("LAST_SUPER_ADMIN");
    expect(await db.user.count({ where: { id: ids.super1 } })).toBe(1);

    await setUserDisabled({ id: ids.super1 }, ids.super2, false);
    await deleteOwnAccount(ids.super1);
    expect(await db.user.count({ where: { id: ids.super1 } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.deleted", entityId: ids.super1 },
    });
    expect(audit?.userId).toBeNull();
  });
});
