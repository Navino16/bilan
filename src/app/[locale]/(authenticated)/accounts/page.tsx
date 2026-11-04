import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { listForUser } from "@/server/services/categories";
import { listGroupsForUser } from "@/server/services/groups";
import { isBankSyncAvailable } from "@/server/services/bank-sync/config";
import { listBankConnections } from "@/server/services/bank-sync/connect";
import { listSyncedAccounts } from "@/server/services/bank-sync/status";
import { flattenCategories } from "@/components/transactions/category-tree";
import { AccountList } from "@/components/accounts/account-list";
import { AccountForm } from "@/components/accounts/account-form";
import { BankConnectDialog } from "@/components/accounts/bank-connect-dialog";
import { BankConnections } from "@/components/accounts/bank-connections";
import { BankConsentBanner } from "@/components/accounts/bank-consent-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("accounts");

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string; bankSync?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("accounts");
  const accounts = await listVisibleForUser(user.id, { includeArchived: true });
  const categories = flattenCategories(await listForUser(user.id));
  const groups = (await listGroupsForUser(user.id)).map((g) => ({ id: g.id, name: g.name }));
  const [bankSync, connections, synced] = await Promise.all([
    isBankSyncAvailable(),
    listBankConnections(user.id),
    listSyncedAccounts(user.id),
  ]);
  const result = sp.bankSync;
  const resultKey = result && t.has(`bankSync.result.${result}`) ? result : "FAILED";

  return (
    <div className="space-y-6">
      <PageHeader
        overline={t("overline")}
        title={t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {bankSync && <BankConnectDialog />}
            <AccountForm
              mode="create"
              defaultOpen={sp.new === "1"}
              trigger={
                <Button>
                  <Plus />
                  {t("create")}
                </Button>
              }
            />
          </div>
        }
      />
      {result && (
        <Alert
          variant={resultKey === "RECONNECTED" ? "default" : "destructive"}
          data-slot="bank-sync-result"
        >
          <AlertDescription>{t(`bankSync.result.${resultKey as "FAILED"}`)}</AlertDescription>
        </Alert>
      )}
      {bankSync && <BankConsentBanner connections={connections} />}
      <AccountList
        accounts={accounts}
        synced={bankSync ? synced : {}}
        groups={groups}
        categories={categories}
      />
      {connections.length > 0 && <BankConnections connections={connections} available={bankSync} />}
    </div>
  );
}
