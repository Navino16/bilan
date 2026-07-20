import fr from "../../messages/fr.json";
import { ErrorShell } from "@/components/shell/error-shell";

// Root 404 for unmatched top-level paths — rendered outside NextIntlClientProvider,
// so it uses the default-locale (fr) strings directly.
export default function RootNotFound() {
  const e = fr.errors;
  return (
    <ErrorShell
      code="404"
      title={e.notFound.title}
      message={e.notFound.message}
      action={{ href: "/fr/dashboard", label: e.back }}
    />
  );
}
