import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { DataControls } from "@/components/settings/data-controls";

export const dynamic = "force-dynamic";

export default async function DataSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSession();

  return <DataControls locale={locale} />;
}
