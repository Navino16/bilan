import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listGroupsForUser } from "@/server/services/groups";
import { pendingInvitationsForEmail } from "@/server/services/groups/invitations";
import { GroupList } from "@/components/groups/group-list";
import { GroupForm } from "@/components/groups/group-form";
import { JoinByCode } from "@/components/groups/join-by-code";
import { PendingInvitations } from "@/components/groups/pending-invitations";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { SectionCard } from "@/components/shell/section-card";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("groups");

export default async function GroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("groups");
  const ti = await getTranslations("invitations");
  const groups = await listGroupsForUser(user.id);
  const pending = (await pendingInvitationsForEmail(user.email)).map((inv) => ({
    token: inv.token,
    groupName: inv.group.name,
    role: inv.role,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        overline={t("overline")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <GroupForm
            mode="create"
            trigger={
              <Button>
                <Plus />
                {t("create")}
              </Button>
            }
          />
        }
      />
      <PendingInvitations invitations={pending} />
      <GroupList groups={groups} />
      <SectionCard overline={ti("joinOverline")} title={ti("joinByCode")}>
        <JoinByCode />
      </SectionCard>
    </div>
  );
}
