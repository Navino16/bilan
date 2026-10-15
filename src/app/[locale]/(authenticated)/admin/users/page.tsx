import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { listUsersForAdmin } from "@/server/services/users/admin-list";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { RoleBadge } from "@/components/admin/role-badge";
import { RoleSelect } from "@/components/admin/role-select";
import { StatusBadge } from "@/components/admin/status-badge";
import { UserActions } from "@/components/admin/user-actions";
import { creatableRoles, mayHandleRole, topRole } from "@/lib/instance-roles";
import { isActiveSuperAdmin } from "@/server/services/users/roles";
import { displayName } from "@/lib/validation/name";
import { parsePage } from "@/lib/pagination";
import { SectionCard, listHeader } from "@/components/shell/section-card";
import { Pager } from "@/components/shell/pager";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

const cols = "md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_170px_32px]";

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
  const [canUpdate, canDisable, canDelete, viewerIsSuperAdmin] = await Promise.all([
    hasPermission(viewer.id, "admin.users.update"),
    hasPermission(viewer.id, "admin.users.disable"),
    // Super admins only; doubles as "may act on admins" (enforced in users/lifecycle.ts).
    hasPermission(viewer.id, "admin.users.delete"),
    isActiveSuperAdmin(viewer.id),
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
        <CreateUserForm roles={creatableRoles(viewerIsSuperAdmin)} />
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
          className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6"
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
            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3 text-sm last:border-b-0 sm:px-6 md:grid md:gap-3 ${cols}`}
          >
            <div className="min-w-0 flex-auto">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="max-w-full truncate font-medium">{displayName(u)}</span>
                {u.disabled && <StatusBadge active={false}>{t("disabledBadge")}</StatusBadge>}
                {!u.emailVerified && (
                  <StatusBadge active={false}>{t("unverifiedBadge")}</StatusBadge>
                )}
              </div>
              <div className="text-muted-foreground truncate text-xs md:hidden">{u.email}</div>
            </div>
            <div className="text-muted-foreground hidden truncate md:block">{u.email}</div>
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1 md:contents">
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
                const verify =
                  canUpdate &&
                  !self &&
                  !u.emailVerified &&
                  mayHandleRole(viewerIsSuperAdmin, topRole(u.roleKeys));
                return disable || remove || verify ? (
                  <UserActions
                    userId={u.id}
                    email={u.email}
                    label={displayName(u)}
                    disabled={u.disabled}
                    canDisable={disable}
                    canDelete={remove}
                    canVerifyEmail={verify}
                  />
                ) : (
                  <span />
                );
              })()}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-muted-foreground px-4 py-5 text-sm sm:px-6">
            {q ? t("noMatch") : t("empty")}
          </p>
        )}
        <Pager page={page} pageCount={pageCount} pathname={pathname} query={{ q }} />
      </SectionCard>
    </div>
  );
}
