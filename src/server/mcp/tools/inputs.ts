import { z } from "zod";
import {
  BASELINES,
  PERIOD_PRESETS,
  comparisonFor,
  dayEnd,
  dayStart,
  isValidIsoDay,
  monthPeriod,
  parseBaseline,
  parseRangeParams,
  presetPeriod,
  type Baseline,
  type Comparison,
  type Period,
} from "@/lib/period";
import { TRANSACTION_SORTS, UNCATEGORIZED } from "@/lib/transaction-filters";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";
import { RULES_FILE_MAX_RULES } from "@/lib/validation/rules-file";
import type { TransactionFilters } from "@/server/services/transactions";
import { McpToolError } from "@/server/mcp/errors";

const isoDay = (what: string) => z.string().describe(`${what}, YYYY-MM-DD (inclusive)`);

export const periodInput = z
  .strictObject({
    preset: z.enum(PERIOD_PRESETS).optional(),
    from: isoDay("First day").optional(),
    to: isoDay("Last day").optional(),
  })
  .describe("Either a preset or a from/to range; the current month when omitted");
export type PeriodInput = z.infer<typeof periodInput>;

export const comparisonInput = z
  .enum(BASELINES)
  .describe("Reference: previous period, or the average of the last 3/6/12 months");

export const ruleIdsInput = z
  .array(z.string().min(1))
  .min(1)
  .max(RULES_FILE_MAX_RULES)
  .describe("Rule ids, from list_rules");

export const searchInput = z.strictObject({
  accountId: z.string().optional(),
  categoryId: z
    .string()
    .optional()
    .describe(`Category id (its subcategories included), or "${UNCATEGORIZED}" for uncategorized`),
  type: z.enum(TRANSACTION_TYPES).optional(),
  direction: z.enum(["in", "out"]).optional(),
  amountMin: z.number().nonnegative().optional().describe("Lower bound on the absolute amount"),
  amountMax: z.number().nonnegative().optional().describe("Upper bound on the absolute amount"),
  sort: z.enum(TRANSACTION_SORTS).optional(),
  from: isoDay("First day").optional(),
  to: isoDay("Last day").optional(),
  search: z.string().max(200).optional().describe("Words that must all prefix-match the label"),
  take: z.number().int().min(1).max(1000).default(100),
  skip: z.number().int().min(0).default(0),
});
export type SearchInput = z.infer<typeof searchInput>;

function validDays(from: string | undefined, to: string | undefined): void {
  for (const d of [from, to]) {
    if (d !== undefined && !isValidIsoDay(d)) throw new McpToolError("INVALID_PERIOD");
  }
  if (from && to && to < from) throw new McpToolError("INVALID_PERIOD");
}

export function toPeriod(input: PeriodInput | undefined, now: Date = new Date()): Period {
  const { preset, from, to } = input ?? {};
  if (preset) {
    if (from !== undefined || to !== undefined) throw new McpToolError("INVALID_PERIOD");
    return presetPeriod(preset, now);
  }
  if (from === undefined && to === undefined) {
    return monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  }
  validDays(from, to);
  const period = parseRangeParams({ from, to }, now);
  if (!period) throw new McpToolError("INVALID_PERIOD");
  return period;
}

export function toComparison(
  period: Period,
  baseline: Baseline | undefined,
  fallback: Baseline,
  now: Date = new Date(),
): Comparison {
  return comparisonFor(period, parseBaseline(baseline, period, fallback), now);
}

export function toTransactionFilters(input: SearchInput): TransactionFilters {
  const { from, to, ...rest } = input;
  validDays(from, to);
  return {
    ...rest,
    from: from ? dayStart(from) : undefined,
    to: to ? dayEnd(to) : undefined,
  };
}
