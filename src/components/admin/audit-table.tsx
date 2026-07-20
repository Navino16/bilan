import { getTranslations } from "next-intl/server";
import type { AuditLog } from "@prisma/client";

export async function AuditTable({
  items,
  total,
  locale,
}: {
  items: AuditLog[];
  total: number;
  locale: string;
}) {
  const t = await getTranslations("admin.audit");
  const dateFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC",
  });

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">{t("count", { total })}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">{t("colDate")}</th>
              <th className="px-3 py-2 font-medium">{t("colAction")}</th>
              <th className="px-3 py-2 font-medium">{t("colEntity")}</th>
              <th className="px-3 py-2 font-medium">{t("colUser")}</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {items.map((row) => (
              <tr key={row.id} data-slot="audit-row">
                <td className="text-muted-foreground px-3 py-2 whitespace-nowrap tabular-nums">
                  {dateFmt.format(row.createdAt)}
                </td>
                <td className="px-3 py-2 font-medium">{row.action}</td>
                <td className="text-muted-foreground px-3 py-2">
                  {row.entity ? `${row.entity}${row.entityId ? ` · ${row.entityId}` : ""}` : "—"}
                </td>
                <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                  {row.userId ?? t("system")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
