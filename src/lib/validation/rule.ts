export const RULE_MATCH_TYPES = ["CONTAINS", "EXACT", "STARTS_WITH", "REGEX"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
