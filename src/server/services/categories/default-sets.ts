import type { RuleMatchType } from "@/lib/validation/rule";
import categoriesFr from "../../../../prisma/seed-data/categories-fr.json";
import categoriesEn from "../../../../prisma/seed-data/categories-en.json";
import defaultRules from "../../../../prisma/seed-data/rules.json";

export type DefaultCategory = {
  key: string;
  name: string;
  icon?: string;
  color?: string;
  savings?: boolean;
  children: { key: string; name: string }[];
};

// `category` is a key path, "parent" or "parent.child", shared by both locales.
export type DefaultRule = {
  category: string;
  pattern: string;
  matchType?: RuleMatchType;
  priority?: number;
};

export const DEFAULT_CATEGORY_SETS: Record<"fr" | "en", DefaultCategory[]> = {
  fr: categoriesFr as DefaultCategory[],
  en: categoriesEn as DefaultCategory[],
};

export const DEFAULT_RULES = defaultRules as DefaultRule[];
