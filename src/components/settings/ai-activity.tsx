import { getLocale, getTranslations } from "next-intl/server";
import { auditLabels } from "@/components/admin/audit-table";
import { SectionCard } from "@/components/shell/section-card";
import { ActivityTimeline } from "@/components/settings/ai-activity-timeline";
import type { McpActivityRow } from "@/server/mcp/activity";

export async function AiActivity({ rows }: { rows: McpActivityRow[] }) {
  const [t, labels, locale] = await Promise.all([
    getTranslations("settings.ai.activity"),
    auditLabels(),
    getLocale(),
  ]);
  return (
    <SectionCard flush title={t("title")} hint={t("hint")}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm sm:px-6" data-slot="mcp-activity-empty">
          {t("none")}
        </p>
      ) : (
        <ActivityTimeline
          entries={rows.map((row) => ({
            id: row.id,
            at: row.at,
            action: labels.action(row.action),
            clientName: row.clientName,
            target: row.target && {
              text: row.target.text,
              href: row.target.href && `/${locale}${row.target.href}`,
            },
          }))}
          today={t("today")}
          yesterday={t("yesterday")}
        />
      )}
    </SectionCard>
  );
}
