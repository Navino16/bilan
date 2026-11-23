import { db } from "@/server/db";
import { invalidateAuthCache } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";

/** Captures an AppSetting row; `restore` puts it back as it was (or deletes it) without auditing. */
export async function snapshotSetting(key: string) {
  const prior = await db.appSetting.findUnique({ where: { key } });
  return async function restore() {
    if (prior) {
      await db.appSetting.update({
        where: { key },
        data: { value: prior.value ?? undefined, updatedById: prior.updatedById },
      });
    } else {
      await db.appSetting.deleteMany({ where: { key } });
    }
    appSettings.forget(key);
    invalidateAuthCache();
  };
}
