import type { RuleMatchType } from "@/lib/validation/rule";

export const RULES_FILE_FORMAT = "bilan-rules";
export const RULES_FILE_VERSION = 1;
// Stays under the 1 MB server-action body limit.
export const RULES_FILE_MAX_BYTES = 512 * 1024;
export const RULES_FILE_MAX_RULES = 2000;
export const RULES_FILE_MAX_DEPTH = 10;

export type CategoryLevel = { name: string; color?: string; icon?: string };

export type FileRule = {
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority: number;
  enabled: boolean;
  category: CategoryLevel[];
};

export type RulesFile = {
  format: typeof RULES_FILE_FORMAT;
  version: typeof RULES_FILE_VERSION;
  exportedAt: string;
  rules: FileRule[];
};

export type RejectedRule = {
  index: number;
  pattern: string | null;
  reason: "INVALID" | "INVALID_REGEX";
};
