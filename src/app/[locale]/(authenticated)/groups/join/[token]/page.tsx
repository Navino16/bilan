import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { getInvitationByToken } from "@/server/services/groups/invitations";
import { JoinConfirm } from "@/components/groups/join-confirm";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  await requireSession();
  const t = await getTranslations("invitations");
  const inv = await getInvitationByToken(token);
  const valid = inv && !inv.accepted && !inv.expired;

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
        {valid ? (
          <>
            <p className="text-muted-foreground text-sm">
              {t("joinPrompt", { group: inv.groupName })}
            </p>
            <JoinConfirm token={token} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("invalidLink")}</p>
        )}
      </div>
    </div>
  );
}
