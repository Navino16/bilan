import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";

type Entry = { value: unknown; expiresAt: number };

type AuditFn = (input: {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

// App-setting keys that feed the Better Auth config (built in `buildOptions`):
// changing one must hot-reload the auth handler so it takes effect without a
// restart. See `[[project_dev-e2e-ops]]` (restart no longer needed for these).
const AUTH_KEYS = new Set([
  "registration_mode",
  "credentials_enabled",
  "min_password_length",
  "app_name",
]);

const DEFAULT_APP_NAME = "Bilan";

export function normalizeAppName(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_APP_NAME;
}

export class AppSettingsService {
  private cache = new Map<string, Entry>();
  private ttlMs: number;

  constructor(
    private db: PrismaClient,
    private opts: {
      ttlMs?: number;
      /** Side-effects wired by the singleton; left undefined in unit tests. */
      audit?: AuditFn;
      onAuthKeyChange?: () => void | Promise<void>;
    } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 60_000;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value as T;

    const row = await this.db.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    this.cache.set(key, { value: row.value, expiresAt: now + this.ttlMs });
    return row.value as T;
  }

  async set(key: string, value: unknown, updatedById: string): Promise<void> {
    await this.write(key, value, updatedById);
    // Auth-affecting keys must hot-reload the Better Auth handler.
    if (AUTH_KEYS.has(key)) await this.opts.onAuthKeyChange?.();
  }

  // Writes only the values that differ from the stored ones (read past the cache, which
  // may be stale), so the audit log records real changes; auth reloads once at most.
  async setMany(entries: [string, unknown][], updatedById: string): Promise<string[]> {
    const changed: string[] = [];
    for (const [key, value] of entries) {
      const row = await this.db.appSetting.findUnique({ where: { key } });
      if (row && JSON.stringify(row.value) === JSON.stringify(value)) continue;
      await this.write(key, value, updatedById);
      changed.push(key);
    }
    if (changed.some((k) => AUTH_KEYS.has(k))) await this.opts.onAuthKeyChange?.();
    return changed;
  }

  private async write(key: string, value: unknown, updatedById: string): Promise<void> {
    await this.db.appSetting.upsert({
      where: { key },
      create: { key, value: value as never, updatedById },
      update: { value: value as never, updatedById },
    });
    this.cache.delete(key);
    await this.opts.audit?.({
      userId: updatedById,
      action: `settings.${key}.update`,
      entity: "AppSetting",
      entityId: key,
      metadata: { value },
    });
  }
}

export const appSettings = new AppSettingsService(db, {
  audit: logEvent,
  // Lazy import breaks the app-settings ↔ auth import cycle (auth imports this
  // module); the handler is only invalidated at call time, never at module load.
  onAuthKeyChange: async () => {
    const { invalidateAuthCache } = await import("@/server/auth");
    invalidateAuthCache();
  },
});

export async function getAppName(): Promise<string> {
  return normalizeAppName(await appSettings.get("app_name"));
}
