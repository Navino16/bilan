import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listAuditLog } from "@/server/services/audit";
import { AuditTable } from "@/components/admin/audit-table";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string; entity?: string }>;
}) {
  const { locale } = await params;
  await requirePermission("admin.audit.read");
  const t = await getTranslations("admin.audit");
  const sp = await searchParams;

  const { items, total } = await listAuditLog({
    action: sp.action || undefined,
    entity: sp.entity || undefined,
    take: 100,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">{t("title")}</h2>

      {/* Plain GET filter form → query string; no client JS needed. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="f-action" className="text-muted-foreground text-xs">
            {t("colAction")}
          </label>
          <input
            id="f-action"
            name="action"
            defaultValue={sp.action ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="f-entity" className="text-muted-foreground text-xs">
            {t("colEntity")}
          </label>
          <input
            id="f-entity"
            name="entity"
            defaultValue={sp.entity ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm font-medium"
        >
          {t("filter")}
        </button>
      </form>

      <AuditTable items={items} total={total} locale={locale} />
    </div>
  );
}
