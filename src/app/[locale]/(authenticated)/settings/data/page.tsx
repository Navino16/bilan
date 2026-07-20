import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { DataControls } from "@/components/settings/data-controls";

export const dynamic = "force-dynamic";

export default async function DataSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();

  // SSO-only accounts (no password credential) confirm deletion by email, not password.
  const credential = await db.authAccount.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  return <DataControls locale={locale} hasPassword={Boolean(credential)} email={user.email} />;
}
