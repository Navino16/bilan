import { overline as overlineClass } from "@/components/transactions/bits";
import { cn } from "@/lib/utils";

// Shared page header (issue #112 §1): every page shows an overline + serif title,
// with optional badges, subtitle and a right-side actions slot that wraps on mobile.
export function PageHeader({
  overline,
  title,
  badges,
  subtitle,
  actions,
  className,
}: {
  overline: React.ReactNode;
  title: React.ReactNode;
  badges?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 space-y-1.5">
        <div className={overlineClass}>{overline}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="font-display min-w-0 truncate text-[2rem] leading-[1.1]">{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="text-muted-foreground text-sm">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full">{actions}</div>
      )}
    </header>
  );
}
