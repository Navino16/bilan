"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Horizontal step indicator (Fichier → Lecture → Correspondances → Validation).
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="border-border bg-card flex items-center rounded-xl border px-3.5 py-3 shadow-sm">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className={cn("flex items-center gap-2", i > current && "opacity-45")}>
            <span
              className={cn(
                "flex size-[22px] items-center justify-center rounded-full font-mono text-[11px] font-semibold",
                i < current
                  ? "bg-primary text-primary-foreground"
                  : i === current
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i < current ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[13px] whitespace-nowrap",
                i === current ? "text-foreground font-medium" : "text-muted-foreground",
                i !== current && "hidden sm:inline",
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && <span className="bg-border mx-3 h-px flex-1" />}
        </div>
      ))}
    </div>
  );
}

// Sidebar column-mapping row: fixed label + a control + a check tick.
export function FieldMap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex items-center gap-2 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <Check className="text-muted-foreground size-3.5 shrink-0" />
    </div>
  );
}

// Sidebar option toggle (checkbox + label). Controlled; can be disabled.
export function CheckRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "flex w-full items-center gap-2.5 py-1.5 text-left",
        disabled && "cursor-default",
      )}
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded border",
          checked ? "bg-primary border-primary text-primary-foreground" : "border-input bg-card",
        )}
      >
        {checked && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span className={cn("text-[12.5px]", checked ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </button>
  );
}
