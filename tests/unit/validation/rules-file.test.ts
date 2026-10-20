import { describe, it, expect } from "vitest";
import { parseRulesFile } from "@/server/services/categorization/rules-file";
import { RULES_FILE_MAX_DEPTH, RULES_FILE_MAX_RULES } from "@/lib/validation/rules-file";

const rule = (over: Record<string, unknown> = {}) => ({
  pattern: "CARREFOUR",
  matchType: "CONTAINS",
  caseSensitive: false,
  priority: 100,
  enabled: true,
  category: [{ name: "Food" }],
  ...over,
});
const file = (rules: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "bilan-rules",
    version: 1,
    exportedAt: "2026-10-20T00:00:00.000Z",
    rules,
    ...over,
  });

describe("parseRulesFile", () => {
  it("refuses non-JSON / wrong format / wrong version", () => {
    expect(parseRulesFile("not json")).toEqual({ ok: false, error: "BAD_FILE" });
    expect(parseRulesFile(file([], { format: "other" }))).toEqual({ ok: false, error: "BAD_FILE" });
    expect(parseRulesFile(file([], { version: 2 }))).toEqual({ ok: false, error: "BAD_FILE" });
    expect(parseRulesFile(file([], { rules: "nope" }))).toEqual({ ok: false, error: "BAD_FILE" });
    expect(parseRulesFile("[]")).toEqual({ ok: false, error: "BAD_FILE" });
  });

  it("refuses more than 2000 rules", () => {
    const rules = Array.from({ length: RULES_FILE_MAX_RULES + 1 }, () => rule());
    expect(parseRulesFile(file(rules))).toEqual({ ok: false, error: "TOO_MANY" });
    expect(parseRulesFile(file(rules.slice(1)))).toMatchObject({ ok: true });
  });

  it("rejects a rule with an invalid regex but keeps the others", () => {
    const res = parseRulesFile(
      file([rule(), rule({ pattern: "(unclosed", matchType: "REGEX" }), rule({ pattern: "ok" })]),
    );
    expect(res).toMatchObject({
      ok: true,
      rejected: [{ index: 1, pattern: "(unclosed", reason: "INVALID_REGEX" }],
    });
    if (res.ok) expect(res.rules.map((r) => r.pattern)).toEqual(["CARREFOUR", "ok"]);
  });

  it("rejects depth 11, an empty path, a color outside the palette, priority 10001", () => {
    const deep = Array.from({ length: RULES_FILE_MAX_DEPTH + 1 }, (_, i) => ({ name: `L${i}` }));
    const res = parseRulesFile(
      file([
        rule({ category: deep }),
        rule({ category: [] }),
        rule({ category: [{ name: "Food", color: "not-a-color" }] }),
        rule({ priority: 10001 }),
        rule({ pattern: 42 }),
        rule({ category: Array.from({ length: RULES_FILE_MAX_DEPTH }, () => ({ name: "ok" })) }),
      ]),
    );
    expect(res).toMatchObject({
      ok: true,
      rejected: [
        { index: 0, pattern: "CARREFOUR", reason: "INVALID" },
        { index: 1, reason: "INVALID" },
        { index: 2, reason: "INVALID" },
        { index: 3, reason: "INVALID" },
        { index: 4, pattern: null, reason: "INVALID" },
      ],
    });
    if (res.ok) expect(res.rules).toHaveLength(1);
  });

  it("accepts only an integer priority, defaulting to 100", () => {
    const missing: Record<string, unknown> = rule();
    delete missing.priority;
    const res = parseRulesFile(
      file([
        rule({ priority: null }),
        rule({ priority: "" }),
        rule({ priority: true }),
        rule({ priority: "50" }),
        rule({ priority: 1.5 }),
        missing,
        rule({ priority: 0 }),
      ]),
    );
    expect(res).toMatchObject({
      ok: true,
      rejected: [0, 1, 2, 3, 4].map((index) => ({ index, reason: "INVALID" })),
    });
    if (res.ok) expect(res.rules.map((r) => r.priority)).toEqual([100, 0]);
  });

  it("strips unknown fields and defaults enabled to true", () => {
    const bare: Record<string, unknown> = rule({
      id: "x",
      hits: 9,
      category: [{ name: "Food", color: "#ff0000", extra: 1 }],
    });
    delete bare.enabled;
    const res = parseRulesFile(file([bare]));
    expect(res).toEqual({
      ok: true,
      rejected: [],
      rules: [
        {
          pattern: "CARREFOUR",
          matchType: "CONTAINS",
          caseSensitive: false,
          priority: 100,
          enabled: true,
          category: [{ name: "Food", color: "#ff0000" }],
        },
      ],
    });
  });
});
