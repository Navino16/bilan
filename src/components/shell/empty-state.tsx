import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  id,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      data-slot="empty-state"
      className={cn(
        "border-border flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <Icon aria-hidden className="text-muted-foreground size-6" />
      <div className="max-w-md space-y-1">
        <h2 className="font-display text-xl">{title}</h2>
        {body && <p className="text-muted-foreground text-sm">{body}</p>}
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
