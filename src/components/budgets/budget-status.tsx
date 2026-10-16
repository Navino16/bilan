import type { BudgetStatus } from "@/lib/budgets";

export function statusStyle(status: BudgetStatus): { color: string; background: string } {
  switch (status) {
    case "OVER":
      return { color: "var(--expense-text)", background: "var(--expense-bg)" };
    case "WARN":
    case "REACHED":
      return { color: "var(--warning-text)", background: "var(--warning-bg)" };
    case "OK":
      return { color: "var(--income)", background: "var(--income-bg)" };
    default: {
      const unknown: never = status;
      throw new Error(`Unknown budget status: ${String(unknown)}`);
    }
  }
}

const BAR_FILL: Record<BudgetStatus, string> = {
  OVER: "var(--expense)",
  WARN: "var(--warning)",
  REACHED: "var(--warning)",
  OK: "var(--income)",
};

// A null percent (spending against a zero plan) fills the bar like any overspend.
export function BudgetBar({ percent, status }: { percent: number | null; status: BudgetStatus }) {
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, percent ?? 100)}%`, background: BAR_FILL[status] }}
      />
    </div>
  );
}
