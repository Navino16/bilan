import { RE2JS } from "re2js";

// User REGEX rules run on RE2 (linear time): a backtracking engine would let one
// crafted pattern freeze the event loop for every user (ReDoS).
const cache = new Map<string, RE2JS | null>();
const CACHE_MAX = 500;

type RegexCompiler = (pattern: string, caseSensitive: boolean) => RE2JS | null;

const cacheKey = (pattern: string, caseSensitive: boolean) =>
  `${caseSensitive ? "s" : "i"}:${pattern}`;

function compile(pattern: string, caseSensitive: boolean): RE2JS | null {
  try {
    return RE2JS.compile(pattern, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch {
    return null;
  }
}

export function compileRulePattern(pattern: string, caseSensitive: boolean): RE2JS | null {
  const key = cacheKey(pattern, caseSensitive);
  if (cache.has(key)) return cache.get(key)!;
  const compiled = compile(pattern, caseSensitive);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

// Unbounded, for one batch: past CACHE_MAX distinct patterns the shared FIFO cache would
// recompile on every lookup (#291).
export function createRegexCompiler(): RegexCompiler {
  const local = new Map<string, RE2JS | null>();
  return (pattern, caseSensitive) => {
    const key = cacheKey(pattern, caseSensitive);
    if (!local.has(key)) local.set(key, compile(pattern, caseSensitive));
    return local.get(key)!;
  };
}

export function isValidRulePattern(pattern: string): boolean {
  return compileRulePattern(pattern, true) !== null;
}
