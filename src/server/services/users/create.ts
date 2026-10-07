import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { grantRole } from "@/server/services/users/roles";
import { logEvent } from "@/server/services/audit";
import { env } from "@/env";
import { defaultLocale, locales } from "@/i18n/config";

export const adminCreateUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  locale: z.enum(locales).default(defaultLocale).catch(defaultLocale),
});

export type AdminCreateUserInput = z.input<typeof adminCreateUserSchema>;

// Admin-provisions a user with a throwaway password, then sends the reset flow as a
// "choose your password" mail (`setup=1`). The setup token is never returned or logged.
export async function adminCreateUser(
  input: AdminCreateUserInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const parsed = adminCreateUserSchema.parse(input);
  const auth = await getAuth();

  // Not signUpEmail: with autoSignIn + nextCookies it would sign the admin in as the new user.
  const ctx = await auth.$context;
  const email = parsed.email.toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error("USER_EXISTS");
  const user = await ctx.internalAdapter.createUser({
    email,
    name: parsed.name,
    emailVerified: false,
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(randomBytes(32).toString("base64url")),
  });

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
  return { id: user.id };
}
