import { redirect } from "next/navigation";

// CSV import was unified into the single /import wizard (4.x design conformance).
export default async function ImportCsvRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/import`);
}
