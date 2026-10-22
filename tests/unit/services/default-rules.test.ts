import { describe, it, expect } from "vitest";
import { DEFAULT_CATEGORY_SETS, DEFAULT_RULES } from "@/server/services/categories/default-sets";
import { ruleInputSchema } from "@/lib/schemas/rule";
import { isValidRulePattern } from "@/server/services/categorization/regex";
import { pickPrepared, prepareLabel, prepareRules } from "@/server/services/categorization/match";

const keysOf = (locale: "fr" | "en") =>
  DEFAULT_CATEGORY_SETS[locale].flatMap((p) => [
    p.key,
    ...p.children.map((c) => `${p.key}.${c.key}`),
  ]);

const prepared = prepareRules(
  DEFAULT_RULES.map((r, i) => ({
    id: String(i).padStart(4, "0"),
    categoryId: r.category,
    pattern: r.pattern,
    matchType: r.matchType ?? "CONTAINS",
    caseSensitive: false,
    priority: r.priority ?? 100,
  })),
);
const categoryOf = (label: string) =>
  pickPrepared(prepared, prepareLabel(label))?.categoryId ?? null;

describe("default categorization rules", () => {
  it("uses the same category keys in both locales", () => {
    expect(keysOf("en")).toEqual(keysOf("fr"));
    expect(new Set(keysOf("fr")).size).toBe(keysOf("fr").length);
  });

  it("points every rule at an existing category and passes rule validation", () => {
    const keys = new Set(keysOf("fr"));
    for (const r of DEFAULT_RULES) {
      expect(keys.has(r.category), r.category).toBe(true);
      const parsed = ruleInputSchema.safeParse({
        pattern: r.pattern,
        matchType: r.matchType ?? "CONTAINS",
        priority: r.priority,
        categoryId: "x",
      });
      expect(parsed.success, r.pattern).toBe(true);
      if (r.matchType === "REGEX") expect(isValidRulePattern(r.pattern), r.pattern).toBe(true);
    }
  });

  it("has no duplicate pattern", () => {
    const patterns = DEFAULT_RULES.map((r) => `${r.matchType ?? "CONTAINS"}:${r.pattern}`);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it.each([
    ["CB INTERMARCHE 12/04/26", "food.groceries"],
    ["CB UEP*SUPER U ANCE 12/04/26", "food.groceries"],
    ["CB BOULANGERIE DU PORT 12/04/26", "food.groceries"],
    ["CB MCDONALDS 626 12/04/26", "food.restaurants"],
    ["CB UBER *EATS 12/04/26", "food.restaurants"],
    ["CB UBER *TRIP 12/04/26", "transport.transit"],
    ["PRLV SEPA SNCF VOYAGEURS - TER", "transport.transit"],
    ["CB GOOGLE YOUTUBEPR 12/04/26", "leisure.subscriptions"],
    ["CB AMAZON PRIME FR 12/04/26", "leisure.subscriptions"],
    ["CB AMAZON PAYMENTS 12/04/26", "shopping"],
    ["CB BOULANGER.COM 12/04/26", "shopping.home"],
    ["PRLV SEPA TOTALENERGIES ELECTRICITE", "housing.energy"],
    ["CB TOTALENERGIES 1234 12/04/26", "transport.fuel"],
    ["CB STATION VOIRIE 12/04/26", "transport.tolls"],
    ["VIR.PERMANENT LIVRET A", "savings.accounts"],
    ["COTISATION MENSUELLE CARTE 1234", "bank.fees"],
    ["CB PHARMA BEAULIEU 12/04/26", "health.pharmacy"],
    ["CB DR MARTIN 12/04/26", "health.doctor"],
    ["VIREMENT DGFIP FINANCES PUBLIQU", "taxes.taxes"],
    ["PRLV SEPA IMPÔTS", "taxes.taxes"],
    ["PRLV SEPA COTISATION MUTUELLE", "health.insurance"],
    ["CB DR MARTENS 12/04/26", "shopping.clothes"],
    ["CB PATHÉ 12/04/26", "leisure.outings"],
    ["CB PICARD SURGELES 12/04/26", "food.groceries"],
  ])("files %s under %s", (label, key) => {
    expect(categoryOf(label)).toBe(key);
  });

  it.each([
    "CB LA FRAISERAIE C 12/04/26",
    "CB CAFE DE LA GARE 12/04/26",
    "CB TERRE DE SIENNE 12/04/26",
    "CB ALANDRA 12/04/26",
    "VIREMENT M JEAN DUPONT",
    "VIR SEPA M ALAN PICARD",
    "VIREMENT MME ZARA BOULANGER",
    "REMBT NOTE DE FRAIS",
    "CB LOCO TACOS 12/04/26",
  ])("leaves %s uncategorized", (label) => {
    expect(categoryOf(label)).toBeNull();
  });
});
