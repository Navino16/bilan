"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { GroupRole } from "@/lib/validation/group";

type GroupListItem = {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
  memberCount: number;
};

export function GroupList({ groups }: { groups: GroupListItem[] }) {
  const t = useTranslations("groups");
  const locale = useLocale();

  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <Card key={g.id} className="p-0">
          <Link
            href={`/${locale}/groups/${g.id}`}
            className="hover:bg-muted/40 flex h-full items-center gap-3 rounded-xl p-4 transition-colors"
          >
            <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Users className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 truncate font-medium" title={g.name}>
                  {g.name}
                </span>
                <Badge variant="outline">{t(`roles.${g.role}`)}</Badge>
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {g.description || t("memberCount", { count: g.memberCount })}
              </div>
            </div>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </Link>
        </Card>
      ))}
    </div>
  );
}
