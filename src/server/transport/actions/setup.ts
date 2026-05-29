"use server";

import { z } from "zod";
import { completeSetup } from "@/server/services/bootstrap";
import { isSetupNeeded } from "@/server/services/setup-status";
import { appSettings } from "@/server/services/settings/app-settings";

export type ActionState = { ok: true } | { ok: false; error: string } | null;

const accountSchema = z.object({
  email: z.email(),
  password: z.string().min(12),
  name: z.string().min(1),
  locale: z.enum(["fr", "en"]).default("fr"),
});

export async function setupAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };
  if (!(await isSetupNeeded())) return { ok: false, error: "ALREADY_SETUP" };
  try {
    await completeSetup(parsed.data);
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}

const registrationSchema = z.object({
  mode: z.enum(["OPEN", "INVITE_ONLY", "DISABLED"]),
});

export async function setupRegistrationModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registrationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };
  // The first user (just created in the account step) is the implicit actor.
  await appSettings.set("registration_mode", parsed.data.mode, "setup");
  return { ok: true };
}
