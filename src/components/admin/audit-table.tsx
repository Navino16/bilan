import { getTranslations } from "next-intl/server";
import type { AuditEntry } from "@/server/services/audit";
import { listHeader } from "@/components/shell/section-card";

export async function AuditTable({ items, locale }: { items: AuditEntry[]; locale: string }) {
  const t = await getTranslations("admin.audit");
  const dateFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC",
  });

  if (items.length === 0) {
    return <p className="text-muted-foreground px-6 py-5 text-sm">{t("empty")}</p>;
  }

  const entity = (row: AuditEntry) =>
    row.entity ? `${row.entity}${row.entityId ? ` · ${row.entityId}` : ""}` : "—";
  const user = (row: AuditEntry) =>
    row.user ? (row.user.name ?? row.user.email) : (row.userId ?? t("system"));

  return (
    <>
      <ul className="divide-border divide-y md:hidden">
        {items.map((row) => (
          <li key={row.id} data-slot="audit-item" className="space-y-0.5 px-6 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium break-words">{row.action}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {dateFmt.format(row.createdAt)}
              </span>
            </div>
            <p className="text-muted-foreground truncate text-xs">{entity(row)}</p>
            <p className="text-muted-foreground truncate text-xs" title={row.user?.email}>
              {user(row)}
            </p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
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
              <td className="text-muted-foreground px-3 py-2.5 break-all">{entity(row)}</td>
              <td
                className="text-muted-foreground max-w-48 truncate py-2.5 pr-6 pl-3"
                title={row.user?.email ?? row.userId ?? undefined}
              >
                {user(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
