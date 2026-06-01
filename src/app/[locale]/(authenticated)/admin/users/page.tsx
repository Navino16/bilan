import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";
import { CreateUserForm } from "@/components/admin/create-user-form";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requirePermission("admin.users.read");
  const t = await getTranslations("admin.users");
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { roles: { include: { role: true } } },
  });

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t("createTitle")}</h2>
        <CreateUserForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("listTitle")}</h2>
        <div className="border-border divide-border divide-y rounded-lg border">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{u.name ?? u.email}</div>
                <div className="text-muted-foreground">{u.email}</div>
              </div>
              <div className="text-muted-foreground text-xs">
                {u.roles.map((r) => r.role.key).join(", ") || "—"}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="text-muted-foreground px-4 py-3 text-sm">{t("empty")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
