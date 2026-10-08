import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { ImportWizard } from "@/components/import/import-wizard";
import { ImportHistory } from "@/components/import/import-history";
import { listRecentImports } from "@/server/services/imports/revert";
import { getOnboardingState } from "@/server/services/onboarding";
import { writableActiveAccounts } from "@/lib/onboarding";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("import");

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const accounts = writableActiveAccounts(await listVisibleForUser(user.id)).map((a) => ({
    id: a.id,
    name: a.name,
    bankName: a.bankName,
  }));
  const [categories, history, onboarding] = await Promise.all([
    listForUser(user.id).then(flattenCategories),
    listRecentImports(user.id),
    getOnboardingState(user.id),
  ]);

  return (
    <ImportWizard
      accounts={accounts}
      addBlocker={onboarding.addBlocker}
      categories={categories}
      history={<ImportHistory items={history} />}
    />
  );
}
