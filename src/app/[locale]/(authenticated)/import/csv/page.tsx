import { redirect } from "next/navigation";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("importCsv");

// CSV import was unified into the single /import wizard (4.x design conformance).
export default async function ImportCsvRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/import`);
}
