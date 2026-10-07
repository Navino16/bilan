import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { ImportWizard } from "@/components/import/import-wizard";
import { ImportHistory } from "@/components/import/import-history";
import { listRecentImports } from "@/server/services/imports/revert";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("import");

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const accounts = (await listVisibleForUser(user.id))
    .filter((a) => a.access === "OWNER" || a.access === "WRITE")
    .map((a) => ({ id: a.id, name: a.name, bankName: a.bankName }));
  const [categories, history] = await Promise.all([
    listForUser(user.id).then(flattenCategories),
    listRecentImports(user.id),
  ]);

  return (
    <ImportWizard
      accounts={accounts}
      categories={categories}
      history={<ImportHistory items={history} />}
    />
  );
}
