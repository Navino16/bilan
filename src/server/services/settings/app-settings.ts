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
const AUTH_KEYS = new Set(["registration_mode", "credentials_enabled", "min_password_length"]);

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
    await this.db.appSetting.upsert({
      where: { key },
      create: { key, value: value as never, updatedById },
      update: { value: value as never, updatedById },
    });
    this.cache.delete(key);

    // Auth-affecting keys must hot-reload the Better Auth handler.
    if (AUTH_KEYS.has(key)) await this.opts.onAuthKeyChange?.();

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
