import type { StepUpFailure } from "@/components/auth/step-up-dialog";
import type { ApproveOAuthConsentState } from "@/server/transport/actions/mcp";

const STEP_UP_ERRORS = new Set(["BAD_PASSWORD", "RATE_LIMITED", "REAUTH_REQUIRED"]);

export type PasswordStepOutcome =
  | { next: "leave"; url: string }
  | { next: "retry"; failure: StepUpFailure }
  | { next: "signIn" }
  | { next: "fail"; error: string };

// prompt=login or max_age: the password alone doesn't satisfy the client, a new sign-in does.
export function passwordStepOutcome(res: ApproveOAuthConsentState): PasswordStepOutcome {
  if (res.ok) return { next: "leave", url: res.url };
  if (STEP_UP_ERRORS.has(res.error)) return { next: "retry", failure: res };
  if (res.error === "LOGIN_REQUIRED") return { next: "signIn" };
  return { next: "fail", error: res.error };
}
