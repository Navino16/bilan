"use client";

import type { ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Horizontal step indicator (Fichier → Lecture → Correspondances → Validation).
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div
      data-slot="import-stepper"
      className="border-border bg-card flex items-center rounded-xl border px-3.5 py-3 shadow-sm"
    >
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div
            className="flex items-center gap-2"
            aria-current={i === current ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold",
                i < current
                  ? "bg-primary text-primary-foreground"
                  : i === current
                    ? "bg-foreground text-background"
                    : "border-border text-muted-foreground border",
              )}
            >
              {i < current ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[13px] whitespace-nowrap",
                i === current ? "text-foreground font-medium" : "text-muted-foreground",
                i !== current && "sr-only sm:not-sr-only",
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && <span className="bg-border mx-1 h-px min-w-2 flex-1 sm:mx-3" />}
        </div>
      ))}
    </div>
  );
}

export function FieldMap({
  label,
  mapped = true,
  invalid,
  children,
}: {
  label: string;
  mapped?: boolean;
  /** Set when rows were rejected because of this column: the message replaces the check mark. */
  invalid?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border flex items-center gap-2 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {mapped && invalid ? (
        <span
          data-slot="field-invalid"
          role="img"
          aria-label={invalid}
          title={invalid}
          className="shrink-0"
          style={{ color: "var(--warning-text)" }}
        >
          <TriangleAlert aria-hidden className="size-3.5" />
        </span>
      ) : mapped ? (
        <Check data-slot="field-mapped" className="text-muted-foreground size-3.5 shrink-0" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
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
        "flex w-full items-center gap-2.5 py-1.5 text-left max-md:min-h-10",
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
