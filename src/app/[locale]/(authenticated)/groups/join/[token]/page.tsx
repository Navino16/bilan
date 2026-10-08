import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getInvitationByToken, maskEmail } from "@/server/services/groups/invitations";
import { JoinConfirm } from "@/components/groups/join-confirm";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("joinGroup");

export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const [t, tg, inv] = await Promise.all([
    getTranslations("invitations"),
    getTranslations("groups"),
    getInvitationByToken(token),
  ]);
  const valid = inv && !inv.accepted && !inv.expired;
  const wrongAccount = valid && inv.email !== user.email.toLowerCase();
  const alreadyMember =
    valid &&
    !wrongAccount &&
    !!(await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: inv.groupId, userId: user.id } },
    }));

  return (
    <div className="mx-auto w-full max-w-md space-y-6 py-8">
      <Link
        href={`/${locale}/groups`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        {t("joinByCode")}
      </Link>

      <div className="border-border space-y-4 rounded-xl border p-6">
        <h1 className="font-display text-2xl">{t("joinTitle")}</h1>
        {!valid ? (
          <p className="text-muted-foreground text-sm">{t("invalidLink")}</p>
        ) : wrongAccount ? (
          <p className="text-sm">{t("error.WRONG_ACCOUNT", { email: maskEmail(inv.email) })}</p>
        ) : alreadyMember ? (
          <div className="space-y-3">
            <p className="text-sm">{t("error.ALREADY_IN_GROUP")}</p>
            <Link href={`/${locale}/groups/${inv.groupId}`} className="text-sm hover:underline">
              {t("openGroup")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {t("joinPromptRole", { group: inv.groupName, role: tg(`roles.${inv.role}`) })}
            </p>
            <JoinConfirm token={token} />
          </>
        )}
      </div>
    </div>
  );
}
