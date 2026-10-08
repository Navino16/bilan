import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listAuditLog } from "@/server/services/audit";
import { AuditTable, auditLabels } from "@/components/admin/audit-table";
import { SectionCard } from "@/components/shell/section-card";
import { Pager } from "@/components/shell/pager";
import { TimeZoneField } from "@/components/shell/time-zone-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AUDIT_ENTITIES, AUDIT_FAMILIES } from "@/lib/audit";
import { parsePage } from "@/lib/pagination";
import { parseDayBounds } from "@/lib/period";
import { isValidTimeZone, nextIsoDay, zonedDayStart } from "@/lib/time-zone";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

type Search = {
  action?: string;
  entity?: string;
  user?: string;
  from?: string;
  to?: string;
  tz?: string;
  page?: string;
};

export const generateMetadata = pageTitle("adminAudit");

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  await requirePermission("admin.audit.read");
  const t = await getTranslations("admin.audit");
  const sp = await searchParams;

  const action = sp.action?.trim() || undefined;
  const entity = sp.entity?.trim() || undefined;
  const user = sp.user?.trim() || undefined;
  const days = parseDayBounds({ from: sp.from, to: sp.to });
  const tz = isValidTimeZone(sp.tz) ? sp.tz : "UTC";

  const { items, total, page, pageCount } = await listAuditLog({
    action,
    entity,
    user,
    from: days.from ? zonedDayStart(days.from, tz) : undefined,
    to: days.to ? zonedDayStart(nextIsoDay(days.to), tz) : undefined,
    page: parsePage(sp.page),
  });

  const pathname = `/${locale}/admin/audit`;
  const filtered = Boolean(action || entity || user || days.from || days.to);
  const { action: actionLabel } = await auditLabels();
  const familyOptions: string[] = [...AUDIT_FAMILIES];
  const entityOptions: string[] = [...AUDIT_ENTITIES];

  return (
    <SectionCard flush overline={t("overline")} title={t("title")} hint={t("count", { total })}>
      <form
        method="get"
        className="grid gap-3 border-b px-6 py-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]"
      >
        <TimeZoneField />
        <div className="space-y-1.5">
          <Label htmlFor="f-action">{t("colAction")}</Label>
          <NativeSelect id="f-action" name="action" defaultValue={action ?? ""} className="w-full">
            <option value="">{t("all")}</option>
            {familyOptions.map((f) => (
              <option key={f} value={f}>
                {t(`families.${f}`)}
              </option>
            ))}
            {action && !familyOptions.includes(action) && (
              <option value={action}>{actionLabel(action)}</option>
            )}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-entity">{t("colEntity")}</Label>
          <NativeSelect id="f-entity" name="entity" defaultValue={entity ?? ""} className="w-full">
            <option value="">{t("all")}</option>
            {entityOptions.map((e) => (
              <option key={e} value={e}>
                {t(`entities.${e}`)}
              </option>
            ))}
            {entity && !entityOptions.includes(entity) && <option value={entity}>{entity}</option>}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-user">{t("colUser")}</Label>
          <Input
            id="f-user"
            name="user"
            type="search"
            defaultValue={user ?? ""}
            placeholder={t("userPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-from">{t("from")}</Label>
          <Input id="f-from" name="from" type="date" defaultValue={days.from ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-to">{t("to")}</Label>
          <Input id="f-to" name="to" type="date" defaultValue={days.to ?? ""} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline">
            {t("filter")}
          </Button>
          {filtered && (
            <Link href={pathname} className={buttonVariants({ variant: "ghost" })}>
              {t("reset")}
            </Link>
          )}
        </div>
      </form>

      <AuditTable items={items} />
      <Pager
        page={page}
        pageCount={pageCount}
        pathname={pathname}
        query={{ action, entity, user, from: days.from, to: days.to, tz: sp.tz }}
      />
    </SectionCard>
  );
}
