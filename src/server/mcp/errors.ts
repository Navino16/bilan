import { ZodError } from "zod";
import { AccountAccessError } from "@/server/services/accounts";
import { BudgetAccessError } from "@/server/services/budgets";
import { CategoryAccessError } from "@/server/services/categories";
import { RuleAccessError, RuleValidationError } from "@/server/services/categorization";
import { GroupAccessError } from "@/server/services/groups/roles";
import { LinkAccessError } from "@/server/services/links";
import { MerchantAliasError } from "@/server/services/merchants";
import { TransactionAccessError } from "@/server/services/transactions";
import { PreferenceInputError } from "@/server/services/users/preferences";

export type ToolErrorCode =
  "NOT_FOUND" | "FORBIDDEN" | "INVALID_PERIOD" | "INVALID_INPUT" | "RATE_LIMITED" | "FAILED";

export class McpToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

// Services throw these with their code as the message (see the Server Actions' mapError).
const ACCESS_ERRORS = [
  AccountAccessError,
  BudgetAccessError,
  CategoryAccessError,
  GroupAccessError,
  LinkAccessError,
  MerchantAliasError,
  RuleAccessError,
  TransactionAccessError,
];

const isAccessError = (e: unknown): e is Error =>
  e instanceof Error && ACCESS_ERRORS.some((cls) => e instanceof cls);

export function toolErrorCode(e: unknown): ToolErrorCode {
  if (e instanceof McpToolError) return e.code;
  if (
    e instanceof ZodError ||
    e instanceof RuleValidationError ||
    e instanceof PreferenceInputError
  )
    return "INVALID_INPUT";
  if (isAccessError(e)) {
    if (e.message === "NOT_FOUND" || e.message === "INVALID_PERIOD") return e.message;
    return e.message.startsWith("INVALID") ? "INVALID_INPUT" : "FORBIDDEN";
  }
  console.error("MCP tool failed", e);
  return "FAILED";
}

// The service's own code (LOCKED_FIELDS, ALREADY_LINKED…) when the tool code is broader (spec §5.18).
export function toolErrorDetail(e: unknown): string | undefined {
  if (e instanceof McpToolError) return e.detail;
  if (!(isAccessError(e) || e instanceof RuleValidationError)) return undefined;
  if (e.message === toolErrorCode(e)) return undefined;
  return e.message;
}
