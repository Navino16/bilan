"use server";

import { headers } from "next/headers";
import { requireSession } from "@/server/auth/permissions";
import { requestLocale } from "@/server/http/request-locale";
import { verificationMailLimiter, withRefund } from "@/server/auth/rate-limit";
import { resendVerificationEmail } from "@/server/services/users/email-verification";

export type ResendVerificationState =
  | { ok: true; status: "SENT" | "ALREADY_VERIFIED" }
  | { ok: false; error: "RATE_LIMITED" | "SMTP_DISABLED" | "FAILED" };

export async function resendVerificationEmailAction(): Promise<ResendVerificationState> {
  const user = await requireSession();
  try {
    const res = await withRefund(
      verificationMailLimiter,
      user.id,
      async () => resendVerificationEmail(user.id, requestLocale(await headers())),
      (status) => status === "SENT",
    );
    if (!res.allowed) return { ok: false, error: "RATE_LIMITED" };
    if (res.result === "SMTP_DISABLED" || res.result === "FAILED") {
      return { ok: false, error: res.result };
    }
    return { ok: true, status: res.result };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}
