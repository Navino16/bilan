"use server";

import { headers as nextHeaders } from "next/headers";
import { requireSession } from "@/server/auth/permissions";
import { getAuth } from "@/server/auth";
import { deleteUser } from "@/server/services/rgpd";

export type AccountDataState = { ok: true } | { ok: false; error: string } | null;

export async function deleteAccountAction(
  _prev: AccountDataState,
  formData: FormData,
): Promise<AccountDataState> {
  const user = await requireSession();
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "INVALID" };

  const auth = await getAuth();
  // Re-authenticate: verify the password by attempting a sign-in for this email.
  try {
    await auth.api.signInEmail({
      body: { email: user.email, password },
      headers: await nextHeaders(),
    });
  } catch {
    return { ok: false, error: "BAD_PASSWORD" };
  }

  try {
    await deleteUser(user.id, { id: user.id });
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}
