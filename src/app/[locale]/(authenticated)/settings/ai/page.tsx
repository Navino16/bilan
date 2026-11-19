import { getTranslations, setRequestLocale } from "next-intl/server";
import { env } from "@/env";
import { requireSession } from "@/server/auth/permissions";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
import { listOAuthGrants } from "@/server/mcp/oauth-grants";
import { listMcpTokens } from "@/server/mcp/tokens";
import { getMcpEnabled } from "@/server/services/users/preferences";
import { AiAssistants } from "@/components/settings/ai-assistants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("ai");

export default async function AiAssistantsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("settings.ai");
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;

  if (!(await isMcpInstanceEnabled())) {
    return (
      <div className="space-y-6">
        {header}
        <Alert role="status" data-slot="mcp-instance-off">
          <AlertTitle>{t("instanceOff.title")}</AlertTitle>
          <AlertDescription>{t("instanceOff.body")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const [enabled, tokens, grants] = await Promise.all([
    getMcpEnabled(user.id),
    listMcpTokens(user.id),
    listOAuthGrants(user.id),
  ]);
  return (
    <div className="space-y-6">
      {header}
      <AiAssistants
        locale={locale}
        enabled={enabled}
        endpoint={`${env.APP_URL.replace(/\/$/, "")}/api/mcp`}
        tokens={tokens}
        grants={grants}
      />
    </div>
  );
}
