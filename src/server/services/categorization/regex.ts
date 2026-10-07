import { RE2JS } from "re2js";

// User REGEX rules run on RE2 (linear time): a backtracking engine would let one
// crafted pattern freeze the event loop for every user (ReDoS).
const cache = new Map<string, RE2JS | null>();
const CACHE_MAX = 500;

export function compileRulePattern(pattern: string, caseSensitive: boolean): RE2JS | null {
  const key = `${caseSensitive ? "s" : "i"}:${pattern}`;
  if (cache.has(key)) return cache.get(key)!;
  let compiled: RE2JS | null;
  try {
    compiled = RE2JS.compile(pattern, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch {
    compiled = null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

export function isValidRulePattern(pattern: string): boolean {
  return compileRulePattern(pattern, true) !== null;
}
