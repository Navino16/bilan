import { randomBytes, randomInt } from "node:crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { sendMail } from "@/server/services/mail/mailer";
import { getAppName } from "@/server/services/settings/app-settings";
import { env } from "@/env";
import {
  INVITABLE_GROUP_ROLES,
  type GroupRole,
  type InvitableGroupRole,
} from "@/lib/validation/group";
import { requireGroupRole } from "./roles";

export class InvitationError extends Error {}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export async function createInvitation(
  input: { groupId: string; email: string; role: GroupRole },
  actor: { id: string },
): Promise<{ id: string; token: string; code: string }> {
  if (!INVITABLE_GROUP_ROLES.includes(input.role as InvitableGroupRole)) {
    throw new InvitationError("INVALID");
  }
  await requireGroupRole(input.groupId, actor.id, "ADMIN");
  const email = input.email.trim().toLowerCase();
  if (!email) throw new InvitationError("INVALID");

  // Don't invite someone who already belongs to the group (this also covers
  // inviting yourself, since the inviter is necessarily a member).
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: input.groupId, userId: existingUser.id } },
    });
    if (membership) throw new InvitationError("ALREADY_MEMBER");
  }

  const token = randomBytes(32).toString("base64url");
  const code = makeCode();
  const inv = await db.groupInvitation.create({
    data: {
      groupId: input.groupId,
      email,
      invitedById: actor.id,
      role: input.role,
      token,
      code,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const acceptUrl = `${env.APP_URL.replace(/\/$/, "")}/fr/groups/join/${token}`;
  const appName = await getAppName();
  const result = await sendMail({
    to: email,
    subject: `Invitation ${appName}`,
    text: `Vous êtes invité à rejoindre un groupe ${appName}.\nLien : ${acceptUrl}\nCode : ${code}`,
  });
  await logEvent({
    userId: actor.id,
    action: "group.invitation.create",
    entity: "GroupInvitation",
    entityId: inv.id,
    // Dev fallback: when SMTP is off, surface the link/code via the audit log
    // (read in /admin/audit-log, Phase 8.4). Never logged when actually emailed.
    metadata: result.delivered ? { email } : { email, acceptUrl, code },
  });
  return { id: inv.id, token, code };
}

export async function acceptInvitation(
  tokenOrCode: string,
  user: { id: string; email: string },
): Promise<{ groupId: string }> {
  const key = tokenOrCode.trim();
  const inv = await db.groupInvitation.findFirst({
    where: { OR: [{ token: key }, { code: key.toUpperCase() }] },
  });
  if (!inv) throw new InvitationError("NOT_FOUND");
  if (inv.acceptedAt) throw new InvitationError("ALREADY_USED");
  if (inv.expiresAt.getTime() < Date.now()) throw new InvitationError("EXPIRED");

  await db.$transaction([
    db.groupMember.upsert({
      where: { groupId_userId: { groupId: inv.groupId, userId: user.id } },
      update: {},
      create: { groupId: inv.groupId, userId: user.id, role: inv.role },
    }),
    db.groupInvitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    }),
  ]);
  await logEvent({
    userId: user.id,
    action: "group.invitation.accept",
    entity: "GroupInvitation",
    entityId: inv.id,
    metadata: { groupId: inv.groupId },
  });
  return { groupId: inv.groupId };
}

export async function revokeInvitation(id: string, actor: { id: string }): Promise<void> {
  const inv = await db.groupInvitation.findUnique({ where: { id } });
  if (!inv) throw new InvitationError("NOT_FOUND");
  await requireGroupRole(inv.groupId, actor.id, "ADMIN");
  await db.groupInvitation.delete({ where: { id } });
  await logEvent({
    userId: actor.id,
    action: "group.invitation.revoke",
    entity: "GroupInvitation",
    entityId: id,
  });
}

export async function listInvitations(groupId: string, actor: { id: string }) {
  await requireGroupRole(groupId, actor.id, "ADMIN");
  return db.groupInvitation.findMany({
    where: { groupId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

// Public-ish lookup for the join-by-link page: returns just what's needed to
// render the confirm screen (no membership required — the token is the secret).
export async function getInvitationByToken(token: string) {
  const inv = await db.groupInvitation.findUnique({
    where: { token },
    include: { group: true },
  });
  if (!inv) return null;
  return {
    id: inv.id,
    token: inv.token,
    email: inv.email,
    role: inv.role as GroupRole,
    groupName: inv.group.name,
    accepted: inv.acceptedAt !== null,
    expired: inv.expiresAt.getTime() < Date.now(),
  };
}

export async function pendingInvitationsForEmail(email: string) {
  return db.groupInvitation.findMany({
    where: { email: email.toLowerCase(), acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { group: true },
  });
}
