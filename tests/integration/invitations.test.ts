import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

type Mail = { to: string; subject: string; text: string; sensitive?: boolean };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: false };
  },
}));

import { db } from "@/server/db";
import { createGroup } from "@/server/services/groups";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  InvitationError,
} from "@/server/services/groups/invitations";

const owner = "inv_owner";
const invitee = "inv_invitee";
const ids = [owner, invitee];

beforeAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.user.create({ data: { id: owner, email: "inv-owner@bilan.local" } });
  await db.user.create({ data: { id: invitee, email: "invitee@bilan.local" } });
});

afterAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("invitations service", () => {
  it("creates an invitation (token+code) and audits it", async () => {
    const g = await createGroup({ name: "Invite group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    expect(inv.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(inv.token.length).toBeGreaterThan(20);
    expect(
      await db.auditLog.findFirst({
        where: { action: "group.invitation.create", entityId: inv.id },
      }),
    ).not.toBeNull();
  });

  it("accepts by code → creates membership with the invited role; second accept is rejected", async () => {
    const g = await createGroup({ name: "Accept group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "ADMIN" },
      { id: owner },
    );
    const res = await acceptInvitation(inv.code, { id: invitee, email: "invitee@bilan.local" });
    expect(res.groupId).toBe(g.id);
    const m = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: g.id, userId: invitee } },
    });
    expect(m?.role).toBe("ADMIN");
    await expect(
      acceptInvitation(inv.code, { id: invitee, email: "invitee@bilan.local" }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("rejects an expired invitation and a revoked one", async () => {
    const g = await createGroup({ name: "Expiry group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    await db.groupInvitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      acceptInvitation(inv.token, { id: invitee, email: "invitee@bilan.local" }),
    ).rejects.toBeInstanceOf(InvitationError);

    const inv2 = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    await revokeInvitation(inv2.id, { id: owner });
    await expect(
      acceptInvitation(inv2.token, { id: invitee, email: "invitee@bilan.local" }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("only OWNER/ADMIN can invite", async () => {
    const g = await createGroup({ name: "Perm group" }, owner);
    await expect(
      createInvitation({ groupId: g.id, email: "x@bilan.local", role: "MEMBER" }, { id: invitee }),
    ).rejects.toBeTruthy();
  });

  it("rejects inviting someone as OWNER", async () => {
    const g = await createGroup({ name: "Owner invite group" }, owner);
    await expect(
      createInvitation({ groupId: g.id, email: "x@bilan.local", role: "OWNER" }, { id: owner }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("rejects inviting an existing member (including yourself)", async () => {
    const g = await createGroup({ name: "Self invite group" }, owner);
    // owner inviting their own email — already a member
    await expect(
      createInvitation(
        { groupId: g.id, email: "inv-owner@bilan.local", role: "MEMBER" },
        { id: owner },
      ),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("is nominative: another account gets the masked invited address and doesn't consume it", async () => {
    const g = await createGroup({ name: "Nominative group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "Invitee@Bilan.local", role: "ADMIN" },
      { id: owner },
    );
    const err = await acceptInvitation(inv.code, {
      id: owner,
      email: "inv-owner@bilan.local",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvitationError);
    expect((err as InvitationError).message).toBe("WRONG_ACCOUNT");
    expect((err as InvitationError).hint).toBe("i***@bilan.local");

    const stranger = "inv_stranger";
    await db.user.deleteMany({ where: { id: stranger } });
    await db.user.create({ data: { id: stranger, email: "stranger@bilan.local" } });
    await expect(
      acceptInvitation(inv.token, { id: stranger, email: "stranger@bilan.local" }),
    ).rejects.toMatchObject({ message: "WRONG_ACCOUNT" });
    await db.user.delete({ where: { id: stranger } });

    const res = await acceptInvitation(inv.code.toLowerCase(), {
      id: invitee,
      email: "INVITEE@bilan.local",
    });
    expect(res.groupId).toBe(g.id);
  });

  it("tells an existing member they're already in, without consuming the invitation", async () => {
    const g = await createGroup({ name: "Already member group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    await db.groupMember.create({ data: { groupId: g.id, userId: invitee, role: "MEMBER" } });
    await expect(
      acceptInvitation(inv.token, { id: invitee, email: "invitee@bilan.local" }),
    ).rejects.toMatchObject({ message: "ALREADY_IN_GROUP" });
    expect(
      (await db.groupInvitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt,
    ).toBeNull();
  });

  it("mails a newcomer in the inviter's locale and a user in their preferred one (#214)", async () => {
    const g = await createGroup({ name: "Locale group" }, owner);
    sent.length = 0;
    await createInvitation(
      { groupId: g.id, email: "newcomer@bilan.local", role: "MEMBER", locale: "en" },
      { id: owner },
    );
    await db.userPreference.upsert({
      where: { userId: invitee },
      create: { userId: invitee, locale: "fr" },
      update: { locale: "fr" },
    });
    await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER", locale: "en" },
      { id: owner },
    );
    const [newcomer, user] = sent;
    expect(newcomer.to).toBe("newcomer@bilan.local");
    expect(newcomer.subject).toMatch(/invitation to join the household “Locale group”$/);
    expect(newcomer.text).toContain(
      "inv-owner@bilan.local invited you to join the household “Locale group”",
    );
    expect(newcomer.text).toMatch(/\/en\/groups\/join\//);
    expect(newcomer.sensitive).toBe(true);
    expect(user.to).toBe("invitee@bilan.local");
    expect(user.subject).toMatch(/invitation à rejoindre le foyer « Locale group »$/);
    expect(user.text).toMatch(/\/fr\/groups\/join\//);
  });
});
