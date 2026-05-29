import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";

type Entry = { value: unknown; expiresAt: number };

export class AppSettingsService {
  private cache = new Map<string, Entry>();

  constructor(
    private db: PrismaClient,
    private opts: { ttlMs: number } = { ttlMs: 60_000 },
  ) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value as T;

    const row = await this.db.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    this.cache.set(key, { value: row.value, expiresAt: now + this.opts.ttlMs });
    return row.value as T;
  }

  async set(key: string, value: unknown, updatedById: string): Promise<void> {
    await this.db.appSetting.upsert({
      where: { key },
      create: { key, value: value as never, updatedById },
      update: { value: value as never, updatedById },
    });
    this.cache.delete(key);
  }
}

export const appSettings = new AppSettingsService(db);
