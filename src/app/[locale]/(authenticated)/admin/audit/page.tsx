import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/permissions";
import { listAuditLog } from "@/server/services/audit";
import { AuditTable } from "@/components/admin/audit-table";
import { SectionCard } from "@/components/shell/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <SectionCard flush overline={t("overline")} title={t("title")} hint={t("count", { total })}>
      {/* Plain GET filter form → query string; no client JS needed. */}
      <form method="get" className="flex flex-wrap items-end gap-3 border-b px-6 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="f-action">{t("colAction")}</Label>
          <Input id="f-action" name="action" defaultValue={sp.action ?? ""} className="w-56" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-entity">{t("colEntity")}</Label>
          <Input id="f-entity" name="entity" defaultValue={sp.entity ?? ""} className="w-56" />
        </div>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>

      <AuditTable items={items} locale={locale} />
    </SectionCard>
  );
}
