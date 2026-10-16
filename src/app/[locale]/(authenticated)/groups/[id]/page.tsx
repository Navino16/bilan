import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { getGroupDetail, groupDeletionImpact, GroupAccessError } from "@/server/services/groups";
import { listInvitations } from "@/server/services/groups/invitations";
import { listAccountsSharedWithGroup } from "@/server/services/accounts/sharing";
import { GROUP_ROLE_RANK as RANK } from "@/lib/validation/group";
import { MemberList } from "@/components/groups/member-list";
import { GroupDangerZone } from "@/components/groups/group-danger-zone";
import { GroupForm } from "@/components/groups/group-form";
import { InviteForm } from "@/components/groups/invite-form";
import { InvitationsList } from "@/components/groups/invitations-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { SectionCard, listHeader } from "@/components/shell/section-card";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("group");

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("groups");

  let group;
  try {
    group = await getGroupDetail(id, user.id);
  } catch (e) {
    if (e instanceof GroupAccessError) notFound();
    throw e;
  }

  const viewerRole = group.members.find((m) => m.userId === user.id)?.role ?? "MEMBER";
  const canEdit = RANK[viewerRole] >= RANK.ADMIN;
  const isLastOwner =
    viewerRole === "OWNER" && group.members.filter((m) => m.role === "OWNER").length <= 1;

  const ta = await getTranslations("accounts");
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const sharedAccounts = await listAccountsSharedWithGroup(id, { id: user.id });

  const ti = await getTranslations("invitations");
  const pending = canEdit
    ? (await listInvitations(id, { id: user.id })).map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        code: inv.code,
        token: inv.token,
        expiresAt: inv.expiresAt.toISOString(),
      }))
    : [];
  const deletionImpact =
    viewerRole === "OWNER" ? await groupDeletionImpact(id, { id: user.id }) : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/groups`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        {t("back")}
      </Link>

      <PageHeader
        overline={t("detailOverline")}
        title={group.name}
        subtitle={group.description}
        actions={
          canEdit && (
            <GroupForm
              mode="edit"
              group={{ id: group.id, name: group.name, description: group.description }}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil />
                  {t("edit")}
                </Button>
              }
            />
          )
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionCard
          flush
          overline={t("membersOverline")}
          title={t("members")}
          action={
            <Badge variant="secondary">{t("memberCount", { count: group.members.length })}</Badge>
          }
        >
          <MemberList
            groupId={group.id}
            members={group.members}
            viewerId={user.id}
            viewerRole={viewerRole}
          />
        </SectionCard>

        <SectionCard flush overline={t("overline")} title={ta("sharedAccounts")}>
          {sharedAccounts.length === 0 ? (
            <p className="text-muted-foreground px-4 py-5 text-sm sm:px-6">
              {ta("noSharedAccounts")}
            </p>
          ) : (
            <div className="divide-border divide-y">
              {sharedAccounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color ?? "#2563eb" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        data-slot="shared-account-name"
                        className="min-w-0 text-sm font-medium wrap-anywhere"
                      >
                        {a.name}
                      </span>
                      <Badge variant="secondary">{ta(`access.${a.permission}`)}</Badge>
                    </div>
                    <div
                      className="text-muted-foreground truncate text-xs"
                      title={ta("sharedBy", { name: a.ownerName })}
                    >
                      {ta("sharedBy", { name: a.ownerName })}
                    </div>
                  </div>
                  <span className="font-display shrink-0 text-sm">{money(a.balance)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {canEdit && (
        <SectionCard flush overline={ti("overline")} title={ti("invite")}>
          <div className="border-b px-4 py-4 sm:px-6">
            <InviteForm groupId={group.id} />
          </div>
          <h3 className={listHeader}>{ti("pending")}</h3>
          <InvitationsList invitations={pending} />
        </SectionCard>
      )}

      <GroupDangerZone
        groupId={group.id}
        viewerRole={viewerRole}
        isLastOwner={isLastOwner}
        deletionImpact={deletionImpact}
      />
    </div>
  );
}
