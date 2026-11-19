import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { getAppName } from "@/server/services/settings/app-settings";
import { getMcpEnabled } from "@/server/services/users/preferences";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
import {
  accessChoices,
  isOAuthAuthorizeError,
  parseConsentRequest,
} from "@/server/mcp/oauth-consent";
import { OAuthConsent, type ConsentView } from "@/components/auth/oauth-consent";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("consent");

function toParams(query: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, v);
    }
  }
  return params;
}

async function consentView(params: URLSearchParams): Promise<ConsentView> {
  // An authorization the plugin refused before reaching this page (login page redirect).
  if (params.has("error") && !params.has("sig")) {
    const code = params.get("error");
    return { kind: "error", code: isOAuthAuthorizeError(code) ? code : null };
  }
  const user = await requireSession();
  if (!(await isMcpInstanceEnabled())) return { kind: "instanceOff", email: user.email };
  const parsed = await parseConsentRequest(params);
  if (!parsed.ok) return { kind: "expired", email: user.email };
  const { request } = parsed;
  const choices = accessChoices(request.requested);
  const kind = !(await getMcpEnabled(user.id))
    ? "mcpDisabled"
    : choices.length === 0
      ? "noScope"
      : "consent";
  return { kind, email: user.email, request, choices };
}

export default async function OAuthConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const [view, appName] = await Promise.all([consentView(toParams(query)), getAppName()]);
  return <OAuthConsent view={view} appName={appName} />;
}
