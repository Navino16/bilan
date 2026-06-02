import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listGroupsForUser } from "@/server/services/groups";
import { GroupList } from "@/components/groups/group-list";
import { GroupForm } from "@/components/groups/group-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function GroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("groups");
  const groups = await listGroupsForUser(user.id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <GroupForm
          mode="create"
          trigger={
            <Button>
              <Plus />
              {t("create")}
            </Button>
          }
        />
      </header>
      <GroupList groups={groups} />
    </div>
  );
}
