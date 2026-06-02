import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import categoriesFr from "../../../../prisma/seed-data/categories-fr.json";
import categoriesEn from "../../../../prisma/seed-data/categories-en.json";

type DefaultCategory = { name: string; icon?: string; color?: string; children: string[] };

const SETS: Record<"fr" | "en", DefaultCategory[]> = {
  fr: categoriesFr as DefaultCategory[],
  en: categoriesEn as DefaultCategory[],
};

// Copies the locale's default category set into rows owned by `userId`
// (isDefault = true). No-op if the user already has any category, so it is
// safe to call on every signup and never duplicates.
export async function seedDefaultCategories(
  userId: string,
  locale: "fr" | "en",
  db: PrismaClient = defaultDb,
): Promise<void> {
  const existing = await db.category.count({ where: { userId } });
  if (existing > 0) return;
  const set = SETS[locale] ?? SETS.fr;
  for (const parent of set) {
    const created = await db.category.create({
      data: {
        name: parent.name,
        icon: parent.icon ?? null,
        color: parent.color ?? null,
        userId,
        isDefault: true,
      },
    });
    for (const childName of parent.children) {
      await db.category.create({
        data: { name: childName, parentId: created.id, userId, isDefault: true },
      });
    }
  }
}
