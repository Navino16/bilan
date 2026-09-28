import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { RoleBadge } from "@/components/admin/role-badge";
import { SectionCard, listHeader } from "@/components/shell/section-card";

export const dynamic = "force-dynamic";

const cols = "md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px]";

export default async function AdminUsersPage() {
  await requirePermission("admin.users.read");
  const t = await getTranslations("admin.users");
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { roles: { include: { role: true } } },
  });

  return (
    <div className="space-y-6">
      <SectionCard overline={t("createOverline")} title={t("createTitle")} hint={t("createHint")}>
        <CreateUserForm />
      </SectionCard>

      <SectionCard
        flush
        overline={t("listOverline")}
        title={t("listTitle")}
        hint={t("count", { count: users.length })}
      >
        {users.length > 0 && (
          <div className={`${listHeader} hidden gap-3 md:grid ${cols}`}>
            <span>{t("name")}</span>
            <span>{t("email")}</span>
            <span>{t("role")}</span>
          </div>
        )}
        {users.map((u) => (
          <div
            key={u.id}
            data-slot="admin-user-row"
            className={`flex items-center justify-between gap-3 border-b px-6 py-3 text-sm last:border-b-0 md:grid ${cols}`}
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{u.name ?? u.email}</div>
              <div className="text-muted-foreground truncate text-xs md:hidden">{u.email}</div>
            </div>
            <div className="text-muted-foreground hidden truncate md:block">{u.email}</div>
            <RoleBadge roles={u.roles.map((r) => r.role.key)} />
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-muted-foreground px-6 py-5 text-sm">{t("empty")}</p>
        )}
      </SectionCard>
    </div>
  );
}
