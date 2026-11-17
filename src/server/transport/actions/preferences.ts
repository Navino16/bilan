"use server";

import { getCurrentUser, requireSession } from "@/server/auth/permissions";
import { isLocale } from "@/lib/locale-negotiation";
import {
  PreferenceInputError,
  syncPreferredLocale,
  updateExceptionalRule,
} from "@/server/services/users/preferences";
import { exceptionalSettingsSchema } from "@/lib/schemas/exceptional-settings";
import { AMOUNT_ERRORS } from "@/lib/amount";
import { issueCode } from "@/lib/schemas/amount";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import { defaultLocale } from "@/i18n/config";

// Signed out: a no-op, the NEXT_LOCALE cookie alone carries the choice.
export async function syncLocaleAction(locale: unknown): Promise<void> {
  if (!isLocale(locale)) return;
  const user = await getCurrentUser();
  if (user) await syncPreferredLocale(user.id, locale);
}

export type ExceptionalSettingsActionState = { ok: true } | FormFailure | null;

export async function updateExceptionalSettingsAction(
  _prev: ExceptionalSettingsActionState,
  formData: FormData,
): Promise<ExceptionalSettingsActionState> {
  const user = await requireSession();
  const input = {
    minAmount: String(formData.get("minAmount") ?? ""),
    factor: String(formData.get("factor") ?? ""),
  };
  const parsed = exceptionalSettingsSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput(parsed.error, input, issueCode(parsed.error.issues, AMOUNT_ERRORS));
  const locale = formData.get("locale");
  try {
    await updateExceptionalRule(user.id, parsed.data, isLocale(locale) ? locale : defaultLocale);
    return { ok: true };
  } catch (e) {
    if (e instanceof PreferenceInputError)
      return { ok: false, error: "INVALID", fieldErrors: e.fieldErrors };
    return { ok: false, error: "FAILED" };
  }
}
