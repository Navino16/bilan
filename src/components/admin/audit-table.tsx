import { getTranslations } from "next-intl/server";
import type { AuditLog } from "@prisma/client";
import { listHeader } from "@/components/shell/section-card";

export async function AuditTable({ items, locale }: { items: AuditLog[]; locale: string }) {
  const t = await getTranslations("admin.audit");
  const dateFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC",
  });

  if (items.length === 0) {
    return <p className="text-muted-foreground px-6 py-5 text-sm">{t("empty")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={`${listHeader} text-left`}>
          <tr>
            <th className="py-2.5 pr-3 pl-6 font-medium">{t("colDate")}</th>
            <th className="px-3 py-2.5 font-medium">{t("colAction")}</th>
            <th className="px-3 py-2.5 font-medium">{t("colEntity")}</th>
            <th className="py-2.5 pr-6 pl-3 font-medium">{t("colUser")}</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {items.map((row) => (
            <tr key={row.id} data-slot="audit-row">
              <td className="text-muted-foreground py-2.5 pr-3 pl-6 whitespace-nowrap tabular-nums">
                {dateFmt.format(row.createdAt)}
              </td>
              <td className="px-3 py-2.5 font-medium">{row.action}</td>
              <td className="text-muted-foreground px-3 py-2.5 break-all">
                {row.entity ? `${row.entity}${row.entityId ? ` · ${row.entityId}` : ""}` : "—"}
              </td>
              <td
                className="text-muted-foreground max-w-40 truncate py-2.5 pr-6 pl-3"
                title={row.userId ?? undefined}
              >
                {row.userId ?? t("system")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
