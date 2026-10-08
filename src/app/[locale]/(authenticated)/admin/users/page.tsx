import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { listUsersForAdmin } from "@/server/services/users/admin-list";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { RoleBadge } from "@/components/admin/role-badge";
import { RoleSelect } from "@/components/admin/role-select";
import { StatusBadge } from "@/components/admin/status-badge";
import { UserActions } from "@/components/admin/user-actions";
import { topRole } from "@/lib/instance-roles";
import { displayName } from "@/lib/validation/name";
import { parsePage } from "@/lib/pagination";
import { SectionCard, listHeader } from "@/components/shell/section-card";
import { Pager } from "@/components/shell/pager";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

const cols = "md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_140px_32px]";

export const generateMetadata = pageTitle("adminUsers");

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale } = await params;
  const viewer = await requirePermission("admin.users.read");
  const [canUpdate, canDisable, canDelete] = await Promise.all([
    hasPermission(viewer.id, "admin.users.update"),
    hasPermission(viewer.id, "admin.users.disable"),
    // Super admins only; doubles as "may act on admins" (enforced in users/lifecycle.ts).
    hasPermission(viewer.id, "admin.users.delete"),
  ]);
  const t = await getTranslations("admin.users");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const {
    items: users,
    total,
    page,
    pageCount,
  } = await listUsersForAdmin({
    q,
    page: parsePage(sp.page),
  });
  const pathname = `/${locale}/admin/users`;

  return (
    <div className="space-y-6">
      <SectionCard overline={t("createOverline")} title={t("createTitle")} hint={t("createHint")}>
        <CreateUserForm />
      </SectionCard>

      <SectionCard
        flush
        overline={t("listOverline")}
        title={t("listTitle")}
        hint={q ? t("matchCount", { count: total }) : t("count", { count: total })}
      >
        <form
          method="get"
          role="search"
          className="flex flex-wrap items-center gap-2 border-b px-6 py-3"
        >
          <Input
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="max-w-sm min-w-0 flex-1"
          />
          <Button type="submit" variant="outline">
            {t("search")}
          </Button>
          {q && (
            <Link href={pathname} className={buttonVariants({ variant: "ghost" })}>
              {t("clearSearch")}
            </Link>
          )}
        </form>
        {users.length > 0 && (
          <div className={`${listHeader} hidden gap-3 md:grid ${cols}`}>
            <span>{t("name")}</span>
            <span>{t("email")}</span>
            <span>{t("role")}</span>
            <span />
          </div>
        )}
        {users.map((u) => (
          <div
            key={u.id}
            data-slot="admin-user-row"
            className={`flex items-center justify-between gap-3 border-b px-6 py-3 text-sm last:border-b-0 md:grid ${cols}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{displayName(u)}</span>
                {u.disabled && <StatusBadge active={false}>{t("disabledBadge")}</StatusBadge>}
              </div>
              <div className="text-muted-foreground truncate text-xs md:hidden">{u.email}</div>
            </div>
            <div className="text-muted-foreground hidden truncate md:block">{u.email}</div>
            <div className="flex items-center justify-end gap-1 md:contents">
              {canUpdate && u.id !== viewer.id ? (
                <RoleSelect userId={u.id} role={topRole(u.roleKeys)} userLabel={displayName(u)} />
              ) : (
                <RoleBadge roles={u.roleKeys} />
              )}
              {(() => {
                const self = u.id === viewer.id;
                const outranked = topRole(u.roleKeys) !== "USER" && !canDelete;
                const disable = canDisable && !self && !outranked;
                const remove = canDelete && !self;
                return disable || remove ? (
                  <UserActions
                    userId={u.id}
                    email={u.email}
                    label={displayName(u)}
                    disabled={u.disabled}
                    canDisable={disable}
                    canDelete={remove}
                  />
                ) : (
                  <span />
                );
              })()}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-muted-foreground px-6 py-5 text-sm">{q ? t("noMatch") : t("empty")}</p>
        )}
        <Pager page={page} pageCount={pageCount} pathname={pathname} query={{ q }} />
      </SectionCard>
    </div>
  );
}
