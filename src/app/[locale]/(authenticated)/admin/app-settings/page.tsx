import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { appSettings } from "@/server/services/settings/app-settings";
import { AppSettingsForm } from "@/components/admin/app-settings-form";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("adminAppSettings");

export default async function AdminAppSettingsPage() {
  const user = await requirePermission("admin.settings.write");

  const [appName, mode, credentials, minPw, admin2fa, canEditSecurity] = await Promise.all([
    appSettings.get<string>("app_name"),
    appSettings.get<string>("registration_mode"),
    appSettings.get<boolean>("credentials_enabled"),
    appSettings.get<number>("min_password_length"),
    appSettings.get<boolean>("security.admin_2fa_required"),
    hasPermission(user.id, "admin.security.write"),
  ]);

  return (
    <AppSettingsForm
      appName={appName ?? "Bilan"}
      registrationMode={mode ?? "INVITE_ONLY"}
      credentialsEnabled={credentials ?? true}
      minPasswordLength={minPw ?? 12}
      admin2faRequired={admin2fa ?? false}
      canEditSecurity={canEditSecurity}
    />
  );
}
