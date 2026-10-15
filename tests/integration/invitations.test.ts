import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

type Mail = { to: string; subject: string; text: string; locale: string; sensitive?: boolean };
const sent = vi.hoisted(() => [] as Mail[]);
const smtp = vi.hoisted(() => ({ delivered: false, fail: false }));
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    if (smtp.fail) throw new Error("connect ECONNREFUSED 127.0.0.1:2525");
    return { delivered: smtp.delivered };
  },
}));
const session = vi.hoisted(() => ({ user: { id: "inv_owner", email: "inv-owner@bilan.local" } }));
vi.mock("@/server/auth/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/permissions")>()),
  requireSession: async () => session.user,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { db } from "@/server/db";
import { invitationAcceptLimiter } from "@/server/auth/rate-limit";
import { createGroup } from "@/server/services/groups";
import {
  createInvitation,
  acceptInvitation,
  acceptPendingInvitation,
  revokeInvitation,
  declineInvitation,
  pendingInvitationsForUser,
  InvitationError,
} from "@/server/services/groups/invitations";
import {
  acceptPendingInvitationAction,
  createInvitationAction,
} from "@/server/transport/actions/invitations";

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

  it("renews a pending invitation instead of duplicating it (#228)", async () => {
    const g = await createGroup({ name: "Renew group" }, owner);
    const first = await createInvitation(
      { groupId: g.id, email: "renew@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    expect(first).toMatchObject({ renewed: false, delivery: "disabled" });
    expect(first.acceptUrl).toMatch(new RegExp(`/groups/join/${first.token}$`));
    const soon = new Date(Date.now() + 60_000);
    await db.groupInvitation.update({ where: { id: first.id }, data: { expiresAt: soon } });
    sent.length = 0;

    // Still valid: the link already sent keeps working.
    const again = await createInvitation(
      { groupId: g.id, email: " Renew@Bilan.local ", role: "ADMIN" },
      { id: owner },
    );
    expect(again).toMatchObject({
      id: first.id,
      token: first.token,
      code: first.code,
      renewed: true,
    });
    const rows = await db.groupInvitation.findMany({ where: { groupId: g.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("ADMIN");
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(soon.getTime());
    expect(sent.map((m) => m.to)).toEqual(["renew@bilan.local"]);
    expect(
      await db.auditLog.findFirst({
        where: { action: "group.invitation.resend", entityId: first.id },
      }),
    ).not.toBeNull();

    // Expired: link and code rotate.
    await db.groupInvitation.update({
      where: { id: first.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const rotated = await createInvitation(
      { groupId: g.id, email: "renew@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    expect(rotated).toMatchObject({ id: first.id, renewed: true });
    expect(rotated.token).not.toBe(first.token);
    expect(rotated.code).not.toBe(first.code);
    expect(rotated.acceptUrl).toMatch(new RegExp(`/groups/join/${rotated.token}$`));
    const [row] = await db.groupInvitation.findMany({ where: { groupId: g.id } });
    expect(row).toMatchObject({ token: rotated.token, code: rotated.code, role: "MEMBER" });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps the link and code out of the audit log, mailed or not (#228, #243)", async () => {
    const g = await createGroup({ name: "Delivered group" }, owner);
    const metadataOf = async (id: string) =>
      (
        await db.auditLog.findFirstOrThrow({
          where: { action: "group.invitation.create", entityId: id },
        })
      ).metadata;
    smtp.delivered = true;
    try {
      const inv = await createInvitation(
        { groupId: g.id, email: "delivered@bilan.local", role: "MEMBER" },
        { id: owner },
      );
      expect(inv).toMatchObject({ delivery: "sent", renewed: false });
      expect(await metadataOf(inv.id)).toEqual({
        email: "delivered@bilan.local",
        delivery: "sent",
      });
    } finally {
      smtp.delivered = false;
    }
    const off = await createInvitation(
      { groupId: g.id, email: "undelivered@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    expect(await metadataOf(off.id)).toEqual({
      email: "undelivered@bilan.local",
      delivery: "disabled",
    });
  });

  it("hands the inviter the link when the mail fails, and audits it (#243)", async () => {
    const g = await createGroup({ name: "Failing mail group" }, owner);
    const submit = () => {
      const fd = new FormData();
      fd.set("groupId", g.id);
      fd.set("email", "bounce@bilan.local");
      fd.set("role", "MEMBER");
      return createInvitationAction(null, fd);
    };
    smtp.fail = true;
    let invitationId = "";
    try {
      const first = await submit();
      const inv = await db.groupInvitation.findFirstOrThrow({ where: { groupId: g.id } });
      invitationId = inv.id;
      expect(first).toEqual({
        ok: true,
        renewed: false,
        shareUrl: expect.stringMatching(new RegExp(`/groups/join/${inv.token}$`)),
        mailFailed: true,
      });
      expect(await submit()).toMatchObject({ ok: true, renewed: true, mailFailed: true });
    } finally {
      smtp.fail = false;
    }
    const logs = await db.auditLog.findMany({
      where: { entity: "GroupInvitation", entityId: invitationId },
      orderBy: { createdAt: "asc" },
      select: { action: true, metadata: true },
    });
    expect(logs).toEqual([
      {
        action: "group.invitation.create",
        metadata: { email: "bounce@bilan.local", delivery: "failed" },
      },
      {
        action: "group.invitation.resend",
        metadata: { email: "bounce@bilan.local", delivery: "failed" },
      },
    ]);
  });

  it("returns the link to share only when the mail wasn't delivered (#228)", async () => {
    const g = await createGroup({ name: "Share link group" }, owner);
    const submit = (email: string) => {
      const fd = new FormData();
      fd.set("groupId", g.id);
      fd.set("email", email);
      fd.set("role", "MEMBER");
      return createInvitationAction(null, fd);
    };
    const off = await submit("share@bilan.local");
    const inv = await db.groupInvitation.findFirstOrThrow({ where: { groupId: g.id } });
    expect(off).toEqual({
      ok: true,
      renewed: false,
      shareUrl: expect.stringMatching(new RegExp(`/groups/join/${inv.token}$`)),
    });

    smtp.delivered = true;
    try {
      expect(await submit("share@bilan.local")).toEqual({ ok: true, renewed: true });
    } finally {
      smtp.delivered = false;
    }
  });

  it("forbids a MEMBER from renewing a pending invitation (#228)", async () => {
    const g = await createGroup({ name: "Member renew group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "pending@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    await db.groupMember.create({ data: { groupId: g.id, userId: invitee, role: "MEMBER" } });
    await expect(
      createInvitation(
        { groupId: g.id, email: "pending@bilan.local", role: "ADMIN" },
        { id: invitee },
      ),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    const row = await db.groupInvitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.role).toBe("MEMBER");
  });

  it("accepting clears the other pending invitations for the same foyer and address (#228)", async () => {
    const g = await createGroup({ name: "Cleanup group" }, owner);
    const other = await createGroup({ name: "Cleanup other group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    const stale = await db.groupInvitation.create({
      data: {
        groupId: g.id,
        email: "invitee@bilan.local",
        invitedById: owner,
        token: "stale-token-228",
        code: "STL228",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const elsewhere = await createInvitation(
      { groupId: other.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );

    await acceptInvitation(inv.token, { id: invitee, email: "invitee@bilan.local" });
    expect(await db.groupInvitation.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.groupInvitation.findUnique({ where: { id: elsewhere.id } })).not.toBeNull();
    expect(
      (await db.groupInvitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt,
    ).not.toBeNull();
  });

  it("lets only the invited address decline, including a stale invitation (#228)", async () => {
    await db.user.updateMany({ where: { id: { in: ids } }, data: { emailVerified: true } });
    const g = await createGroup({ name: "Decline group" }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" },
      { id: owner },
    );
    await expect(
      declineInvitation(inv.id, { id: owner, email: "inv-owner@bilan.local" }),
    ).rejects.toMatchObject({ message: "NOT_FOUND" });

    // Stale: the invitee already joined by another route.
    await db.groupMember.create({ data: { groupId: g.id, userId: invitee, role: "MEMBER" } });
    await declineInvitation(inv.id, { id: invitee, email: "Invitee@bilan.local" });
    expect(await db.groupInvitation.findUnique({ where: { id: inv.id } })).toBeNull();
    expect(
      await db.auditLog.findFirst({
        where: { action: "group.invitation.decline", entityId: inv.id },
      }),
    ).not.toBeNull();
    await expect(
      declineInvitation(inv.id, { id: invitee, email: "invitee@bilan.local" }),
    ).rejects.toMatchObject({ message: "NOT_FOUND" });
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
    expect(newcomer.locale).toBe("en");
    expect(user.to).toBe("invitee@bilan.local");
    expect(user.subject).toMatch(/invitation à rejoindre le foyer « Locale group »$/);
    expect(user.text).toMatch(/\/fr\/groups\/join\//);
    expect(user.locale).toBe("fr");
  });
});

describe("e-mail-matched invitations need a verified address (#240)", () => {
  const user = { id: invitee, email: "invitee@bilan.local" };
  const setVerified = (emailVerified: boolean) =>
    db.user.update({ where: { id: invitee }, data: { emailVerified } });
  const invite = async (name: string) => {
    const g = await createGroup({ name }, owner);
    const inv = await createInvitation(
      { groupId: g.id, email: user.email, role: "MEMBER" },
      { id: owner },
    );
    return { g, inv };
  };
  const isMember = async (groupId: string) =>
    (await db.groupMember.count({ where: { groupId, userId: invitee } })) === 1;

  it("neither lists nor accepts or declines from the list while unverified", async () => {
    await setVerified(false);
    const { g, inv } = await invite("Unverified list group");
    expect(await pendingInvitationsForUser(user)).toEqual([]);
    await expect(acceptPendingInvitation(inv.id, user)).rejects.toMatchObject({
      message: "EMAIL_NOT_VERIFIED",
    });
    await expect(declineInvitation(inv.id, user)).rejects.toMatchObject({
      message: "EMAIL_NOT_VERIFIED",
    });
    session.user = user;
    const fd = new FormData();
    fd.set("id", inv.id);
    expect(await acceptPendingInvitationAction(null, fd)).toEqual({
      ok: false,
      error: "EMAIL_NOT_VERIFIED",
    });
    expect(await isMember(g.id)).toBe(false);
    expect(await db.groupInvitation.findUnique({ where: { id: inv.id } })).not.toBeNull();
  });

  it("still accepts the link or the code from an unverified address", async () => {
    await setVerified(false);
    const byLink = await invite("Unverified link group");
    const byCode = await invite("Unverified code group");
    await acceptInvitation(byLink.inv.token, user);
    await acceptInvitation(byCode.inv.code, user);
    expect(await isMember(byLink.g.id)).toBe(true);
    expect(await isMember(byCode.g.id)).toBe(true);
  });

  it("lists without token or code, and accepts from the list, once verified", async () => {
    await setVerified(true);
    const { g, inv } = await invite("Verified list group");
    const listed = await pendingInvitationsForUser(user);
    expect(listed).toContainEqual({ id: inv.id, role: "MEMBER", groupName: "Verified list group" });
    expect(Object.keys(listed[0]).sort()).toEqual(["groupName", "id", "role"]);
    // The id isn't a secret: another verified account still can't use it.
    await db.user.update({ where: { id: owner }, data: { emailVerified: true } });
    await expect(
      acceptPendingInvitation(inv.id, { id: owner, email: "inv-owner@bilan.local" }),
    ).rejects.toMatchObject({ message: "NOT_FOUND" });
    expect(await acceptPendingInvitation(inv.id, user)).toEqual({ groupId: g.id });
    expect(await isMember(g.id)).toBe(true);
  });

  it("reports someone else's invitation as missing whatever its state", async () => {
    await setVerified(true);
    const { inv } = await invite("Probe group");
    await db.groupInvitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await db.user.update({ where: { id: owner }, data: { emailVerified: false } });
    const stranger = { id: owner, email: "inv-owner@bilan.local" };
    await expect(acceptPendingInvitation(inv.id, stranger)).rejects.toMatchObject({
      message: "NOT_FOUND",
      hint: undefined,
    });
    await expect(declineInvitation(inv.id, stranger)).rejects.toMatchObject({
      message: "NOT_FOUND",
    });
    await expect(acceptPendingInvitation(inv.id, user)).rejects.toMatchObject({
      message: "EXPIRED",
    });
  });

  it("rate-limits accepting from the list like the code", async () => {
    const { inv } = await invite("Rate group");
    session.user = user;
    invitationAcceptLimiter.reset(invitee);
    for (let i = 0; i < 10; i++) invitationAcceptLimiter.consume(invitee);
    const fd = new FormData();
    fd.set("id", inv.id);
    expect(await acceptPendingInvitationAction(null, fd)).toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    invitationAcceptLimiter.reset(invitee);
  });
});
