import { Card } from "@/components/ui/card";
import { overline as overlineClass } from "@/components/transactions/bits";
import { cn } from "@/lib/utils";

// Column header row for lists rendered inside a flush SectionCard.
export const listHeader =
  "text-muted-foreground bg-muted/60 border-b px-6 py-2.5 text-[0.65rem] tracking-[0.08em] uppercase";

// Section block shared by the settings and admin pages (issue #112 §2).
// `flush` drops the body padding so lists and tables run edge to edge.
export function SectionCard({
  overline,
  title,
  hint,
  action,
  flush = false,
  className,
  children,
}: {
  overline: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className={overlineClass}>{overline}</div>
        <h2 className="font-display text-xl">{title}</h2>
        {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
      </div>
      {action}
    </div>
  );

  if (flush) {
    return (
      <Card className={cn("gap-0 p-0", className)}>
        <div className="p-6">{heading}</div>
        <div className="border-t">{children}</div>
      </Card>
    );
  }
  return (
    <Card className={cn("max-w-2xl gap-4 p-6", className)}>
      {heading}
      {children}
    </Card>
  );
}
