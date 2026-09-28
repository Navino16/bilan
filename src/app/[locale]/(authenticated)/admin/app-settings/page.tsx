import { requirePermission } from "@/server/auth/permissions";
import { appSettings } from "@/server/services/settings/app-settings";
import { AppSettingsForm } from "@/components/admin/app-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminAppSettingsPage() {
  await requirePermission("admin.settings.write");

  const [appName, mode, credentials, minPw, admin2fa] = await Promise.all([
    appSettings.get<string>("app_name"),
    appSettings.get<string>("registration_mode"),
    appSettings.get<boolean>("credentials_enabled"),
    appSettings.get<number>("min_password_length"),
    appSettings.get<boolean>("security.admin_2fa_required"),
  ]);

  return (
    <AppSettingsForm
      appName={appName ?? "Bilan"}
      registrationMode={mode ?? "INVITE_ONLY"}
      credentialsEnabled={credentials ?? true}
      minPasswordLength={minPw ?? 12}
      admin2faRequired={admin2fa ?? false}
    />
  );
}
