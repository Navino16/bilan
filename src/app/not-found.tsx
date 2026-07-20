import fr from "../../messages/fr.json";
import { mono, sans, serif } from "@/lib/fonts";
import { ErrorShell } from "@/components/shell/error-shell";

// Root 404 for unmatched top-level paths. The root layout is a pass-through
// (`<html>`/`<body>` live in `[locale]/layout.tsx`), so this page — rendered
// outside any locale segment — MUST provide its own document, or Next throws
// "Missing <html> and <body> tags in the root layout". Default-locale (fr)
// strings, since there's no NextIntlClientProvider here.
export default function RootNotFound() {
  const e = fr.errors;
  return (
    <html lang="fr" className={`${sans.variable} ${serif.variable} ${mono.variable} h-full`}>
      <body className="bg-background text-foreground font-sans antialiased">
        <ErrorShell
          code="404"
          title={e.notFound.title}
          message={e.notFound.message}
          action={{ href: "/fr/dashboard", label: e.back }}
        />
      </body>
    </html>
  );
}
