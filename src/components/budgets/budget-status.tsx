import type { BudgetStatus } from "@/lib/budgets";
import { lineFlow } from "@/lib/budget-match";
import type { BudgetLineKind, TransferDirection } from "@/lib/validation/budget";

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

type DisplayLine = {
  kind: BudgetLineKind;
  direction: TransferDirection | null;
  status: BudgetStatus;
  counterpartSavings: boolean;
};

export type LineDisplay = {
  // Translation key under `budgets` and colours of the line's badge.
  badge: { key: string; style: { color: string; background: string } };
  barStatus: BudgetStatus;
  // How an amount past the planned one reads (design §C): only spending is overrun.
  overrun: "over" | "more" | "saved";
};

const incomeStyle = { color: "var(--income)", background: "var(--income-bg)" };

export function lineDisplay(line: DisplayLine): LineDisplay {
  const done = line.status === "REACHED" || line.status === "OVER";
  if (lineFlow(line) === "in") {
    return {
      badge: done
        ? { key: "lineStatus.RECEIVED", style: incomeStyle }
        : {
            key: "lineStatus.EXPECTED",
            style: { color: "var(--muted-foreground)", background: "var(--muted)" },
          },
      barStatus: "OK",
      overrun: "more",
    };
  }
  if (line.kind === "TRANSFER" && line.status === "OVER") {
    return line.counterpartSavings
      ? {
          badge: { key: "lineStatus.SAVED", style: incomeStyle },
          barStatus: "OK",
          overrun: "saved",
        }
      : {
          badge: { key: "status.REACHED", style: statusStyle("REACHED") },
          barStatus: "REACHED",
          overrun: "more",
        };
  }
  return {
    badge: { key: `status.${line.status}`, style: statusStyle(line.status) },
    barStatus: line.status,
    overrun: "over",
  };
}
