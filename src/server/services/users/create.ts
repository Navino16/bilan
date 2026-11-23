import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { grantRole, isActiveSuperAdmin, RoleChangeError } from "@/server/services/users/roles";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { storeSignupLocale } from "@/server/services/users/preferences";
import { logEvent } from "@/server/services/audit";
import { isSmtpEnabled } from "@/server/services/settings/smtp";
import { env } from "@/env";
import { defaultLocale, locales } from "@/i18n/config";
import { nameSchema } from "@/lib/schemas/name";
import { CREATABLE_ROLES, mayHandleRole } from "@/lib/instance-roles";

export const adminCreateUserSchema = z.object({
  email: z.email(),
  name: nameSchema,
  role: z.enum(CREATABLE_ROLES).default("USER"),
  locale: z.enum(locales).default(defaultLocale).catch(defaultLocale),
});

export class UserExistsError extends Error {
  constructor() {
    super("USER_EXISTS");
  }
}

export type AdminCreateUserInput = z.input<typeof adminCreateUserSchema>;

// Admin-provisions a user with a throwaway password, then sends the reset flow as a
// "choose your password" mail (`setup=1`). The setup token is never returned or logged.
// `setupMailSent` is false when no enabled SMTP config can deliver that mail.
export async function adminCreateUser(
  input: AdminCreateUserInput,
  actor: { id: string },
): Promise<{ id: string; setupMailSent: boolean }> {
  const parsed = adminCreateUserSchema.parse(input);
  if (!mayHandleRole(await isActiveSuperAdmin(actor.id), parsed.role)) {
    throw new RoleChangeError("FORBIDDEN");
  }
  const auth = await getAuth();

  // Not signUpEmail: with autoSignIn + nextCookies it would sign the admin in as the new user.
  const ctx = await auth.$context;
  const email = parsed.email.toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new UserExistsError();
  const user = await ctx.internalAdapter.createUser(
    { email, name: parsed.name, emailVerified: false },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(randomBytes(32).toString("base64url")),
  });
  // Best-effort, like the signup hook (which skips admin-created users).
  await Promise.allSettled([
    storeSignupLocale(user.id, parsed.locale),
    seedDefaultCategories(user.id, parsed.locale),
  ]);

  await grantRole(db, user.id, parsed.role, actor.id);
  const appUrl = env.APP_URL.replace(/\/$/, "");
  await auth.api.requestPasswordReset({
    body: { email: parsed.email, redirectTo: `${appUrl}/${parsed.locale}/reset?setup=1` },
  });

  await logEvent({
    userId: actor.id,
    action: "user.created_by_admin",
    entity: "User",
    entityId: user.id,
    metadata: { role: parsed.role },
  });
  return { id: user.id, setupMailSent: await isSmtpEnabled() };
}
