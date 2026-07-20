import Link from "next/link";

// Server-safe (no client hooks): the shared centered Bilan card behind every
// error page (404/500/403/401). `action` is an optional link (e.g. back to
// dashboard); `onRetry` pages render their own button instead.
export function ErrorShell({
  code,
  title,
  message,
  action,
  children,
}: {
  code: string;
  title: string;
  message: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
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
    </main>
  );
}
