"use client";

import { useTranslations } from "next-intl";
import type { BudgetMatchLine } from "@/server/services/budgets";

type NameOf = (id: string) => string | undefined;

// A budget line's display name, shared by the budget detail and the transaction panel (#365).
export function useBudgetLineLabel() {
  const t = useTranslations("budgets");
  return (
    line: Omit<BudgetMatchLine, "id">,
    { category, account, lineCount }: { category: NameOf; account: NameOf; lineCount: number },
  ): string => {
    if (line.label) return line.label;
    if (line.kind === "TRANSFER") {
      const name = line.counterpartAccountId ? account(line.counterpartAccountId) : undefined;
      return t(line.direction === "IN" ? "line.transferFrom" : "line.transferTo", {
        account: name ?? t("line.hidden"),
      });
    }
    const categoryName = line.categoryId ? category(line.categoryId) : undefined;
    if (categoryName) return categoryName;
    const accountName = line.accountId ? account(line.accountId) : undefined;
    if (accountName) return accountName;
    if (line.categoryId || line.accountId) return t("line.hidden");
    return lineCount > 1 ? t("line.otherSpending") : t("line.allSpending");
  };
}
