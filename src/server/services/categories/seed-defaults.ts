import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DEFAULT_CATEGORY_SETS, DEFAULT_RULES } from "./default-sets";

// Copies the locale's default category set into rows owned by `userId`
// (isDefault = true), then the default rules pointing at them. No-op if the
// user already has any category, so it is safe to call on every signup.
export async function seedDefaultCategories(
  userId: string,
  locale: "fr" | "en",
  db: PrismaClient = defaultDb,
): Promise<void> {
  const existing = await db.category.count({ where: { userId } });
  if (existing > 0) return;
  const set = DEFAULT_CATEGORY_SETS[locale] ?? DEFAULT_CATEGORY_SETS.fr;
  const ids = new Map<string, string>();
  for (const parent of set) {
    const created = await db.category.create({
      data: {
        name: parent.name,
        icon: parent.icon ?? null,
        color: parent.color ?? null,
        savings: parent.savings ?? false,
        userId,
        isDefault: true,
      },
    });
    ids.set(parent.key, created.id);
    for (const child of parent.children) {
      const { id } = await db.category.create({
        data: { name: child.name, parentId: created.id, userId, isDefault: true },
      });
      ids.set(`${parent.key}.${child.key}`, id);
    }
  }
  await db.categorizationRule.createMany({
    data: DEFAULT_RULES.map((r) => {
      const categoryId = ids.get(r.category);
      if (!categoryId) throw new Error(`Default rule ${r.pattern}: unknown category ${r.category}`);
      return {
        pattern: r.pattern,
        matchType: r.matchType ?? "CONTAINS",
        priority: r.priority ?? 100,
        categoryId,
        userId,
      };
    }),
  });
}
