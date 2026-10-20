import {
  RULES_FILE_MAX_RULES,
  fileRuleSchema,
  rulesEnvelopeSchema,
  type FileRule,
  type RejectedRule,
} from "@/lib/validation/rules-file";
import { isValidRulePattern } from "./regex";

export type ParsedRulesFile =
  | { ok: true; rules: FileRule[]; rejected: RejectedRule[] }
  | { ok: false; error: "BAD_FILE" | "TOO_MANY" };

// The envelope is all-or-nothing; each rule is then validated on its own so one bad rule
// does not sink the file (#291). Regex validity needs RE2, hence server-side.
export function parseRulesFile(text: string): ParsedRulesFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "BAD_FILE" };
  }
  const envelope = rulesEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { ok: false, error: "BAD_FILE" };
  if (envelope.data.rules.length > RULES_FILE_MAX_RULES) return { ok: false, error: "TOO_MANY" };

  const rules: FileRule[] = [];
  const rejected: RejectedRule[] = [];
  envelope.data.rules.forEach((raw, index) => {
    const rawPattern = (raw as { pattern?: unknown } | null)?.pattern;
    const pattern = typeof rawPattern === "string" ? rawPattern : null;
    const parsed = fileRuleSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ index, pattern, reason: "INVALID" });
    } else if (parsed.data.matchType === "REGEX" && !isValidRulePattern(parsed.data.pattern)) {
      rejected.push({ index, pattern, reason: "INVALID_REGEX" });
    } else {
      rules.push(parsed.data);
    }
  });
  return { ok: true, rules, rejected };
}
