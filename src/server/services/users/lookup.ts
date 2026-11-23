import { db } from "@/server/db";

// Case-insensitive existence check by email. Used by the registration flow to
// decide whether a failed signUpEmail actually created a user (so a consumed
// invite token is only refunded when no user was created by that attempt).
export async function userExistsByEmail(email: string): Promise<boolean> {
  const row = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return row !== null;
}
