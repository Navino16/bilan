import Link from "next/link";
import { cn } from "@/lib/utils";

// Server-safe (no client hooks): the shared centered Bilan card behind every
// error page (404/500/403/401). `action` is an optional link (e.g. back to
// dashboard); `onRetry` pages render their own button instead.
export function ErrorShell({
  code,
  title,
  message,
  action,
  documentTitle,
  landmark = true,
  children,
}: {
  code: string;
  title: string;
  message: string;
  action?: { href: string; label: string };
  /** For boundaries that get no route metadata (React 19 hoists <title> into <head>). */
  documentTitle?: string;
  /** False inside a layout that already renders the page's <main>. */
  landmark?: boolean;
  children?: React.ReactNode;
}) {
  const Root = landmark ? "main" : "div";
  return (
    <Root
      className={cn(
        "bg-background text-foreground flex flex-col items-center justify-center gap-3 px-6 text-center",
        landmark && "min-h-screen",
      )}
    >
      {documentTitle && <title>{documentTitle}</title>}
      <p className="text-muted-foreground font-mono text-sm">{code}</p>
      <h1 className="font-display text-4xl">{title}</h1>
      <p className="text-muted-foreground max-w-md">{message}</p>
      {action && (
        <Link
          href={action.href}
          className="text-foreground mt-2 text-sm underline underline-offset-4"
        >
          {action.label}
        </Link>
      )}
      {children}
    </Root>
  );
}
