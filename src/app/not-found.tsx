import { connection } from "next/server";
import fr from "../../messages/fr.json";
import { DocumentShell } from "@/components/shell/document-shell";
import { ErrorShell } from "@/components/shell/error-shell";
import { getAppName } from "@/server/services/settings/app-settings";

// Rendered outside `[locale]/layout.tsx` (root layout is a pass-through), so it
// provides its own document and uses default-locale (fr) strings.
export default async function RootNotFound() {
  // Request-time only: the instance name lives in the database.
  await connection();
  const appName = await getAppName();
  const e = fr.errors;
  return (
    <DocumentShell lang="fr">
      <ErrorShell
        code="404"
        title={e.notFound.title}
        message={e.notFound.message}
        action={{ href: "/fr/dashboard", label: e.back }}
        documentTitle={`${fr.meta.titles.notFound} · ${appName}`}
      />
    </DocumentShell>
  );
}
