import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { topRole } from "@/lib/instance-roles";

export async function RoleBadge({ roles }: { roles: string[] }) {
  const t = await getTranslations("admin.roles");
  const top = topRole(roles);
  if (top === "SUPER_ADMIN") return <Badge>{t("SUPER_ADMIN")}</Badge>;
  if (top === "ADMIN") return <Badge variant="secondary">{t("ADMIN")}</Badge>;
  return <Badge variant="outline">{t("USER")}</Badge>;
}
