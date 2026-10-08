import type { BudgetStatus } from "@/lib/budgets";

export function statusStyle(status: BudgetStatus): { color: string; background: string } {
  switch (status) {
    case "OVER":
      return { color: "var(--expense-text)", background: "var(--expense-bg)" };
    case "WARN":
      return { color: "var(--warning-text)", background: "var(--warning-bg)" };
    default:
      return { color: "var(--income)", background: "var(--income-bg)" };
  }
}

const BAR_FILL: Record<BudgetStatus, string> = {
  OVER: "var(--expense)",
  WARN: "var(--warning)",
  OK: "var(--income)",
};

export function BudgetBar({ percent, status }: { percent: number; status: BudgetStatus }) {
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, percent)}%`, background: BAR_FILL[status] }}
      />
    </div>
  );
}
