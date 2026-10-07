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

  const provisionalPassword = randomBytes(32).toString("base64url");
  const res = await auth.api.signUpEmail({
    body: { email: parsed.email, password: provisionalPassword, name: parsed.name },
  });

  await grantRole(db, res.user.id, parsed.role, actor.id);
  const appUrl = env.APP_URL.replace(/\/$/, "");
  await auth.api.requestPasswordReset({
    body: { email: parsed.email, redirectTo: `${appUrl}/${parsed.locale}/reset?setup=1` },
  });

  await logEvent({
    userId: actor.id,
    action: "user.created_by_admin",
    entity: "User",
    entityId: res.user.id,
    metadata: { role: parsed.role },
  });
  return { id: res.user.id };
}
