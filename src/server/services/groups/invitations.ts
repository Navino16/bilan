import { randomBytes, randomInt } from "node:crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { sendMail } from "@/server/services/mail/mailer";
import { invitationMail } from "@/server/services/mail/invitation";
import { toLocale } from "@/server/services/users/preferences";
import { getAppName } from "@/server/services/settings/app-settings";
import { env } from "@/env";
import { defaultLocale, type Locale } from "@/i18n/config";
import {
  INVITABLE_GROUP_ROLES,
  type GroupRole,
  type InvitableGroupRole,
} from "@/lib/validation/group";
import { displayName } from "@/lib/validation/name";
import { requireGroupRole } from "./roles";

export class InvitationError extends Error {
  constructor(
    code: string,
    // Extra context safe to show the caller (e.g. the masked invited address).
    readonly hint?: string,
  ) {
    super(code);
  }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// The mail goes out in the invitee's preferred locale when they already have an account,
// else in `locale` (the inviter's page). Re-inviting an address with a pending invitation
// renews it instead of creating a second one (link and code rotate only if it had expired).
export async function createInvitation(
  input: { groupId: string; email: string; role: GroupRole; locale?: Locale },
  actor: { id: string },
): Promise<{
  id: string;
  token: string;
  code: string;
  renewed: boolean;
  delivered: boolean;
  acceptUrl: string;
}> {
  if (!INVITABLE_GROUP_ROLES.includes(input.role as InvitableGroupRole)) {
    throw new InvitationError("INVALID");
  }
  await requireGroupRole(input.groupId, actor.id, "ADMIN");
  const email = input.email.trim().toLowerCase();
  if (!email) throw new InvitationError("INVALID");

  // Don't invite someone who already belongs to the group (this also covers
  // inviting yourself, since the inviter is necessarily a member).
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, preference: { select: { locale: true } } },
  });
  const assertNotMember = async () => {
    if (!existingUser) return;
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: input.groupId, userId: existingUser.id } },
    });
    if (membership) throw new InvitationError("ALREADY_MEMBER");
  };
  await assertNotMember();

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const pending = await db.groupInvitation.findFirst({
    where: { groupId: input.groupId, email, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  let renewedId: string | null = null;
  if (pending) {
    const expired = pending.expiresAt.getTime() < Date.now();
    // Guarded on acceptedAt: an accept racing this renewal must not be overwritten.
    const { count } = await db.groupInvitation.updateMany({
      where: { id: pending.id, acceptedAt: null },
      data: {
        role: input.role,
        invitedById: actor.id,
        expiresAt,
        ...(expired && { token: randomBytes(32).toString("base64url"), code: makeCode() }),
      },
    });
    if (count === 1) renewedId = pending.id;
    else await assertNotMember();
  }
  const inv = renewedId
    ? await db.groupInvitation.findUniqueOrThrow({ where: { id: renewedId } })
    : await db.groupInvitation.create({
        data: {
          groupId: input.groupId,
          email,
          invitedById: actor.id,
          role: input.role,
          token: randomBytes(32).toString("base64url"),
          code: makeCode(),
          expiresAt,
        },
      });
  const { token, code } = inv;

  const locale = existingUser?.preference
    ? toLocale(existingUser.preference.locale)
    : (input.locale ?? defaultLocale);
  const acceptUrl = `${env.APP_URL.replace(/\/$/, "")}/${locale}/groups/join/${token}`;
  const [group, inviter, appName] = await Promise.all([
    db.group.findUniqueOrThrow({ where: { id: input.groupId }, select: { name: true } }),
    db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true, email: true } }),
    getAppName(),
  ]);
  const mail = invitationMail(locale, {
    appName,
    inviter: displayName(inviter),
    group: group.name,
    acceptUrl,
    code,
    ttlDays: INVITE_TTL_DAYS,
  });
  const result = await sendMail({ to: email, ...mail, sensitive: true });
  await logEvent({
    userId: actor.id,
    action: renewedId ? "group.invitation.resend" : "group.invitation.create",
    entity: "GroupInvitation",
    entityId: inv.id,
    // Dev fallback: when SMTP is off, surface the link/code via the audit log
    // (read in /admin/audit-log, Phase 8.4). Never logged when actually emailed.
    metadata: result.delivered ? { email } : { email, acceptUrl, code },
  });
  return {
    id: inv.id,
    token,
    code,
    renewed: renewedId !== null,
    delivered: result.delivered,
    acceptUrl,
  };
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
  // Invitations are nominative: the code/link only works for the invited address.
  if (inv.email !== user.email.trim().toLowerCase()) {
    throw new InvitationError("WRONG_ACCOUNT", maskEmail(inv.email));
  }
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: inv.groupId, userId: user.id } },
  });
  if (membership) throw new InvitationError("ALREADY_IN_GROUP");

  await db.$transaction([
    db.groupMember.create({
      data: { groupId: inv.groupId, userId: user.id, role: inv.role },
    }),
    db.groupInvitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    }),
    db.groupInvitation.deleteMany({
      where: { groupId: inv.groupId, email: inv.email, acceptedAt: null, id: { not: inv.id } },
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

// The invitee turns an invitation down; also how a stale one for a foyer they already
// belong to gets cleared.
export async function declineInvitation(
  token: string,
  user: { id: string; email: string },
): Promise<void> {
  const inv = await db.groupInvitation.findUnique({ where: { token } });
  if (!inv) throw new InvitationError("NOT_FOUND");
  if (inv.acceptedAt) throw new InvitationError("ALREADY_USED");
  if (inv.email !== user.email.trim().toLowerCase()) {
    throw new InvitationError("WRONG_ACCOUNT", maskEmail(inv.email));
  }
  await db.groupInvitation.delete({ where: { id: inv.id } });
  await logEvent({
    userId: user.id,
    action: "group.invitation.decline",
    entity: "GroupInvitation",
    entityId: inv.id,
    metadata: { groupId: inv.groupId },
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
    groupId: inv.groupId,
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
