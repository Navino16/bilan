import { redirect } from "next/navigation";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("admin");

export default async function AdminIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/users`);
}
