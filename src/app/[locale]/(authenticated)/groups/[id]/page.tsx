import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { getGroupDetail, GroupAccessError } from "@/server/services/groups";
import { listInvitations } from "@/server/services/groups/invitations";
import type { GroupRole } from "@/server/services/groups/roles";
import { MemberList } from "@/components/groups/member-list";
import { GroupForm } from "@/components/groups/group-form";
import { InviteForm } from "@/components/groups/invite-form";
import { InvitationsList } from "@/components/groups/invitations-list";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const RANK: Record<GroupRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

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

  const ti = await getTranslations("invitations");
  const pending = canEdit
    ? (await listInvitations(id, { id: user.id })).map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        code: inv.code,
        expiresAt: inv.expiresAt.toISOString(),
      }))
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/${locale}/groups`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display truncate text-3xl">{group.name}</h1>
          {group.description && (
            <p className="text-muted-foreground text-sm">{group.description}</p>
          )}
        </div>
        {canEdit && (
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
        )}
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("members")}</h2>
        <MemberList
          groupId={group.id}
          members={group.members}
          viewerId={user.id}
          viewerRole={viewerRole}
        />
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
    </div>
  );
}
