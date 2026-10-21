export const BUDGET_NAME_MAX = 80;
export const BUDGET_DESCRIPTION_MAX = 500;
export const BUDGET_LINE_LABEL_MAX = 80;
export const BUDGET_PERIOD_TYPES = ["WEEK", "MONTH", "QUARTER", "YEAR", "CUSTOM"] as const;
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];
