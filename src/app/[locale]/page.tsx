import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/permissions";

// `/` is the PWA start_url: land on the app, not a marketing page.
export const dynamic = "force-dynamic";

export default async function LocaleIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect((await getCurrentUser()) ? `/${locale}/dashboard` : `/${locale}/login`);
}
