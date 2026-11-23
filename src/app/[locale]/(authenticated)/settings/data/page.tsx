import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { DataControls } from "@/components/settings/data-controls";
import { ownDeletionImpact } from "@/server/services/users/own-deletion";
import { listVisibleForUser } from "@/server/services/accounts";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("data");

export default async function DataSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  // SSO-only accounts (no password credential) confirm deletion by email, not password.
  const [credential, impact, accounts] = await Promise.all([
    db.authAccount.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { id: true },
    }),
    ownDeletionImpact(user.id),
    listVisibleForUser(user.id, { includeArchived: true }),
  ]);
  // Archived accounts keep their history, so they stay exportable, listed last.
  const exportAccounts = [...accounts]
    .sort((a, b) => Number(a.archived) - Number(b.archived))
    .map((a) => ({ id: a.id, name: a.name, archived: a.archived }));

  return (
    <DataControls
      locale={locale}
      hasPassword={Boolean(credential)}
      email={user.email}
      impact={impact}
      accounts={exportAccounts}
    />
  );
}
