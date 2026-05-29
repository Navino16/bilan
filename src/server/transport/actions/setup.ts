"use server";

import { z } from "zod";
import { completeSetup } from "@/server/services/bootstrap";
import { isSetupNeeded } from "@/server/services/setup-status";
import { appSettings } from "@/server/services/settings/app-settings";

export type ActionState = { ok: true } | { ok: false; error: string } | null;

const setupSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(12),
  locale: z.enum(["fr", "en"]).default("fr"),
  mode: z.enum(["OPEN", "INVITE_ONLY", "DISABLED"]),
});

// Atomic first-run setup: creates the first user (→ SUPER_ADMIN, signed in) and
// applies the chosen registration mode in one shot. Gated by isSetupNeeded() so
// it can only ever run while no user exists — that single gate is the
// authorization for the privileged registration_mode write (no separate,
// unauthenticated action). Data is collected client-side across the wizard
// steps, so the user isn't created mid-wizard (which would 404 /setup).
export async function completeSetupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };
  if (!(await isSetupNeeded())) return { ok: false, error: "ALREADY_SETUP" };
  try {
    const { userId } = await completeSetup({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      locale: parsed.data.locale,
    });
    await appSettings.set("registration_mode", parsed.data.mode, userId);
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}
