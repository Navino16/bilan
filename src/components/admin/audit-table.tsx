import { getTranslations } from "next-intl/server";
import type { AuditEntry } from "@/server/services/audit";
import { listHeader } from "@/components/shell/section-card";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { auditActionMessage } from "@/lib/audit";
import { displayName } from "@/lib/validation/name";

// Translated labels with the raw code as fallback. `t.has` is also true for a branch
// of the message tree (`group.member`), hence the string check.
export async function auditLabels() {
  const t = await getTranslations("admin.audit");
  const label = (key: string, fallback: string, values?: Record<string, string>) =>
    t.has(key) && typeof t.raw(key) === "string" ? t(key, values) : fallback;
  return {
    action: (code: string) => {
      const msg = auditActionMessage(code);
      return label(`actions.${msg.key}`, code, msg.values);
    },
    entity: (entity: string) => label(`entities.${entity}`, entity),
  };
}

export async function AuditTable({ items }: { items: AuditEntry[] }) {
  const t = await getTranslations("admin.audit");

  if (items.length === 0) {
    return <p className="text-muted-foreground px-4 py-5 text-sm sm:px-6">{t("empty")}</p>;
  }

  const labels = await auditLabels();
  const action = labels.action;
  const entityType = labels.entity;
  const entityDetail = (row: AuditEntry) => (row.subject ? displayName(row.subject) : row.entityId);
  const user = (row: AuditEntry) =>
    row.user ? displayName(row.user) : (row.userId ?? t("system"));
  const date = (row: AuditEntry) => <LocalDateTime value={row.createdAt} seconds />;
  const entity = (row: AuditEntry) =>
    row.entity ? (
      <>
        <span>{entityType(row.entity)}</span>
        {entityDetail(row) && (
          <span
            className="block truncate font-mono text-[0.7rem]"
            title={row.entityId ?? undefined}
          >
            {entityDetail(row)}
          </span>
        )}
      </>
    ) : (
      "—"
    );

  return (
    <>
      <ul className="divide-border divide-y md:hidden">
        {items.map((row) => (
          <li key={row.id} data-slot="audit-item" className="space-y-0.5 px-4 py-3 text-sm sm:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium break-words" title={row.action}>
                {action(row.action)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {date(row)}
              </span>
            </div>
            <div className="text-muted-foreground min-w-0 text-xs">{entity(row)}</div>
            <p className="text-muted-foreground truncate text-xs" title={row.user?.email}>
              {user(row)}
            </p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full table-fixed text-sm md:table">
        <thead className={`${listHeader} text-left`}>
          <tr>
            <th className="w-44 py-2.5 pr-3 pl-6 font-medium">{t("colDate")}</th>
            <th className="px-3 py-2.5 font-medium">{t("colAction")}</th>
            <th className="w-[28%] px-3 py-2.5 font-medium">{t("colEntity")}</th>
            <th className="w-[22%] py-2.5 pr-6 pl-3 font-medium">{t("colUser")}</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {items.map((row) => (
            <tr key={row.id} data-slot="audit-row">
              <td className="text-muted-foreground py-2.5 pr-3 pl-6 whitespace-nowrap tabular-nums">
                {date(row)}
              </td>
              <td className="px-3 py-2.5 font-medium break-words" title={row.action}>
                {action(row.action)}
              </td>
              <td className="text-muted-foreground min-w-0 px-3 py-2.5">{entity(row)}</td>
              <td
                className="text-muted-foreground truncate py-2.5 pr-6 pl-3"
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
