import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { ImportTabs } from "@/components/import/import-tabs";
import { CsvImporter } from "@/components/import/csv-importer";

export const dynamic = "force-dynamic";

export default async function ImportCsvPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("import");
  const accounts = (await listVisibleForUser(user.id))
    .filter((a) => a.access === "OWNER" || a.access === "WRITE")
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <ImportTabs />
      <CsvImporter accounts={accounts} />
    </div>
  );
}
