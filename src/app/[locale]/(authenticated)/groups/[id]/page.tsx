import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { getGroupDetail, GroupAccessError } from "@/server/services/groups";
import { listInvitations } from "@/server/services/groups/invitations";
import { listAccountsSharedWithGroup } from "@/server/services/accounts/sharing";
import type { GroupRole } from "@/server/services/groups/roles";
import { MemberList } from "@/components/groups/member-list";
import { GroupDangerZone } from "@/components/groups/group-danger-zone";
import { GroupForm } from "@/components/groups/group-form";
import { InviteForm } from "@/components/groups/invite-form";
import { InvitationsList } from "@/components/groups/invitations-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

const RANK: Record<GroupRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

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

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("members")}</h2>
        <MemberList
          groupId={group.id}
          members={group.members}
          viewerId={user.id}
          viewerRole={viewerRole}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{ta("sharedAccounts")}</h2>
        {sharedAccounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{ta("noSharedAccounts")}</p>
        ) : (
          <div className="border-border divide-border divide-y rounded-lg border">
            {sharedAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: a.color ?? "#2563eb" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    <Badge variant="secondary">{ta(`access.${a.permission}`)}</Badge>
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {ta("sharedBy", { name: a.ownerName })}
                  </div>
                </div>
                <span className="font-display text-sm">{money(a.balance)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {canEdit && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{ti("invite")}</h2>
          <InviteForm groupId={group.id} />
          <div className="space-y-2 pt-2">
            <h3 className="text-muted-foreground text-sm font-medium">{ti("pending")}</h3>
            <InvitationsList invitations={pending} />
          </div>
        </section>
      )}

      <GroupDangerZone groupId={group.id} viewerRole={viewerRole} isLastOwner={isLastOwner} />
    </div>
  );
}
