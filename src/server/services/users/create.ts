import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { grantRole } from "@/server/services/users/roles";
import { logEvent } from "@/server/services/audit";

export const adminCreateUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

// Admin-provisions a user: creates the account with a throwaway password, grants
// the chosen role, then triggers the password-reset flow so the user sets their
// own password via the existing /reset/[token] page (link delivered by
// sendResetPassword — dev console now, SMTP in 8.4). The setup token is never
// returned or logged.
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
  await auth.api.requestPasswordReset({ body: { email: parsed.email } });

  await logEvent({
    userId: actor.id,
    action: "user.created_by_admin",
    entity: "User",
    entityId: res.user.id,
    metadata: { role: parsed.role },
  });
  return { id: res.user.id };
}
