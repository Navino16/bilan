import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listAuditLog } from "@/server/services/audit";

const userId = "auditlist_user";
const otherId = "auditlist_other";
const prefix = "test_auditlist";
const action = `${prefix}.list`;

beforeAll(async () => {
  await db.auditLog.deleteMany({ where: { action: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.user.createMany({
    data: [
      { id: userId, email: "auditlist@bilan.local", name: "Audit User" },
      { id: otherId, email: "someone-else@bilan.local", name: "Other" },
    ],
  });
  await db.auditLog.createMany({
    data: [
      { action, userId, createdAt: new Date("2026-03-01T10:00:00Z") },
      { action, userId: "auditlist_gone", createdAt: new Date("2026-03-02T10:00:00Z") },
      { action, userId: null, createdAt: new Date("2026-03-03T10:00:00Z") },
      {
        action: `${prefix}.role`,
        userId: otherId,
        entity: "User",
        entityId: userId,
        createdAt: new Date("2026-03-04T10:00:00Z"),
      },
      { action: `${prefix}x.other`, userId, createdAt: new Date("2026-03-05T10:00:00Z") },
    ],
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { action: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe("listAuditLog", () => {
  it("resolves the acting user, null for system events and deleted users", async () => {
    const { items } = await listAuditLog({ action });
    expect(items).toHaveLength(3);
    expect(items.map((i) => [i.userId, i.user])).toEqual(
      expect.arrayContaining([
        [userId, { name: "Audit User", email: "auditlist@bilan.local" }],
        ["auditlist_gone", null],
        [null, null],
      ]),
    );
  });

  it("matches the action as a prefix (#164: `group` used to return nothing)", async () => {
    const { total } = await listAuditLog({ action: `${prefix}.` });
    expect(total).toBe(4);
    const all = await listAuditLog({ action: prefix });
    expect(all.total).toBe(5);
  });

  it("matches a known family only up to its dot", async () => {
    await db.auditLog.createMany({
      data: [
        { action: "audit.test_auditlist_family", userId: otherId },
        { action: "auditlog.test_auditlist_family", userId: otherId },
      ],
    });
    try {
      const { items } = await listAuditLog({ action: "audit", user: otherId });
      expect(items.map((i) => i.action)).toEqual(["audit.test_auditlist_family"]);
    } finally {
      await db.auditLog.deleteMany({ where: { action: { endsWith: "test_auditlist_family" } } });
    }
  });

  it("resolves the user an entity=User row is about", async () => {
    const { items } = await listAuditLog({ action: `${prefix}.role` });
    expect(items[0].subject).toEqual({ name: "Audit User", email: "auditlist@bilan.local" });
    expect(items[0].user?.email).toBe("someone-else@bilan.local");
  });

  describe("entity names", () => {
    const named = `${prefix}.named`;
    const ids = {
      group: "auditlist_group",
      group2: "auditlist_group2",
      account: "auditlist_account",
      passkey: "auditlist_passkey",
      provider: "auditlist_provider",
      invitation: "auditlist_invitation",
      token: "auditlist_token",
    };
    const NAMED_MODELS = [
      "group",
      "passkey",
      "authProvider",
      "groupInvitation",
      "adminSignupToken",
    ];

    async function cleanup() {
      await db.auditLog.deleteMany({ where: { action: named } });
      await db.groupInvitation.deleteMany({ where: { id: ids.invitation } });
      await db.group.deleteMany({ where: { id: { in: [ids.group, ids.group2] } } });
      await db.bankAccount.deleteMany({ where: { id: ids.account } });
      await db.passkey.deleteMany({ where: { id: ids.passkey } });
      await db.authProvider.deleteMany({ where: { id: ids.provider } });
      await db.adminSignupToken.deleteMany({ where: { id: ids.token } });
    }

    beforeAll(async () => {
      await cleanup();
      await db.group.createMany({
        data: [
          { id: ids.group, name: "Foyer audit", createdById: userId },
          { id: ids.group2, name: "Foyer bis", createdById: userId },
        ],
      });
      await db.bankAccount.create({
        data: { id: ids.account, ownerId: userId, name: "Compte secret", type: "CHECKING" },
      });
      await db.passkey.create({
        data: {
          id: ids.passkey,
          name: "Clé du portable",
          publicKey: "pk",
          userId,
          credentialID: "auditlist_cred",
          deviceType: "singleDevice",
        },
      });
      await db.authProvider.create({
        data: { id: ids.provider, type: "oidc", key: "auditlist_oidc", displayName: "SSO maison" },
      });
      await db.groupInvitation.create({
        data: {
          id: ids.invitation,
          groupId: ids.group,
          email: "invite-audit@bilan.local",
          invitedById: userId,
          token: "auditlist_invite_token",
          code: "AUDITLST",
          expiresAt: new Date("2099-01-01T00:00:00Z"),
        },
      });
      await db.adminSignupToken.create({
        data: {
          id: ids.token,
          token: "auditlist_signup_token",
          description: "Jeton famille",
          createdById: userId,
        },
      });
      await db.auditLog.createMany({
        data: [
          { action: named, entity: "Group", entityId: ids.group },
          { action: named, entity: "Group", entityId: ids.group2 },
          { action: named, entity: "Group", entityId: "auditlist_group_gone" },
          { action: named, entity: "Passkey", entityId: ids.passkey },
          { action: named, entity: "AuthProvider", entityId: ids.provider },
          { action: named, entity: "GroupInvitation", entityId: ids.invitation },
          { action: named, entity: "AdminSignupToken", entityId: ids.token },
          { action: named, entity: "BankAccount", entityId: ids.account },
          { action: named, entity: "Transaction", entityId: "auditlist_tx" },
        ],
      });
    });

    afterAll(cleanup);

    it("names admin-domain entities only, never users' financial data", async () => {
      const { items } = await listAuditLog({ action: named });
      expect(Object.fromEntries(items.map((i) => [i.entityId, i.entityName]))).toEqual({
        [ids.group]: "Foyer audit",
        [ids.group2]: "Foyer bis",
        auditlist_group_gone: null,
        [ids.passkey]: "Clé du portable",
        [ids.provider]: "SSO maison",
        [ids.invitation]: "invite-audit@bilan.local",
        [ids.token]: "Jeton famille",
        [ids.account]: null,
        auditlist_tx: null,
      });
    });

    it("looks names up with one query per entity type, not per row", async () => {
      const calls: string[] = [];
      const counting = new Proxy(db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof prop !== "string" || !NAMED_MODELS.includes(prop)) return value;
          return {
            findMany: (args: unknown) => {
              calls.push(prop);
              return value.findMany(args);
            },
          };
        },
      });
      await listAuditLog({ action: named }, counting);
      expect(calls.sort()).toEqual([...NAMED_MODELS].sort());
    });
  });

  it("filters by a fragment of the user's email or name, or an exact id", async () => {
    const byEmail = await listAuditLog({ action: prefix, user: "AUDITLIST@" });
    expect(byEmail.items.map((i) => i.userId)).toEqual([userId, userId]);
    const byName = await listAuditLog({ action: prefix, user: "other" });
    expect(byName.items.map((i) => i.userId)).toEqual([otherId]);
    const byId = await listAuditLog({ action: prefix, user: "auditlist_gone" });
    expect(byId.total).toBe(1);
    const none = await listAuditLog({ action: prefix, user: "nobody-matches-this" });
    expect(none.total).toBe(0);
  });

  it("treats LIKE wildcards in the user and action filters literally (#223)", async () => {
    expect((await listAuditLog({ action: prefix, user: "auditl_st@" })).total).toBe(0);
    expect((await listAuditLog({ action: prefix, user: "audit%@" })).total).toBe(0);
    expect((await listAuditLog({ action: "test%auditlist" })).total).toBe(0);

    const escId = "auditlist_esc";
    await db.user.deleteMany({ where: { id: escId } });
    await db.user.create({ data: { id: escId, email: "audit_esc%1@bilan.local" } });
    await db.auditLog.create({ data: { action: `${prefix}.esc`, userId: escId } });
    try {
      for (const user of ["it_esc", "esc%1"]) {
        const { items } = await listAuditLog({ action: prefix, user });
        expect(items.map((i) => i.userId)).toEqual([escId]);
      }
      expect((await listAuditLog({ action: prefix, user: "it-esc" })).total).toBe(0);
    } finally {
      await db.auditLog.deleteMany({ where: { userId: escId } });
      await db.user.deleteMany({ where: { id: escId } });
    }
  });

  it("filters by a half-open date range", async () => {
    const { items } = await listAuditLog({
      action: prefix,
      from: new Date("2026-03-02T00:00:00Z"),
      to: new Date("2026-03-04T00:00:00Z"),
    });
    expect(items.map((i) => i.createdAt.toISOString())).toEqual([
      "2026-03-03T10:00:00.000Z",
      "2026-03-02T10:00:00.000Z",
    ]);
  });

  it("paginates newest first and clamps a page past the end", async () => {
    const p2 = await listAuditLog({ action: prefix, page: 2, pageSize: 2 });
    expect(p2).toMatchObject({ total: 5, page: 2, pageCount: 3 });
    expect(p2.items.map((i) => i.createdAt.toISOString())).toEqual([
      "2026-03-03T10:00:00.000Z",
      "2026-03-02T10:00:00.000Z",
    ]);
    const past = await listAuditLog({ action: prefix, page: 99, pageSize: 2 });
    expect(past.page).toBe(3);
    expect(past.items).toHaveLength(1);
  });
});
