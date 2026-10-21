"use server";

import { requireSession } from "@/server/auth/permissions";
import {
  createLink,
  deleteLink,
  getLinkSummary,
  ignoreSuggestion,
  LinkAccessError,
  restoreSuggestion,
  type LinkSummary,
} from "@/server/services/links";
import {
  PreferenceInputError,
  updateLinkSuggestionSettings,
} from "@/server/services/users/preferences";
import { linkSettingsSchema } from "@/lib/schemas/link-settings";
import { AMOUNT_ERRORS } from "@/lib/amount";
import { issueCode } from "@/lib/schemas/amount";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import { isLocale } from "@/lib/locale-negotiation";
import { defaultLocale } from "@/i18n/config";

export type LinkActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof LinkAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const ids = String(formData.get("transactionIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length < 2) return { ok: false, error: "TOO_FEW" };
  try {
    const { id } = await createLink({ transactionIds: ids, userId: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function deleteLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const id = String(formData.get("linkId") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteLink(id, user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function ignoreSuggestionAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const pairKey = String(formData.get("pairKey") ?? "");
  if (!pairKey.includes("|")) return { ok: false, error: "INVALID" };
  try {
    await ignoreSuggestion(user.id, pairKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function restoreSuggestionAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const pairKey = String(formData.get("pairKey") ?? "");
  if (!pairKey.includes("|")) return { ok: false, error: "INVALID" };
  try {
    await restoreSuggestion(user.id, pairKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function getLinkSummaryAction(transactionId: string): Promise<LinkSummary | null> {
  const user = await requireSession();
  if (typeof transactionId !== "string" || !transactionId) return null;
  return getLinkSummary(transactionId, user.id);
}

export type LinkSettingsActionState = { ok: true } | FormFailure | null;

export async function updateLinkSettingsAction(
  _prev: LinkSettingsActionState,
  formData: FormData,
): Promise<LinkSettingsActionState> {
  const user = await requireSession();
  const input = {
    windowDays: String(formData.get("windowDays") ?? ""),
    minAmount: String(formData.get("minAmount") ?? ""),
  };
  const parsed = linkSettingsSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput(parsed.error, input, issueCode(parsed.error.issues, AMOUNT_ERRORS));
  const locale = formData.get("locale");
  try {
    await updateLinkSuggestionSettings(
      user.id,
      parsed.data,
      isLocale(locale) ? locale : defaultLocale,
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof PreferenceInputError)
      return { ok: false, error: "INVALID", fieldErrors: e.fieldErrors };
    return { ok: false, error: "FAILED" };
  }
}
