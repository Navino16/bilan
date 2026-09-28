import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

// A user can hold several roles; only the most privileged one is shown.
const RANK = ["SUPER_ADMIN", "ADMIN"] as const;

export async function RoleBadge({ roles }: { roles: string[] }) {
  const t = await getTranslations("admin.roles");
  const top = RANK.find((r) => roles.includes(r));
  if (top === "SUPER_ADMIN") return <Badge>{t("SUPER_ADMIN")}</Badge>;
  if (top === "ADMIN") return <Badge variant="secondary">{t("ADMIN")}</Badge>;
  return <Badge variant="outline">{t("USER")}</Badge>;
}
