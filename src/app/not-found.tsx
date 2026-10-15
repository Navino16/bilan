import { headers } from "next/headers";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import { DocumentShell } from "@/components/shell/document-shell";
import { ErrorShell } from "@/components/shell/error-shell";
import { negotiateLocale } from "@/lib/locale-negotiation";
import { getAppName } from "@/server/services/settings/app-settings";

const MESSAGES = { fr, en };

// Rendered outside `[locale]/layout.tsx` (root layout is a pass-through) for paths the
// proxy skips (dotted, /api/*): it provides its own document and negotiates the locale.
export default async function RootNotFound() {
  const h = await headers();
  const locale = negotiateLocale(h.get("cookie"), h.get("accept-language"));
  const appName = await getAppName();
  const m = MESSAGES[locale];
  const e = m.errors;
  return (
    <DocumentShell lang={locale}>
      <ErrorShell
        code="404"
        title={e.notFound.title}
        message={e.notFound.message}
        action={{ href: `/${locale}/dashboard`, label: e.back }}
        documentTitle={`${m.meta.titles.notFound} · ${appName}`}
      />
    </DocumentShell>
  );
}
