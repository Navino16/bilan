import { env } from "@/env";
import { negotiateLocale } from "@/lib/locale-negotiation";
import { getCurrentUser } from "@/server/auth/permissions";
import { requestOrigin } from "@/server/http/client-ip";
import { completeBankAuth } from "@/server/services/bank-sync/connect";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { syncConnection } from "@/server/services/bank-sync/sync";

export const runtime = "nodejs";

// The bank sends the browser back here (design §Connect flow 3); the answer is always a redirect.
export async function GET(req: Request): Promise<Response> {
  const locale = negotiateLocale(req.headers.get("cookie"), req.headers.get("accept-language"));
  const redirect = (path: string, code?: string) => {
    const to = new URL(`/${locale}${path}`, env.APP_URL);
    if (code) to.searchParams.set("bankSync", code);
    return new Response(null, {
      status: 302,
      headers: { Location: to.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  };

  const user = await getCurrentUser();
  if (!user) return redirect("/accounts", "SIGNED_OUT");
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  if (!state) return redirect("/accounts", "UNKNOWN_STATE");
  try {
    const { connectionId, needsMapping } = await completeBankAuth(user.id, {
      state,
      code: params.get("code") ?? undefined,
      error: params.get("error") ?? undefined,
    });
    if (needsMapping) return redirect(`/accounts/bank-sync/${connectionId}`);
    // A reconnect with nothing to map: the user is present, so the bank serves the older history too.
    const result = await syncConnection(connectionId, { psu: requestOrigin(req.headers) });
    return redirect("/accounts", result.status === "FAILED" ? result.code : "RECONNECTED");
  } catch (e) {
    if (e instanceof BankSyncError) return redirect("/accounts", e.code);
    console.error("[bilan] bank callback failed", e instanceof Error ? e.name : typeof e);
    return redirect("/accounts", "FAILED");
  }
}
